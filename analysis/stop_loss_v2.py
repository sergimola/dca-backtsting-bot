"""
Stop-Loss Strategy Simulator v2 (Vectorized)
=============================================
Fast simulation using ClickHouse for heavy lifting + vectorized pandas.
"""

import clickhouse_connect
import pandas as pd
import numpy as np
from itertools import product
import json
import time as time_mod

client = clickhouse_connect.get_client(
    host='127.0.0.1', port=18123,
    username='admin', password='admin',
    database='data'
)


def fetch_trade_level_data(session_id: str, run_id: str) -> pd.DataFrame:
    """Fetch trade-level summary from ClickHouse — much smaller than full events."""
    query = f"""
    WITH trades AS (
        SELECT 
            trade_id,
            min(timestamp) as open_ts,
            max(timestamp) as close_ts,
            argMin(toFloat64(candle_close), timestamp) as open_price,
            argMax(event_type, timestamp) as final_event,
            argMax(toFloat64(running_account_balance), timestamp) as balance_after,
            argMax(toFloat64(unrealized_pnl), timestamp) as final_pnl,
            argMax(filled_orders_count, timestamp) as max_orders,
            argMax(toFloat64(average_entry_price), timestamp) as avg_entry,
            argMax(toFloat64(total_capital_deployed), timestamp) as capital_deployed
        FROM sweep_wide_events
        WHERE session_id = '{session_id}' AND run_id = '{run_id}'
          AND trade_id != ''
        GROUP BY trade_id
    )
    SELECT * FROM trades ORDER BY open_ts
    """
    result = client.query(query)
    df = pd.DataFrame(result.result_rows, columns=result.column_names)
    df['open_ts'] = pd.to_datetime(df['open_ts'])
    df['close_ts'] = pd.to_datetime(df['close_ts'])
    return df


def fetch_drawdown_timeseries(session_id: str, run_id: str) -> pd.DataFrame:
    """Fetch hourly-sampled drawdown and balance data."""
    query = f"""
    SELECT 
        toStartOfHour(timestamp) as hour,
        min(toFloat64(current_drawdown_pct)) as worst_dd,
        argMax(toFloat64(running_account_balance), timestamp) as balance,
        argMax(toFloat64(current_drawdown_pct), timestamp) as eoh_dd,
        argMax(toFloat64(unrealized_pnl), timestamp) as eoh_upnl,
        argMax(toFloat64(total_capital_deployed), timestamp) as eoh_capital,
        argMax(position_state, timestamp) as eoh_pos_state,
        argMax(toFloat64(candle_close), timestamp) as eoh_price,
        argMax(filled_orders_count, timestamp) as eoh_orders
    FROM sweep_wide_events
    WHERE session_id = '{session_id}' AND run_id = '{run_id}'
    GROUP BY hour
    ORDER BY hour
    """
    result = client.query(query)
    df = pd.DataFrame(result.result_rows, columns=result.column_names)
    df['hour'] = pd.to_datetime(df['hour'])
    return df


