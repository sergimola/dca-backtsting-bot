"""
Stop-Loss Strategy Simulator for DCA Bot
=========================================
Uses ClickHouse wide-event data to simulate what would happen if the bot
had a stop-loss mechanism: close position when drawdown exceeds X% for Y minutes.

The bot's constraint: it can't change how it opens/DCA's. The ONLY lever is:
  - Stop threshold (dd_pct): close position if drawdown exceeds this %
  - Cooldown (wait_minutes): wait N minutes after threshold breach before executing

After a stop, the "position is flat" — the bot would re-enter on the next signal.
We simulate this by tracking account balance as if the loss was realized at stop price.
"""

import clickhouse_connect
import pandas as pd
import numpy as np
from itertools import product
import json
import sys

# ── ClickHouse connection ─────────────────────────────────────────────────────
client = clickhouse_connect.get_client(
    host='127.0.0.1', port=18123,
    username='admin', password='admin',
    database='data'
)

def fetch_run_events(run_id: str, session_id: str) -> pd.DataFrame:
    """Fetch all events for a single run, ordered by time."""
    query = f"""
    SELECT
        timestamp,
        event_type,
        toFloat64(candle_close) as price,
        toFloat64(running_account_balance) as balance,
        toFloat64(current_drawdown_pct) as drawdown_pct,
        toFloat64(total_capital_deployed) as capital_deployed,
        toFloat64(unrealized_pnl) as unrealized_pnl,
        toFloat64(average_entry_price) as avg_entry,
        filled_orders_count,
        position_state,
        toFloat64(action_price) as action_price,
        toFloat64(fees_accumulated) as fees
    FROM sweep_wide_events
    WHERE run_id = '{run_id}' AND session_id = '{session_id}'
    ORDER BY timestamp
    """
    result = client.query(query)
    df = pd.DataFrame(result.result_rows, columns=result.column_names)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    return df


