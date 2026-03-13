/**
 * MarketDataResolver Unit Tests
 *
 * Covers the four canonical scenarios from the market-data-resolver contract:
 * IT1 - Resolves correct path for a same-month date range
 * IT2 - Throws SameMonthGuardError when start/end span different months
 * IT3 - Throws MarketDataNotFoundError when CSV file does not exist on disk
 * IT4 - Normalises trading pair slash (BTC/USDT → BTCUSDT)
 */

jest.mock('fs');

import * as fs from 'fs';
import * as path from 'path';
import { MarketDataResolver, SameMonthGuardError, MarketDataNotFoundError } from './MarketDataResolver';

const mockedExistsSync = jest.mocked(fs.existsSync);

describe('MarketDataResolver', () => {
  const marketDataDir = '/data/market';
  let resolver: MarketDataResolver;

  beforeEach(() => {
    resolver = new MarketDataResolver(marketDataDir);
    mockedExistsSync.mockClear();
  });

  it('IT1: resolves LTC/USDT to the correct CSV path for a same-month date range', () => {
    mockedExistsSync.mockReturnValue(true);

    const result = resolver.resolve('LTC/USDT', '2024-01-02', '2024-01-05');

    expect(result).toBe(path.join(marketDataDir, 'LTCUSDT-1m-2024-01.csv'));
    expect(mockedExistsSync).toHaveBeenCalledWith(path.join(marketDataDir, 'LTCUSDT-1m-2024-01.csv'));
  });

  it('IT2: throws SameMonthGuardError when start and end dates span different months', () => {
    expect(() => resolver.resolve('LTC/USDT', '2024-01-01', '2024-02-01')).toThrow(
      SameMonthGuardError,
    );
    expect(() => resolver.resolve('LTC/USDT', '2024-01-01', '2024-02-01')).toThrow(
      /must be in the same calendar month/,
    );
    // existsSync should never be called when same-month guard triggers
    expect(mockedExistsSync).not.toHaveBeenCalled();
  });

  it('IT3: throws MarketDataNotFoundError when CSV file does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(() => resolver.resolve('LTC/USDT', '2024-01-01', '2024-01-31')).toThrow(
      MarketDataNotFoundError,
    );
    expect(() => resolver.resolve('LTC/USDT', '2024-01-01', '2024-01-31')).toThrow(
      /Market data not found for LTCUSDT/,
    );
  });

  it('IT4: normalises slash in trading pair symbol (BTC/USDT → BTCUSDT)', () => {
    mockedExistsSync.mockReturnValue(true);

    const result = resolver.resolve('BTC/USDT', '2024-01-01', '2024-01-31');

    expect(result).toBe(path.join(marketDataDir, 'BTCUSDT-1m-2024-01.csv'));
  });
});