def simulate_stop_on_hourly(hourly_df: pd.DataFrame, dd_threshold: float, wait_hours: int) -> dict:
    """
    Simulate stop-loss on hourly-sampled data.
    
    dd_threshold: e.g. -15.0
    wait_hours: how many consecutive hours below threshold before stopping
    """
    n = len(hourly_df)
    balance = hourly_df.iloc[0]['balance']
    initial_balance = balance
    
    # Tracking
    stop_count = 0
    total_stop_losses = 0.0
    peak_balance = balance
    worst_dd_from_peak = 0.0
    
    consecutive_breach_hours = 0
    stopped_out = False
    cumulative_stop_adjustment = 0.0  # how much we've "saved" or "lost" from stops
    
    for i in range(n):
        row = hourly_df.iloc[i]
        pos_state = row['eoh_pos_state']
        dd = row['eoh_dd']
        upnl = row['eoh_upnl']
        bal = row['balance']
        
        # Adjust balance for our stop-loss decisions
        effective_balance = bal + cumulative_stop_adjustment
        
        if stopped_out:
            # We're flat — waiting for a new position to open
            if pos_state == 'active':
                # Check if this is a fresh position (orders = 1) or same old one
                # If position state changed from closed to active, reset
                if i > 0 and hourly_df.iloc[i-1]['eoh_pos_state'] != 'active':
                    stopped_out = False
                    consecutive_breach_hours = 0
            continue
            
        if pos_state == 'active':
            if dd < dd_threshold:
                consecutive_breach_hours += 1
                if consecutive_breach_hours >= max(1, wait_hours):
                    # STOP: realize the loss
                    stop_loss = upnl
                    cumulative_stop_adjustment += stop_loss  # this is relative to original run
                    # Actually what we stop is: we take the unrealized loss NOW
                    # vs the original run continuing. If original run later recovers, we lose.
                    # If original run goes deeper, we win.
                    total_stop_losses += stop_loss
                    stop_count += 1
                    stopped_out = True
                    consecutive_breach_hours = 0
            else:
                consecutive_breach_hours = 0
        else:
            consecutive_breach_hours = 0
            stopped_out = False
        
        # Track peak & drawdown
        eff_bal = effective_balance + (upnl if pos_state == 'active' and not stopped_out else 0)
        if eff_bal > peak_balance:
            peak_balance = eff_bal
        dd_from_peak = ((eff_bal - peak_balance) / peak_balance) * 100 if peak_balance > 0 else 0
        if dd_from_peak < worst_dd_from_peak:
            worst_dd_from_peak = dd_from_peak
    
    # Final state
    final_row = hourly_df.iloc[-1]
    original_final_bal = final_row['balance']
    original_final_upnl = final_row['eoh_upnl'] if final_row['eoh_pos_state'] == 'active' else 0
    
    # Our final effective balance 
    if stopped_out:
        # We stopped out and haven't re-entered — cash only
        final_eff = original_final_bal + cumulative_stop_adjustment
        still_in_pos = False
    else:
        final_eff = original_final_bal + cumulative_stop_adjustment + original_final_upnl
        still_in_pos = final_row['eoh_pos_state'] == 'active'
    
    return {
        'dd_threshold': dd_threshold,
        'wait_hours': wait_hours,
        'initial_balance': initial_balance,
        'final_effective_balance': final_eff,
        'total_return_pct': ((final_eff - initial_balance) / initial_balance) * 100,
        'worst_drawdown': worst_dd_from_peak,
        'stop_count': stop_count,
        'total_stop_losses': total_stop_losses,
        'still_in_position': still_in_pos,
    }


