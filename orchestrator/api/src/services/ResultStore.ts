/**
 * ResultStore (T029)
 *
 * Persists backtest results to disk with SQLite index for fast queries.
 *
 * Storage backends:
 * - File-based: JSON files in storagePath/results/{request_id}.json
 * - SQLite: Index table for queries and TTL tracking
 *
 * Methods:
 * - save(result): Write JSON + insert SQLite row
 * - retrieve(request_id): Read JSON by ID
 * - queryByDateRange(from, to): SQLite query with pagination
 * - cleanup(): Delete expired files + DB rows
 */

import fs from 'fs/promises';
import path from 'path';
import { BacktestResult, BacktestResultPage } from '../types';
import { StorageError } from '../types/errors';
import { ErrorCode } from '../types/errors';

/**
 * In-memory index for MVP (SQLite integration can be added in Phase 5)
 * Maps request_id -> metadata for fast queries
 */
interface ResultMetadata {
  request_id: string;
  timestamp: string;
  status: 'success' | 'failed';
  ttl_expires_at: number; // Unix timestamp
}

/**
 * ResultStore - Manages backtest result persistence and retrieval
 */
export class ResultStore {
  private resultsDir: string;
  private ttlDays: number;
  private index: Map<string, ResultMetadata> = new Map();
  private indexFilePath: string;
  private _writeQueue: Promise<void> = Promise.resolve();

  /**
   * Constructor
   *
   * @param storagePath Root directory for result storage
   * @param ttlDays Time-to-live in days (default 7)
   */
  constructor(storagePath: string, ttlDays: number = 7) {
    this.resultsDir = path.join(storagePath, 'results');
    this.ttlDays = ttlDays;
    this.indexFilePath = path.join(storagePath, 'index.json');
  }

  /**
   * Initialize storage: create directories and load index
   */
  async initialize(): Promise<void> {
    try {
      // Create results directory if not exists
      await fs.mkdir(this.resultsDir, { recursive: true });

      // Load index from disk if exists
      try {
        const indexData = await fs.readFile(this.indexFilePath, 'utf-8');
        const parsed = JSON.parse(indexData);
        this.index = new Map(parsed);
      } catch {
        // Index doesn't exist yet, start with empty
        this.index = new Map();
      }
    } catch (error: any) {
      throw new StorageError(
        `Failed to initialize result store: ${error.message}`,
        ErrorCode.STORAGE_WRITE_ERROR,
        'save',
        { path: this.resultsDir },
      );
    }
  }

  /**
   * Save backtest result to disk and index
   *
   * @param result BacktestResult to save
   * @throws StorageError if save fails
   */
  async save(result: BacktestResult): Promise<void> {
    try {
      // Write JSON result to disk
      const resultPath = path.join(this.resultsDir, `${result.request_id}.json`);
      await fs.writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');

      // Add to in-memory index
      const ttlExpiresAt = Date.now() + this.ttlDays * 24 * 60 * 60 * 1000;
      const metadata: ResultMetadata = {
        request_id: result.request_id,
        timestamp: result.timestamp,
        status: result.status,
        ttl_expires_at: ttlExpiresAt,
      };
      this.index.set(result.request_id, metadata);

      // Persist index to disk
      await this.persistIndex();
    } catch (error: any) {
      throw new StorageError(
        `Failed to save result ${result.request_id}: ${error.message}`,
        ErrorCode.STORAGE_WRITE_ERROR,
        'save',
        { request_id: result.request_id },
      );
    }
  }