def simulate_stop_loss(df: pd.DataFrame, dd_threshold: float, wait_minutes: int) -> dict:
    """
    Simulate a stop-loss overlay on actual DCA bot events.
    
    dd_threshold: negative float, e.g. -15.0 means stop at -15% drawdown
    wait_minutes: how many minutes drawdown must stay below threshold before executing
    
    Returns metrics dict.
    """
    balance = df.iloc[0]['balance']  # starting balance
    initial_balance = balance
    
    # Track state
    in_position = False
    position_capital = 0.0
    position_entry = 0.0
    position_unrealized = 0.0
    
    # Stop tracking  
    threshold_breach_time = None
    stopped_out = False
    stop_count = 0
    total_realized_stop_losses = 0.0
    
    # Metrics
    peak_balance = balance
    worst_drawdown = 0.0
    monthly_additions_total = 0.0
    
    # Track completed trades (from original events)
    completed_trades = 0
    completed_trade_pnl = 0.0
    
    # Process events
    last_month = None
    monthly_addition = 250.0  # detected from data: ~$250/month
    
    events = df.to_dict('records')
    
    for i, evt in enumerate(events):
        ts = evt['timestamp']
        event_type = evt['event_type']
        price = evt['price']
        original_dd = evt['drawdown_pct']
        original_balance = evt['balance']
        capital_deployed = evt['capital_deployed']
        upnl = evt['unrealized_pnl']
        pos_state = evt['position_state']
        
        # Handle monthly additions (approximate from data)
        current_month = (ts.year, ts.month)
        if last_month is not None and current_month != last_month:
            # Monthly addition happened
            months_passed = (current_month[0] - last_month[0]) * 12 + (current_month[1] - last_month[1])
            addition = monthly_addition * months_passed
            if not in_position:
                balance += addition
                monthly_additions_total += addition
        last_month = current_month
        
        if stopped_out:
            # We're flat after a stop. Wait for position_opened to re-enter.
            if event_type == 'position_opened':
                stopped_out = False
                in_position = True
                position_capital = capital_deployed
                position_entry = evt['avg_entry']
                position_unrealized = 0.0
                threshold_breach_time = None
            continue
        
        if event_type == 'position_opened':
            in_position = True
            position_capital = capital_deployed
            position_entry = evt['avg_entry']
            position_unrealized = 0.0
            threshold_breach_time = None
            
        elif event_type == 'order_filled' and in_position:
            position_capital = capital_deployed
            position_entry = evt['avg_entry']
            position_unrealized = upnl
            
        elif event_type == 'position_closed' and in_position:
            # Natural close (take profit hit)
            trade_pnl = upnl
            balance += trade_pnl
            completed_trades += 1
            completed_trade_pnl += trade_pnl
            in_position = False
            threshold_breach_time = None
            
        elif event_type == 'price_changed' and in_position:
            position_unrealized = upnl
            
            # Calculate our own drawdown from balance perspective
            effective_balance = balance + position_unrealized
            if peak_balance > 0:
                current_dd = ((effective_balance - peak_balance) / peak_balance) * 100
            else:
                current_dd = 0
            
            # Use position-level drawdown (more relevant for stop)
            if position_capital > 0 and position_unrealized < 0:
                position_dd_pct = (position_unrealized / position_capital) * 100
            else:
                position_dd_pct = 0
            
            # Check stop condition using the bot's drawdown metric
            if original_dd < dd_threshold:
                if threshold_breach_time is None:
                    threshold_breach_time = ts
                
                elapsed = (ts - threshold_breach_time).total_seconds() / 60.0
                if elapsed >= wait_minutes:
                    # EXECUTE STOP: realize the loss
                    realized_loss = position_unrealized
                    balance += realized_loss
                    total_realized_stop_losses += realized_loss
                    stop_count += 1
                    in_position = False
                    stopped_out = True
                    threshold_breach_time = None
            else:
                threshold_breach_time = None
        
        # Track peak balance and worst drawdown
        effective_balance = balance + (position_unrealized if in_position else 0)
        if effective_balance > peak_balance:
            peak_balance = effective_balance
        if peak_balance > 0:
            dd = ((effective_balance - peak_balance) / peak_balance) * 100
            if dd < worst_drawdown:
                worst_drawdown = dd
    
    # Final state
    final_effective_balance = balance + (position_unrealized if in_position else 0)
    
    return {
        'dd_threshold': dd_threshold,
        'wait_minutes': wait_minutes,
        'initial_balance': initial_balance,
        'final_balance': balance,  # cash balance
        'final_effective_balance': final_effective_balance,
        'total_return_pct': ((final_effective_balance - initial_balance) / initial_balance) * 100,
        'cash_return_pct': ((balance - initial_balance) / initial_balance) * 100,
        'worst_drawdown': worst_drawdown,
        'stop_count': stop_count,
        'total_stop_losses': total_realized_stop_losses,
        'completed_trades': completed_trades,
        'completed_trade_pnl': completed_trade_pnl,
        'still_in_position': in_position,
        'position_unrealized': position_unrealized if in_position else 0,
    }


