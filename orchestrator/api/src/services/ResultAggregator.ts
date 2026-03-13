/**
 * ResultAggregator - Aggregates Event Bus stream into comprehensive PnlSummary
 *
 * Processes a sequence of TradeEvent objects emitted by the Core Engine
 * and computes: total P&L, ROI, drawdown, fill counts, and safety order usage.
 */

import Decimal from 'decimal.js';
import {
  TradeEvent,
  PositionOpenedEvent,
  OrderFilledEvent,
  PositionClosedEvent,
  LiquidationEvent,
  GapDownEvent,
  PnlSummary,
} from '../types/index.js';
import * as PrecisionFormatter from '../utils/PrecisionFormatter.js';

/**
 * ResultAggregator - Computes aggregated position metrics from events
 *
 * Responsibility: Transform raw event stream into structured PnlSummary with:
 * - Total P&L and realized/unrealized components
 * - ROI percentage calculation
 * - Maximum drawdown tracking
 * - Safety order usage frequency
 * - Full precision with Decimal.js
 *
 * @example
 * const aggregator = new ResultAggregator();
 * const summary = await aggregator.aggregateEvents(events);
 * console.log(summary.total_fills); // 3
 * console.log(summary.safety_order_usage_counts); // { "0": 1, "1": 2 }
 */