  /**
   * Retrieve result by request_id
   *
   * @param requestId Request ID to retrieve
   * @returns BacktestResult if found
   * @throws StorageError if not found, expired, or read fails
   */
  async retrieve(requestId: string): Promise<BacktestResult> {
    try {
      // Check index
      const metadata = this.index.get(requestId);
      if (!metadata) {
        throw new StorageError(
          `Result not found: ${requestId}`,
          ErrorCode.STORAGE_RETRIEVE_ERROR,
          'retrieve',
          { request_id: requestId },
        );
      }

      // Check expiration
      if (metadata.ttl_expires_at < Date.now()) {
        this.index.delete(requestId);
        await this.persistIndex();
        throw new StorageError(
          `Result expired: ${requestId}`,
          ErrorCode.STORAGE_RETRIEVE_ERROR,
          'retrieve',
          { request_id: requestId, expired: true },
        );
      }

      // Read JSON from disk
      const resultPath = path.join(this.resultsDir, `${requestId}.json`);
      const data = await fs.readFile(resultPath, 'utf-8');
      const result = JSON.parse(data) as BacktestResult;

      return result;
    } catch (error: any) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to retrieve result ${requestId}: ${error.message}`,
        ErrorCode.STORAGE_RETRIEVE_ERROR,
        'retrieve',
        { request_id: requestId },
      );
    }
  }

  /**
   * Query results by date range with pagination
   *
   * @param from Start date (ISO string or Date)
   * @param to End date (ISO string or Date)
   * @param status Filter by status ('success' | 'failed' | 'all')
   * @param pageNumber Page number (0-indexed)
   * @param pageSize Results per page (default 50)
   * @returns BacktestResultPage with pagination metadata
   */
  async queryByDateRange(
    from: string | Date,
    to: string | Date,
    status: 'success' | 'failed' | 'all' = 'all',
    pageNumber: number = 0,
    pageSize: number = 50,
  ): Promise<BacktestResultPage> {
    try {
      const fromDate = typeof from === 'string' ? new Date(from) : from;
      const toDate = typeof to === 'string' ? new Date(to) : to;

      // Filter index by date range and status
      const filtered = Array.from(this.index.values()).filter((meta) => {
        const metaDate = new Date(meta.timestamp);
        const inRange = metaDate >= fromDate && metaDate <= toDate;
        const statusMatch = status === 'all' || meta.status === status;
        return inRange && statusMatch;
      });

      // Sort by timestamp descending
      filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Paginate
      const totalCount = filtered.length;
      const start = pageNumber * pageSize;
      const end = start + pageSize;
      const pageResults = filtered.slice(start, end);

      // Load actual results from disk
      const results: BacktestResult[] = [];
      for (const meta of pageResults) {
        try {
          const result = await this.retrieve(meta.request_id);
          results.push(result);
        } catch {
          // Skip if failed to retrieve
          continue;
        }
      }

      return {
        results,
        pagination: {
          total_count: totalCount,
          page_size: pageSize,
          page_number: pageNumber,
          has_more: end < totalCount,
        },
        filters: {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          status: status === 'all' ? undefined : status,
        },
      };
    } catch (error: any) {
      throw new StorageError(
        `Failed to query results: ${error.message}`,
        ErrorCode.STORAGE_RETRIEVE_ERROR,
        'query',
        { from, to, status },
      );
    }
  }

  /**
   * Clean up expired results (files + index)
   *
   * @returns Number of deleted results
   */
  async cleanup(): Promise<number> {
    try {
      const now = Date.now();
      let deleteCount = 0;

      // Find expired entries
      const toDelete: string[] = [];
      for (const [requestId, meta] of this.index.entries()) {
        if (meta.ttl_expires_at < now) {
          toDelete.push(requestId);
        }
      }

      // Delete files and remove from index
      for (const requestId of toDelete) {
        try {
          const resultPath = path.join(this.resultsDir, `${requestId}.json`);
          await fs.unlink(resultPath);
          this.index.delete(requestId);
          deleteCount++;
        } catch {
          // Continue even if single file deletion fails
        }
      }

      // Persist updated index
      if (deleteCount > 0) {
        await this.persistIndex();
      }

      return deleteCount;
    } catch (error: any) {
      throw new StorageError(
        `Failed to cleanup expired results: ${error.message}`,
        ErrorCode.STORAGE_WRITE_ERROR,
        'cleanup',
      );
    }
  }

  /**
   * Persist in-memory index to disk
   * Called after save() and cleanup()
   */
  private persistIndex(): Promise<void> {
    // Chain writes to avoid concurrent EBUSY errors on Windows.
    // Each write reads the latest index state at execution time.
    this._writeQueue = this._writeQueue.catch(() => {}).then(async () => {
      const indexData = Array.from(this.index.entries());
      await fs.writeFile(this.indexFilePath, JSON.stringify(indexData, null, 2), 'utf-8');
    });
    return this._writeQueue;
  }
}