def run_analysis():
    """Run stop-loss simulation across multiple runs and parameter combinations."""
    
    # Get all runs
    print("Fetching run inventory...")
    runs_result = client.query("""
        SELECT session_id, run_id, any(symbol) as symbol,
               argMax(toFloat64(running_account_balance), timestamp) as final_balance,
               argMax(toFloat64(current_drawdown_pct), timestamp) as current_dd,
               countIf(event_type = 'position_closed') as closed_trades
        FROM sweep_wide_events
        GROUP BY session_id, run_id
        ORDER BY final_balance DESC
    """)
    runs = pd.DataFrame(runs_result.result_rows, columns=runs_result.column_names)
    print(f"Found {len(runs)} runs across {runs['session_id'].nunique()} sessions")
    print(f"Symbols: {runs['symbol'].unique()}")
    print()
    
    # Select representative runs for detailed analysis
    # Pick best and worst from each session, plus median
    representative_runs = []
    for sid in runs['session_id'].unique():
        session_runs = runs[runs['session_id'] == sid].sort_values('final_balance')
        symbol = session_runs.iloc[0]['symbol']
        n = len(session_runs)
        
        # Best, worst, and median
        representative_runs.append({
            'session_id': session_runs.iloc[-1]['session_id'],
            'run_id': session_runs.iloc[-1]['run_id'],
            'label': f'{symbol}_best',
            'symbol': symbol
        })
        representative_runs.append({
            'session_id': session_runs.iloc[0]['session_id'],
            'run_id': session_runs.iloc[0]['run_id'],
            'label': f'{symbol}_worst',
            'symbol': symbol
        })
        representative_runs.append({
            'session_id': session_runs.iloc[n//2]['session_id'],
            'run_id': session_runs.iloc[n//2]['run_id'],
            'label': f'{symbol}_median',
            'symbol': symbol
        })
    
    # Stop-loss parameter grid
    dd_thresholds = [-5, -8, -10, -12, -15, -20, -25, -30]
    wait_times = [0, 60, 240, 720, 1440, 2880]  # 0, 1h, 4h, 12h, 24h, 48h
    
    # Also run baseline (no stop) - threshold = -100 means never triggers
    all_params = [(-100, 0)] + list(product(dd_thresholds, wait_times))
    
    all_results = []
    
    for run_info in representative_runs:
        run_id = run_info['run_id']
        session_id = run_info['session_id']
        label = run_info['label']
        
        run_id = str(run_id)
        session_id = str(session_id)
        print(f"\n{'='*80}")
        print(f"Analyzing: {label} (run_id={run_id[:8]}...)")
        print(f"{'='*80}")
        
        print("  Fetching events...")
        df = fetch_run_events(run_id, session_id)
        print(f"  {len(df):,} events from {df['timestamp'].min()} to {df['timestamp'].max()}")
        
        for dd_thresh, wait_min in all_params:
            result = simulate_stop_loss(df, dd_thresh, wait_min)
            result['run_label'] = label
            result['run_id'] = run_id
            result['session_id'] = session_id
            all_results.append(result)
        
        # Print baseline vs best stop
        baseline = [r for r in all_results if r['run_label'] == label and r['dd_threshold'] == -100][0]
        best_stop = max(
            [r for r in all_results if r['run_label'] == label and r['dd_threshold'] != -100],
            key=lambda r: r['final_effective_balance']
        )
        
        print(f"\n  BASELINE (no stop):")
        print(f"    Final effective balance: ${baseline['final_effective_balance']:,.2f}")
        print(f"    Total return: {baseline['total_return_pct']:.1f}%")
        print(f"    Worst drawdown: {baseline['worst_drawdown']:.1f}%")
        print(f"    Still in position: {baseline['still_in_position']}")
        print(f"    Unrealized PnL: ${baseline['position_unrealized']:,.2f}")
        
        print(f"\n  BEST STOP ({best_stop['dd_threshold']}% / {best_stop['wait_minutes']}min):")
        print(f"    Final effective balance: ${best_stop['final_effective_balance']:,.2f}")
        print(f"    Total return: {best_stop['total_return_pct']:.1f}%")
        print(f"    Worst drawdown: {best_stop['worst_drawdown']:.1f}%")
        print(f"    Stops triggered: {best_stop['stop_count']}")
        print(f"    Total stop losses: ${best_stop['total_stop_losses']:,.2f}")
        print(f"    Still in position: {best_stop['still_in_position']}")
    
    # ── Summary table ──────────────────────────────────────────────────────
    print(f"\n\n{'='*120}")
    print("COMPREHENSIVE RESULTS MATRIX")
    print(f"{'='*120}")
    
    results_df = pd.DataFrame(all_results)
    
    # For each run label, show the parameter grid
    for label in results_df['run_label'].unique():
        label_df = results_df[results_df['run_label'] == label]
        baseline = label_df[label_df['dd_threshold'] == -100].iloc[0]
        
        print(f"\n{'─'*120}")
        print(f"  {label} | Baseline: ${baseline['final_effective_balance']:,.2f} ({baseline['total_return_pct']:.1f}%) | Worst DD: {baseline['worst_drawdown']:.1f}%")
        print(f"{'─'*120}")
        
        # Print header
        print(f"  {'DD Thresh':>10} | {'Wait':>6} | {'Final Balance':>14} | {'vs Baseline':>12} | {'Return%':>8} | {'Worst DD':>9} | {'Stops':>5} | {'Stop Losses':>12} | {'In Pos':>6}")
        print(f"  {'-'*10} | {'-'*6} | {'-'*14} | {'-'*12} | {'-'*8} | {'-'*9} | {'-'*5} | {'-'*12} | {'-'*6}")
        
        non_baseline = label_df[label_df['dd_threshold'] != -100].sort_values(
            ['dd_threshold', 'wait_minutes']
        )
        
        for _, row in non_baseline.iterrows():
            diff = row['final_effective_balance'] - baseline['final_effective_balance']
            diff_str = f"+${diff:,.0f}" if diff >= 0 else f"-${abs(diff):,.0f}"
            print(f"  {row['dd_threshold']:>9.0f}% | {row['wait_minutes']:>5.0f}m | ${row['final_effective_balance']:>13,.2f} | {diff_str:>12} | {row['total_return_pct']:>7.1f}% | {row['worst_drawdown']:>8.1f}% | {row['stop_count']:>5.0f} | ${row['total_stop_losses']:>11,.2f} | {'YES' if row['still_in_position'] else 'no':>6}")
    
    # ── Find globally optimal parameters ──────────────────────────────────
    print(f"\n\n{'='*120}")
    print("OPTIMAL PARAMETER ANALYSIS (averaged across all runs)")
    print(f"{'='*120}")
    
    non_baseline_df = results_df[results_df['dd_threshold'] != -100].copy()
    baselines = results_df[results_df['dd_threshold'] == -100][['run_label', 'final_effective_balance']].rename(
        columns={'final_effective_balance': 'baseline_balance'}
    )
    non_baseline_df = non_baseline_df.merge(baselines, on='run_label')
    non_baseline_df['improvement'] = non_baseline_df['final_effective_balance'] - non_baseline_df['baseline_balance']
    non_baseline_df['improvement_pct'] = (non_baseline_df['improvement'] / non_baseline_df['baseline_balance']) * 100
    
    # Average improvement by parameter combo
    param_summary = non_baseline_df.groupby(['dd_threshold', 'wait_minutes']).agg(
        avg_improvement_pct=('improvement_pct', 'mean'),
        avg_worst_dd=('worst_drawdown', 'mean'),
        avg_stops=('stop_count', 'mean'),
        wins=('improvement', lambda x: (x > 0).sum()),
        total=('improvement', 'count'),
        avg_return=('total_return_pct', 'mean'),
    ).reset_index()
    param_summary['win_rate'] = param_summary['wins'] / param_summary['total'] * 100
    param_summary = param_summary.sort_values('avg_improvement_pct', ascending=False)
    
    print(f"\n  {'DD Thresh':>10} | {'Wait':>6} | {'Avg Improvement':>16} | {'Avg Return':>11} | {'Avg DD':>8} | {'Avg Stops':>10} | {'Win Rate':>9}")
    print(f"  {'-'*10} | {'-'*6} | {'-'*16} | {'-'*11} | {'-'*8} | {'-'*10} | {'-'*9}")
    
    for _, row in param_summary.head(20).iterrows():
        print(f"  {row['dd_threshold']:>9.0f}% | {row['wait_minutes']:>5.0f}m | {row['avg_improvement_pct']:>+15.1f}% | {row['avg_return']:>10.1f}% | {row['avg_worst_dd']:>7.1f}% | {row['avg_stops']:>9.1f} | {row['win_rate']:>8.0f}%")
    
    # Save full results
    output_path = 'analysis/stop_loss_results.json'
    results_df.to_json(output_path, orient='records', indent=2)
    print(f"\n  Full results saved to {output_path}")
    
    return results_df


if __name__ == '__main__':
    results = run_analysis()