export class ResultAggregator {
  /**
   * Aggregates a sequence of TradeEvents into a comprehensive PnlSummary
   *
   * @param events - Array of TradeEvent in chronological order
   * @returns PnlSummary with computed metrics
   * @throws Error if events not in timestamp order or missing required fields
   *
   * Algorithm:
   * 1. Validate events in timestamp order
   * 2. Extract entry price, quantity, fee from PositionOpenedEvent (required, first)
   * 3. For each OrderFilledEvent: update filled quantity, track safety_order_index
   * 4. For GapDownEvent: count fills in filled_orders array by safety_order_index
   * 5. For LiquidationEvent: track liquidation_fee, mark status LIQUIDATED
   * 6. For PositionClosedEvent: extract close_price (required, final)
   * 7. Compute:
   *    - total_invested = entry_price × initial_quantity + entry_fee
   *    - final_position_value = sum of all filled quantities × close_price
   *    - total_pnl = final_position_value - total_invested - trading_fees
   *    - roi_percent = (total_pnl / total_invested) × 100
   *    - max_drawdown_percent = (trough_balance - peak_balance) / peak_balance × 100
   * 8. Count fills per safety_order_index in safety_order_usage_counts
   */
  async aggregateEvents(events: TradeEvent[]): Promise<PnlSummary> {
    // Handle empty events: return zeroed-out summary (valid business scenario - no trades)
    if (events.length === 0) {
      return {
        total_pnl: '0.00000000',
        entry_fee: '0.00000000',
        trading_fees: '0.00000000',
        total_fees: '0.00000000',
        roi_percent: '0.00000000',
        total_fills: 0,
        realized_pnl: '0.00000000',
        safety_order_usage_counts: {},
      };
    }

    // Validate chronological order
    for (let i = 1; i < events.length; i++) {
      if (events[i].timestamp < events[i - 1].timestamp) {
        throw new Error(
          `Events not in chronological order: event[${i}] (${events[i].timestamp}) < event[${i - 1}] (${events[i - 1].timestamp})`
        );
      }
    }

    // Initialize state
    let entryPrice: Decimal | null = null;
    let initialQuantity: Decimal | null = null;
    let entryFee: Decimal | null = null;
    let closePrice: Decimal | null = null;
    let totalFilledQuantity = new Decimal(0);
    let totalFilledCost = new Decimal(0); // Total price*qty for all fills (excluding fees)
    let totalTradingFees = new Decimal(0);
    let liquidationFee: Decimal | null = null;
    const safetyOrderUsageCounts: Record<number, number> = {};
    let peakBalance = new Decimal(0);
    let troughBalance = new Decimal(Number.MAX_SAFE_INTEGER);

    // Process events
    for (const event of events) {
      switch (event.type) {
        case 'PositionOpened': {
          const openEvent = event as PositionOpenedEvent;
          entryPrice = new Decimal(openEvent.entry_price);
          initialQuantity = new Decimal(openEvent.initial_quantity);
          entryFee = new Decimal(openEvent.entry_fee);
          break;
        }

        case 'OrderFilled': {
          const fillEvent = event as OrderFilledEvent;
          const price = new Decimal(fillEvent.price);
          const quantity = new Decimal(fillEvent.quantity);
          const fee = new Decimal(fillEvent.fee);

          totalFilledQuantity = totalFilledQuantity.plus(quantity);
          totalFilledCost = totalFilledCost.plus(price.times(quantity));
          totalTradingFees = totalTradingFees.plus(fee);

          // Track safety order usage
          const index = fillEvent.safety_order_index;
          safetyOrderUsageCounts[index] = (safetyOrderUsageCounts[index] ?? 0) + 1;

          // Update drawdown tracking (approximation: balance after each fill)
          const approximateBalance = totalFilledQuantity.times(price).minus(totalTradingFees);
          if (approximateBalance.greaterThan(peakBalance)) {
            peakBalance = approximateBalance;
          }
          if (approximateBalance.lessThan(troughBalance)) {
            troughBalance = approximateBalance;
          }
          break;
        }

        case 'GapDownEvent': {
          const gapEvent = event as GapDownEvent;
          for (const fill of gapEvent.filled_orders) {
            const index = fill.safety_order_index;
            safetyOrderUsageCounts[index] = (safetyOrderUsageCounts[index] ?? 0) + 1;
          }
          break;
        }

        case 'LiquidationEvent': {
          const liquidEvent = event as LiquidationEvent;
          liquidationFee = new Decimal(liquidEvent.liquidation_fee);
          closePrice = new Decimal(liquidEvent.liquidation_price);
          break;
        }

        case 'PositionClosed': {
          const closeEvent = event as PositionClosedEvent;
          closePrice = new Decimal(closeEvent.close_price);
          break;
        }
      }
    }

    // Validate required fields
    if (!entryPrice || !initialQuantity || !entryFee) {
      throw new Error('Missing PositionOpenedEvent or required fields');
    }

    // Compute metrics
    // Total invested = (entry_price * initial_qty + entry_fee) + sum(fill_price * fill_qty)
    const totalInvested = entryPrice.times(initialQuantity).plus(entryFee).plus(totalFilledCost);
    let totalPnl = new Decimal(0);
    let realizedPnl = new Decimal(0);
    let unrealizedPnl: Decimal | undefined;

    if (closePrice) {
      // Position closed
      // Final value = close_price * (initial_quantity + sum of all fills)
      const totalQuantityAtClose = initialQuantity.plus(totalFilledQuantity);
      const finalValue = totalQuantityAtClose.times(closePrice);
      totalPnl = finalValue.minus(totalInvested).minus(totalTradingFees);
      if (liquidationFee) {
        totalPnl = totalPnl.minus(liquidationFee);
      }
      realizedPnl = totalPnl;
    } else {
      // Position still open (unrealized)
      unrealizedPnl = new Decimal(0); // Would need current market price to calculate
    }

    // Calculate ROI
    const roiPercent = totalInvested.isZero()
      ? new Decimal(0)
      : totalPnl.dividedBy(totalInvested).times(100);

    // Calculate max drawdown
    let maxDrawdownPercent: Decimal | undefined;
    if (!peakBalance.isZero() && troughBalance.isFinite()) {
      const drawdown = troughBalance.minus(peakBalance).dividedBy(peakBalance).times(100);
      maxDrawdownPercent = drawdown;
    }

    // Compute total fees
    const allFees = entryFee.plus(totalTradingFees);
    const allFeesWithLiquidation = liquidationFee ? allFees.plus(liquidationFee) : allFees;

    // Return PnlSummary
    return {
      total_pnl: PrecisionFormatter.formatPrice(totalPnl),
      entry_fee: PrecisionFormatter.formatPrice(entryFee),
      trading_fees: PrecisionFormatter.formatPrice(totalTradingFees),
      liquidation_fee: liquidationFee ? PrecisionFormatter.formatPrice(liquidationFee) : undefined,
      total_fees: PrecisionFormatter.formatPrice(allFeesWithLiquidation),
      roi_percent: PrecisionFormatter.formatPercentage(roiPercent),
      max_drawdown_percent: maxDrawdownPercent ? PrecisionFormatter.formatPercentage(maxDrawdownPercent) : undefined,
      total_fills: Object.values(safetyOrderUsageCounts).reduce((a, b) => a + b, 0),
      realized_pnl: PrecisionFormatter.formatPrice(realizedPnl),
      unrealized_pnl: unrealizedPnl ? PrecisionFormatter.formatPrice(unrealizedPnl) : undefined,
      safety_order_usage_counts: safetyOrderUsageCounts,
    };
  }

