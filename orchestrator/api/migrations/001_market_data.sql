-- Migration 001: Create market_data table for OHLCV candle storage
-- Engine: ReplacingMergeTree deduplicates on (symbol, timestamp) via background merges
-- Use FINAL modifier on SELECT queries for accurate gap detection (COUNT(*) FINAL)

CREATE DATABASE IF NOT EXISTS dca_bot;

CREATE TABLE IF NOT EXISTS dca_bot.market_data (
    symbol    String,
    timestamp DateTime64(3, 'UTC'),
    open      Float64,
    high      Float64,
    low       Float64,
    close     Float64,
    volume    Float64
) ENGINE = ReplacingMergeTree()
ORDER BY (symbol, timestamp);
