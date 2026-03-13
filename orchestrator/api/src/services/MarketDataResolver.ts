/**
 * MarketDataResolver — maps (trading_pair, startDate, endDate) to a filesystem CSV path.
 *
 * File naming convention: {SYMBOL}-1m-{YYYY}-{MM}.csv
 * where SYMBOL = tradingPair.replace('/', '').toUpperCase()
 */

import * as fs from 'fs';
import * as path from 'path';
import { ErrorCode } from '../types/errors.js';

/**
 * Thrown when start_date and end_date span more than one calendar month.
 * Multi-month backtests are not yet supported (MVP guard).
 */
export class SameMonthGuardError extends Error {
  public readonly errorCode = ErrorCode.VALIDATION_OUT_OF_BOUNDS;

  constructor(startMonth: string, endMonth: string) {
    super(
      `start_date (${startMonth}) and end_date (${endMonth}) must be in the same calendar month. ` +
        `Multi-month backtests are not yet supported.`,
    );
    this.name = 'SameMonthGuardError';
  }
}

/**
 * Thrown when the expected CSV file does not exist on the filesystem.
 */
export class MarketDataNotFoundError extends Error {
  public readonly errorCode = ErrorCode.CSV_FILE_NOT_FOUND;

  constructor(symbol: string, yearMonth: string, filePath: string) {
    super(
      `Market data not found for ${symbol} (${yearMonth}). Expected: ${path.basename(filePath)}`,
    );
    this.name = 'MarketDataNotFoundError';
  }
}

/**
 * Resolves a trading pair and date range to a concrete CSV file path.
 *
 * @example
 * const resolver = new MarketDataResolver('./data/market');
 * const csvPath = resolver.resolve('LTC/USDT', '2024-01-02', '2024-01-31');
 * // → './data/market/LTCUSDT-1m-2024-01.csv'
 */
export class MarketDataResolver {
  constructor(private readonly marketDataDir: string) {}

  /**
   * Resolves the CSV file path for a given trading pair and date range.
   *
   * @param tradingPair - e.g. "LTC/USDT"
   * @param startDate   - ISO 8601 date string, e.g. "2024-01-02"
   * @param endDate     - ISO 8601 date string, e.g. "2024-01-31"
   * @returns Path to the CSV file
   * @throws SameMonthGuardError if start/end span more than one calendar month
   * @throws MarketDataNotFoundError if the expected CSV file does not exist
   */
  resolve(tradingPair: string, startDate: string, endDate: string): string {
    // 1. Normalise symbol: "LTC/USDT" → "LTCUSDT"
    const symbol = tradingPair.replace('/', '').toUpperCase();

    // 2. Extract YYYY-MM from dates (first 7 chars of ISO string)
    const startMonth = startDate.substring(0, 7);
    const endMonth = endDate.substring(0, 7);

    // 3. MVP guard: start and end must be in the same calendar month
    if (startMonth !== endMonth) {
      throw new SameMonthGuardError(startMonth, endMonth);
    }

    // 4. Build filename: e.g. "LTCUSDT-1m-2024-01.csv"
    const [yyyy, mm] = startMonth.split('-');
    const filename = `${symbol}-1m-${yyyy}-${mm}.csv`;

    // 5. Build full path
    const filePath = path.join(this.marketDataDir, filename);

    // 6. Check existence
    if (!fs.existsSync(filePath)) {
      throw new MarketDataNotFoundError(symbol, startMonth, filePath);
    }

    return filePath;
  }
}
