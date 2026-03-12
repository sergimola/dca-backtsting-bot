/**
 * Idempotency Cache (T030)
 *
 * Optional feature for MVP - prevents duplicate processing of requests
 * with same idempotency_key.
 *
 * Stores: { idempotency_key: { request_id, result, created_at } }
 * TTL: Same as result TTL (7 days)
 */

import { BacktestResult } from '../types/index.js';

/**
 * Cached entry structure
 */
interface CachedEntry {
  request_id: string;
  result: BacktestResult;
  created_at: number; // Unix timestamp
}

/**
 * IdempotencyCache - In-memory cache for idempotency keys
 *
 * For MVP, uses in-memory storage. For production, integrate with Redis.
 */
export class IdempotencyCache {
  private cache: Map<string, CachedEntry> = new Map();
  private ttlMs: number;

  /**
   * Constructor
   *
   * @param ttlDays Time-to-live in days (default 7, matching ResultStore)
   */
  constructor(ttlDays: number = 7) {
    this.ttlMs = ttlDays * 24 * 60 * 60 * 1000;

    // Periodically clean up expired entries (every 1 hour)
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  /**
   * Get cached result by idempotency_key
   *
   * @param idempotencyKey UUID idempotency key
   * @returns Cached BacktestResult if found and not expired, undefined otherwise
   */
  get(idempotencyKey: string): BacktestResult | undefined {
    const entry = this.cache.get(idempotencyKey);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.created_at > this.ttlMs) {
      this.cache.delete(idempotencyKey);
      return undefined;
    }

    return entry.result;
  }

  /**
   * Set cache entry for idempotency_key
   *
   * @param idempotencyKey UUID idempotency key
   * @param requestId Request ID
   * @param result BacktestResult
   */
  set(idempotencyKey: string, requestId: string, result: BacktestResult): void {
    this.cache.set(idempotencyKey, {
      request_id: requestId,
      result,
      created_at: Date.now(),
    });
  }

  /**
   * Clean up expired entries
   *
   * @returns Number of entries removed
   */
  private cleanup(): number {
    const now = Date.now();
    let removeCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.created_at > this.ttlMs) {
        this.cache.delete(key);
        removeCount++;
      }
    }

    return removeCount;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      total_entries: this.cache.size,
    };
  }
}
