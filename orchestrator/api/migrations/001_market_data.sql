-- Migration 001: Create market_data table for OHLCV candle storage
-- Engine: ReplacingMergeTree deduplicates on (symbol, timestamp) via background merges
-- Use FINAL modifier on SELECT queries for accurate gap detection (COUNT(*) FINAL)

CREATE DATABASE IF NOT EXISTS data;

CREATE TABLE IF NOT EXISTS data.market_data (
    symbol    String,
    timestamp DateTime64(3, 'UTC'),
    open      Float64,
    high      Float64,
    low       Float64,
    close     Float64,
    volume    Float64
) ENGINE = ReplacingMergeTree()
ORDER BY (symbol, timestamp);

-- Sync ledger: records completed download ranges so GapResolver can distinguish
-- legitimate Binance downtime (swiss-cheese gaps) from data never fetched.
-- When BinanceDownloader finishes a range, it inserts a receipt here.
-- GapResolver checks this table first — if covered, COUNT(*) FINAL is skipped
-- and the range is accepted as-is, preventing infinite re-download loops.
CREATE TABLE IF NOT EXISTS data.market_data_syncs (
    symbol      String,
    synced_from DateTime64(3, 'UTC'),
    synced_to   DateTime64(3, 'UTC'),
    synced_at   DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree()
ORDER BY (symbol, synced_from, synced_to);
