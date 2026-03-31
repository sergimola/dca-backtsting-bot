
CREATE TABLE IF NOT EXISTS data.wide_events (
        schema_version    UInt8,
        run_id            String,
        trade_id          String,
        timestamp         DateTime64(3, 'UTC'),
        event_type        LowCardinality(String),
        symbol            LowCardinality(String),
        candle_open       Decimal128(8),
        candle_high       Decimal128(8),
        candle_low        Decimal128(8),
        candle_close      Decimal128(8),
        candle_volume     Decimal128(8),
        running_account_balance Decimal128(8),
        global_candle_count UInt32,
        position_state    LowCardinality(String),
        average_entry_price Decimal128(8),
        position_quantity Decimal128(8),
        total_capital_deployed Decimal128(8),
        fees_accumulated  Decimal128(8),
        take_profit_price Decimal128(8),
        liquidation_price Decimal128(8),
        filled_orders_count UInt16,
        unrealized_pnl    Decimal128(8),
        current_drawdown_pct Decimal128(8),
        action_price      Decimal128(8),
        action_quantity   Decimal128(8),
        action_fee        Decimal128(8),
        order_number      UInt16,
        realized_pnl      Decimal128(8),
        close_reason      LowCardinality(String)
      )
      ENGINE = ReplacingMergeTree()
      PARTITION BY run_id
      ORDER BY (run_id, timestamp, event_type)