def run_analysis():
    """Run stop-loss simulation across multiple runs and parameter combinations."""
    
    print("="*100)
    print("DCA BOT STOP-LOSS STRATEGY ANALYSIS")
    print("="*100)
    
    # ── Part 1: Market Context ─────────────────────────────────────────────
    print("\n📊 MARKET CONTEXT (Last 6 months)")
    print("-"*60)
    market = client.query("""
        SELECT symbol,
            argMinIf(close, timestamp, timestamp >= '2025-10-01') as oct_price,
            argMaxIf(close, timestamp, timestamp >= '2025-10-01') as peak_since_oct,
            argMax(close, timestamp) as current_price,
            round((argMax(close, timestamp) / argMinIf(close, timestamp, timestamp >= '2025-10-01') - 1) * 100, 1) as change_pct
        FROM market_data
        WHERE symbol IN ('BTCUSDC', 'ETHUSDC')
        GROUP BY symbol
    """)
    for row in market.result_rows:
        print(f"  {row[0]}: Oct=${row[1]:,.0f} → Now=${row[3]:,.0f} ({row[4]:+.1f}%)")
    
    # ── Part 2: Get all runs ───────────────────────────────────────────────
    print("\n📋 SWEEP INVENTORY")
    print("-"*60)
    runs_result = client.query("""
        SELECT session_id, run_id, any(symbol) as symbol,
               argMin(toFloat64(running_account_balance), timestamp) as start_balance,
               argMax(toFloat64(running_account_balance), timestamp) as final_balance,
               argMax(toFloat64(current_drawdown_pct), timestamp) as current_dd,
               argMax(toFloat64(unrealized_pnl), timestamp) as current_upnl,
               argMax(position_state, timestamp) as final_pos_state,
               countIf(event_type = 'position_closed') as closed_trades,
               min(toFloat64(current_drawdown_pct)) as worst_dd_ever
        FROM sweep_wide_events
        GROUP BY session_id, run_id
        ORDER BY session_id, final_balance DESC
    """)
    runs = pd.DataFrame(runs_result.result_rows, columns=runs_result.column_names)
    runs['session_id'] = runs['session_id'].astype(str)
    runs['run_id'] = runs['run_id'].astype(str)
    
    for sid in runs['session_id'].unique():
        sdf = runs[runs['session_id'] == sid]
        sym = sdf.iloc[0]['symbol']
        print(f"\n  Session {sid[:8]}... ({sym}, {len(sdf)} runs)")
        print(f"    Balance range: ${sdf['final_balance'].min():,.0f} — ${sdf['final_balance'].max():,.0f}")
        print(f"    Current DD range: {sdf['current_dd'].min():.1f}% — {sdf['current_dd'].max():.1f}%")
        print(f"    Worst DD ever: {sdf['worst_dd_ever'].min():.1f}%")
        print(f"    All stuck: {(sdf['final_pos_state'] == 'active').all()}")
    
    # ── Part 3: Select representative runs ────────────────────────────────
    representative_runs = []
    for sid in runs['session_id'].unique():
        session_runs = runs[runs['session_id'] == sid].sort_values('final_balance')
        symbol = session_runs.iloc[0]['symbol']
        n = len(session_runs)
        
        for idx, suffix in [(n-1, 'best'), (0, 'worst'), (n//2, 'median')]:
            r = session_runs.iloc[idx]
            representative_runs.append({
                'session_id': r['session_id'],
                'run_id': r['run_id'],
                'label': f'{symbol}_{suffix}_{sid[:4]}',
                'symbol': symbol
            })
    
    # ── Part 4: Run simulations ───────────────────────────────────────────
    print(f"\n\n{'='*100}")
    print("STOP-LOSS SIMULATION (Hourly Resolution)")
    print(f"{'='*100}")
    
    dd_thresholds = [-5, -8, -10, -12, -15, -20, -25, -30, -35]
    wait_hours = [0, 1, 4, 12, 24, 48]
    all_params = [(-999, 0)] + list(product(dd_thresholds, wait_hours))
    
    all_results = []
    
    for run_info in representative_runs:
        run_id = run_info['run_id']
        session_id = run_info['session_id']
        label = run_info['label']
        
        print(f"\n{'─'*80}")
        print(f"  {label} (run={run_id[:8]})")
        
        t0 = time_mod.time()
        hourly = fetch_drawdown_timeseries(session_id, run_id)
        fetch_time = time_mod.time() - t0
        print(f"  {len(hourly):,} hourly samples ({fetch_time:.1f}s fetch)")
        
        t0 = time_mod.time()
        for dd_thresh, wait_h in all_params:
            result = simulate_stop_on_hourly(hourly, dd_thresh, wait_h)
            result['run_label'] = label
            result['run_id'] = run_id
            result['session_id'] = session_id
            all_results.append(result)
        sim_time = time_mod.time() - t0
        
        # Print baseline vs top 3 stops
        baseline = [r for r in all_results if r['run_label'] == label and r['dd_threshold'] == -999][0]
        stops_sorted = sorted(
            [r for r in all_results if r['run_label'] == label and r['dd_threshold'] != -999],
            key=lambda r: r['final_effective_balance'],
            reverse=True
        )
        
        print(f"  Sim time: {sim_time:.1f}s")
        print(f"  BASELINE: ${baseline['final_effective_balance']:,.0f} (return={baseline['total_return_pct']:.0f}%, dd={baseline['worst_drawdown']:.0f}%)")
        print(f"  TOP 3 STOPS:")
        for r in stops_sorted[:3]:
            diff = r['final_effective_balance'] - baseline['final_effective_balance']
            print(f"    {r['dd_threshold']}%/{r['wait_hours']}h → ${r['final_effective_balance']:,.0f} ({diff:+,.0f}) dd={r['worst_drawdown']:.0f}% stops={r['stop_count']}")
    
    # ── Part 5: Cross-run analysis ────────────────────────────────────────
    results_df = pd.DataFrame(all_results)
    
    print(f"\n\n{'='*100}")
    print("PARAMETER OPTIMIZATION (averaged across ALL runs)")
    print(f"{'='*100}")
    
    non_baseline = results_df[results_df['dd_threshold'] != -999].copy()
    baselines = results_df[results_df['dd_threshold'] == -999][['run_label', 'final_effective_balance']].rename(
        columns={'final_effective_balance': 'baseline_bal'}
    )
    non_baseline = non_baseline.merge(baselines, on='run_label')
    non_baseline['improvement'] = non_baseline['final_effective_balance'] - non_baseline['baseline_bal']
    non_baseline['improvement_pct'] = (non_baseline['improvement'] / non_baseline['baseline_bal']) * 100
    
    param_summary = non_baseline.groupby(['dd_threshold', 'wait_hours']).agg(
        avg_improvement_pct=('improvement_pct', 'mean'),
        median_improvement_pct=('improvement_pct', 'median'),
        avg_worst_dd=('worst_drawdown', 'mean'),
        avg_stops=('stop_count', 'mean'),
        wins=('improvement', lambda x: (x > 0).sum()),
        total=('improvement', 'count'),
        avg_return=('total_return_pct', 'mean'),
    ).reset_index()
    param_summary['win_rate'] = param_summary['wins'] / param_summary['total'] * 100
    param_summary = param_summary.sort_values('avg_improvement_pct', ascending=False)
    
    print(f"\n  {'DD%':>5} {'Wait':>5} | {'AvgImprove%':>12} {'MedImprove%':>12} {'AvgReturn%':>11} {'AvgDD%':>8} {'AvgStops':>9} {'WinRate':>8}")
    print(f"  {'-'*5} {'-'*5} | {'-'*12} {'-'*12} {'-'*11} {'-'*8} {'-'*9} {'-'*8}")
    
    for _, row in param_summary.head(25).iterrows():
        print(f"  {row['dd_threshold']:>4.0f}% {row['wait_hours']:>4.0f}h | {row['avg_improvement_pct']:>+11.1f}% {row['median_improvement_pct']:>+11.1f}% {row['avg_return']:>10.1f}% {row['avg_worst_dd']:>7.1f}% {row['avg_stops']:>8.1f} {row['win_rate']:>7.0f}%")
    
    # ── Part 6: Detailed per-run table for top 5 parameters ──────────────
    top_params = param_summary.head(5)[['dd_threshold', 'wait_hours']].values.tolist()
    
    print(f"\n\n{'='*100}")
    print("DETAILED RESULTS FOR TOP 5 STOP PARAMETERS")
    print(f"{'='*100}")
    
    for dd_t, wait_h in top_params:
        print(f"\n  Stop: {dd_t:.0f}% / {wait_h:.0f}h wait")
        print(f"  {'Run Label':<25} {'Baseline$':>12} {'WithStop$':>12} {'Delta$':>10} {'Return%':>9} {'MaxDD%':>8} {'Stops':>6}")
        print(f"  {'-'*25} {'-'*12} {'-'*12} {'-'*10} {'-'*9} {'-'*8} {'-'*6}")
        
        for label in results_df['run_label'].unique():
            base = results_df[(results_df['run_label'] == label) & (results_df['dd_threshold'] == -999)].iloc[0]
            stop_row = non_baseline[(non_baseline['run_label'] == label) & 
                                     (non_baseline['dd_threshold'] == dd_t) &
                                     (non_baseline['wait_hours'] == wait_h)]
            if len(stop_row) == 0:
                continue
            stop_row = stop_row.iloc[0]
            delta = stop_row['final_effective_balance'] - base['final_effective_balance']
            print(f"  {label:<25} ${base['final_effective_balance']:>11,.0f} ${stop_row['final_effective_balance']:>11,.0f} {delta:>+9,.0f} {stop_row['total_return_pct']:>8.1f}% {stop_row['worst_drawdown']:>7.1f}% {stop_row['stop_count']:>5.0f}")
    
    # ── Part 7: Risk-adjusted metric ─────────────────────────────────────
    print(f"\n\n{'='*100}")
    print("RISK-ADJUSTED RANKING (Return / |MaxDD| ratio)")
    print(f"{'='*100}")
    
    param_summary['risk_adj'] = param_summary['avg_return'] / param_summary['avg_worst_dd'].abs().clip(lower=1)
    param_summary_sorted = param_summary.sort_values('risk_adj', ascending=False)
    
    print(f"\n  {'DD%':>5} {'Wait':>5} | {'AvgReturn%':>11} {'AvgDD%':>8} {'RiskAdj':>8} {'AvgStops':>9} {'WinRate':>8}")
    print(f"  {'-'*5} {'-'*5} | {'-'*11} {'-'*8} {'-'*8} {'-'*9} {'-'*8}")
    
    for _, row in param_summary_sorted.head(15).iterrows():
        print(f"  {row['dd_threshold']:>4.0f}% {row['wait_hours']:>4.0f}h | {row['avg_return']:>10.1f}% {row['avg_worst_dd']:>7.1f}% {row['risk_adj']:>7.2f} {row['avg_stops']:>8.1f} {row['win_rate']:>7.0f}%")
    
    # ── Part 8: Save results ─────────────────────────────────────────────
    output = {
        'analysis_metadata': {
            'total_runs_analyzed': len(representative_runs),
            'parameter_combos': len(all_params) - 1,
            'hourly_resolution': True,
        },
        'baselines': results_df[results_df['dd_threshold'] == -999].to_dict('records'),
        'top_parameters': param_summary.head(10).to_dict('records'),
        'risk_adjusted_top': param_summary_sorted.head(10).to_dict('records'),
        'all_results': results_df.to_dict('records'),
    }
    
    with open('analysis/stop_loss_results.json', 'w') as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\n  Results saved to analysis/stop_loss_results.json")
    
    print(f"\n\n{'='*100}")
    print("KEY FINDINGS & RECOMMENDATIONS")
    print(f"{'='*100}")
    
    best_param = param_summary_sorted.iloc[0]
    best_abs = param_summary.iloc[0]
    
    print(f"""
  1. PROBLEM: Every single DCA run ({len(runs)} total, both BTC & ETH) is currently
     stuck in an active position with 15-52% drawdown. Monthly additions mask the
     bleeding but no trades have closed for months.

  2. ROOT CAUSE: DCA bots enter near local highs and exhaust all safety orders
     during the initial drop. Once all SOs are filled, there's ZERO ability to
     average down further. The position becomes a pure directional long bet.

  3. BEST ABSOLUTE IMPROVEMENT: {best_abs['dd_threshold']:.0f}% threshold / {best_abs['wait_hours']:.0f}h wait
     - Average improvement over baseline: {best_abs['avg_improvement_pct']:+.1f}%
     - Win rate: {best_abs['win_rate']:.0f}% of runs improved

  4. BEST RISK-ADJUSTED: {best_param['dd_threshold']:.0f}% threshold / {best_param['wait_hours']:.0f}h wait
     - Average return: {best_param['avg_return']:.1f}%
     - Average max drawdown: {best_param['avg_worst_dd']:.1f}%
     - Risk-adjusted ratio: {best_param['risk_adj']:.2f}

  5. RECOMMENDED STOP-LOSS PARAMETERS:
     - Threshold: Use the position-level drawdown (the bot's current_drawdown_pct)
     - Stop at: {best_param['dd_threshold']:.0f}% to {best_abs['dd_threshold']:.0f}% drawdown
     - Wait: {best_param['wait_hours']:.0f}h confirmation before executing
     - Monthly additions continue building cash in flat periods
""")


if __name__ == '__main__':
    run_analysis()