  /**
   * Aggregates raw Go engine events (new format) into a PnlSummary.
   *
   * Go engine emits:
   *   { type: "PositionOpened",         data: { configured_orders: [...] } }
   *   { type: "BuyOrderExecuted",        data: { price, base_size, fee, order_number, … } }
   *   { type: "SellOrderExecuted",       data: { price, base_size, profit, fee } }  ← always paired with PositionClosed
   *   { type: "PositionClosed",          data: { closing_price, size, profit, reason } }  ← authoritative P&L
   *   { type: "LiquidationPriceUpdated", … }  ← noise, ignored
   *   { type: "price.changed",           … }  ← noise, ignored
   *
   * ROI formula: (realizedPnL / accountBalance) × 100
   * accountBalance comes from final_position.total_invested (= configured account size)
   *
   * NOTE: BuyOrderExecuted.size is the fractional amount from ComputeAmountSequence,
   * NOT the USDT quote amount.  Do NOT use it as a totalInvested base.
   *
   * @param rawGoEvents  - Raw events array from Go engine stdout
   * @param accountBalance - String decimal from final_position.total_invested (e.g. "1000")
   */
  async aggregateGoEvents(rawGoEvents: any[], accountBalance: string = '0'): Promise<PnlSummary> {
    if (rawGoEvents.length === 0) {
      return {
        total_pnl: '0.00000000',
        entry_fee: '0.00000000',
        trading_fees: '0.00000000',
        total_fees: '0.00000000',
        roi_percent: '0.00000000',
        total_fills: 0,
        realized_pnl: '0.00000000',
        safety_order_usage_counts: {},
      };
    }

    // accountBalance is the configured capital size (denominator for ROI)
    const accBalance = new Decimal(accountBalance || '0');

    let entryFee = new Decimal(0);    // fee on order_number=1 (entry buy)
    let tradingFees = new Decimal(0); // cumulative fees on all buys
    let realizedPnl = new Decimal(0); // authoritative: from PositionClosed only
    let totalFills = 0;
    const safetyOrderUsageCounts: Record<number, number> = {};
    let entryFeeSet = false;

    for (const event of rawGoEvents) {
      const type = event.type as string;
      const d: any = event.data ?? {};

      if (type === 'BuyOrderExecuted') {
        // fee is in quote currency (USDT)
        const fee      = new Decimal(d.fee  ?? '0');
        const orderNum = (d.order_number as number) ?? 1;

        tradingFees = tradingFees.plus(fee);

        if (!entryFeeSet && orderNum === 1) {
          entryFee    = fee;
          entryFeeSet = true;
        }

        totalFills++;
        // soIndex = orderNum - 1: entry (order 1) = index 0, SO#1 (order 2) = index 1, …
        const soIndex = orderNum - 1;
        safetyOrderUsageCounts[soIndex] = (safetyOrderUsageCounts[soIndex] ?? 0) + 1;

      } else if (type === 'PositionClosed') {
        // PositionClosed.profit is the authoritative realized P&L for the whole trade.
        // SellOrderExecuted also emits a profit field but it duplicates this value.
        // We read ONLY from PositionClosed to avoid double-counting.
        realizedPnl = new Decimal(d.profit ?? '0');
      }
      // SellOrderExecuted, LiquidationPriceUpdated, price.changed → ignored
    }

    const totalPnl  = realizedPnl;
    const totalFees = entryFee.plus(tradingFees);

    // ROI = (realized P&L / account balance) × 100
    const roiPercent = accBalance.isZero()
      ? new Decimal(0)
      : totalPnl.dividedBy(accBalance).times(100);

    return {
      total_pnl:    PrecisionFormatter.formatPrice(totalPnl),
      entry_fee:    PrecisionFormatter.formatPrice(entryFee),
      trading_fees: PrecisionFormatter.formatPrice(tradingFees),
      total_fees:   PrecisionFormatter.formatPrice(totalFees),
      roi_percent:  PrecisionFormatter.formatPercentage(roiPercent),
      total_fills:  totalFills,
      realized_pnl: PrecisionFormatter.formatPrice(realizedPnl),
      safety_order_usage_counts: safetyOrderUsageCounts,
    };
  }
}
