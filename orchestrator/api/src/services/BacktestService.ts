/**
 * BacktestService - Manages Core Engine subprocess execution and event streaming
 *
 * Spawns Core Engine as a child process, streams backtest configuration via stdin,
 * reads NDJSON output line-by-line with readline, routes progress lines to an optional
 * progressHandler callback, and captures the final result line.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { ApiBacktestRequest, BacktestExecuteOptions, BacktestExecutionResult, EngineResultLine } from '../types/index.js';
import { ProcessError } from '../types/errors.js';
import * as fs from 'fs';

/**
 * BacktestService - Handles subprocess lifecycle and event streaming
 *
 * Responsibilities:
 * - Spawn Core Engine binary as child_process.spawn()
 * - Stream configuration to stdin as JSON + newline
 * - Parse NDJSON stdout line-by-line via readline (US3)
 * - Route "progress" lines to optional progressHandler callback
 * - Route "result" line to resolve BacktestExecutionResult
 * - Enforce 30-second timeout with SIGTERM → SIGKILL escalation
 * - Capture stderr for error mapping
 * - Track execution time with high-resolution timer
 *
 * @example
 * const service = new BacktestService('/path/to/core-engine');
 * const result = await service.execute(backtestRequest, {}, 30000);
 * console.log(`${result.tradeEvents.length} trades in ${result.engineExecutionTimeMs}ms`);
 */
export class BacktestService {
  private binaryPath: string;
  private logger?: any;
  public timeoutMs: number;

  /**
   * @param binaryPath - Path to Core Engine binary (Go executable or Node.js mock)
   * @param options - Configuration options
   * @param options.timeoutMs - Timeout in milliseconds (default 30000)
   * @param options.logger - Optional logger for debug output
   */
  constructor(binaryPath: string, options?: { timeoutMs?: number; logger?: any }) {
    this.binaryPath = binaryPath;
    this.logger = options?.logger;
    this.timeoutMs = options?.timeoutMs ?? 30000;

    // Verify binary exists (on Windows, also check for .exe extension)
    if (!fs.existsSync(binaryPath) && !fs.existsSync(binaryPath + '.exe')) {
      throw new Error(`Core Engine binary not found: ${binaryPath} or ${binaryPath}.exe`);
    }

    // Use .exe version if it exists on Windows
    if (!fs.existsSync(binaryPath) && fs.existsSync(binaryPath + '.exe')) {
      this.binaryPath = binaryPath + '.exe';
    }
  }

  /**
   * Executes backtest with Core Engine binary
   *
   * @param request - ApiBacktestRequest with configuration (market_data_csv_path appended by resolver)
   * @param timeoutMs - Timeout in milliseconds (default from constructor)
   * @returns BacktestExecutionResult with events array and execution time
   * @throws ProcessError if subprocess fails or times out
   *
   * Process lifecycle:
   * 1. Spawn child_process with stdio pipes
   * 2. Write JSON request to stdin
   * 3. Stream stdout through ndjson parser, accumulate TradeEvent[]
   * 4. Set timeout timer: SIGTERM at timeoutMs, then SIGKILL 2s later
   * 5. On exit: check exit code, map errors, return result or throw
   *
   * @example
   * try {
   *   const result = await service.execute(request, 30000);
   *   console.log(`${result.tradeEvents.length} trades in ${result.engineExecutionTimeMs}ms`);
   * } catch (error) {
   *   if (error instanceof ProcessError) {
   *     console.error(`Exit: ${error.exitCode}, Signal: ${error.signal}`);
   *     console.error(`Stderr: ${error.stderr}`);
   *   }
   * }
   */
  async execute(
    request: ApiBacktestRequest & {
      clickhouse_addr: string;
      clickhouse_db: string;
      clickhouse_user: string;
      clickhouse_password: string;
    },
    options?: BacktestExecuteOptions,
    timeoutMs?: number
  ): Promise<BacktestExecutionResult> {
    const timeout = timeoutMs ?? this.timeoutMs;
    return this.executeInternal(request, timeout, [], options);
  }

  /**
   * Executes backtest with additional flags (for testing with mock binary)
   */
  async executeWithStderr(
    request: ApiBacktestRequest & {
      clickhouse_addr: string;
      clickhouse_db: string;
      clickhouse_user: string;
      clickhouse_password: string;
    },
    flags: string[] = []
  ): Promise<BacktestExecutionResult> {
    return this.executeInternal(request, this.timeoutMs, flags);
  }

  /**
   * Internal implementation of execute with optional flags and options.
   */
  private async executeInternal(
    request: ApiBacktestRequest & {
      clickhouse_addr: string;
      clickhouse_db: string;
      clickhouse_user: string;
      clickhouse_password: string;
    },
    timeoutMs: number,
    flags: string[] = [],
    options?: BacktestExecuteOptions
  ): Promise<BacktestExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      let stderr = '';

      // Determine if we need to use 'node' (for .js files on Windows)
      let command: string;
      let args: string[];

      // T029: prepend --log-level and --progress-interval-ms CLI flags
      const engineFlags = [
        `--log-level=${process.env.ENGINE_LOG_LEVEL ?? 'INFO'}`,
        `--progress-interval-ms=${process.env.ENGINE_PROGRESS_INTERVAL_MS ?? '250'}`,
        ...flags,
      ];

      if (this.binaryPath.endsWith('.js')) {
        // Node.js script (mock binary)
        command = 'node';
        args = [this.binaryPath, ...engineFlags];
      } else {
        // Direct executable
        command = this.binaryPath;
        args = engineFlags;
      }

      // Spawn child process
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      });

      // Handle timeout by sending SIGTERM
      let timeoutHandle: NodeJS.Timeout | null = null;
      let killHandle: NodeJS.Timeout | null = null;

      const setupTimeout = () => {
        timeoutHandle = setTimeout(() => {
          if (this.logger) {
            this.logger.warn('Timeout: Sending SIGTERM to child process');
          }
          child.kill('SIGTERM');

          // Schedule SIGKILL 2 seconds later if process still alive
          killHandle = setTimeout(() => {
            if (this.logger) {
              this.logger.warn('Process still alive after SIGTERM, sending SIGKILL');
            }
            child.kill('SIGKILL');
          }, 2000);
        }, timeoutMs);
      };

      const clearTimeouts = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killHandle) clearTimeout(killHandle);
      };

      setupTimeout();

      // Capture stderr for error mapping
      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const stderrOutput = data.toString();
          stderr += stderrOutput;
          console.error('[Go Engine Error]:', stderrOutput);
        });
      }

      // T027: Replace stdoutBuffer + data event with readline interface.
      // Each line is a complete NDJSON object. Route by "type" field.
      let resultLine: EngineResultLine | null = null;
      const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity, terminal: false });

      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let parsed: any;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Non-JSON stdout lines are discarded (e.g., debug output from mock binary)
          return;
        }
        if (parsed?.type === 'progress') {
          // Fire-and-forget: progress handler errors must not crash the backtest
          if (options?.progressHandler) {
            options.progressHandler(parsed).catch(console.warn);
          }
        } else if (parsed?.type === 'result') {
          resultLine = parsed as EngineResultLine;
        }
        // Lines with unknown type are silently discarded
      });

      // Handle process exit
      child.on('exit', (exitCode, signal) => {
        clearTimeouts();
        rl.close();
        const executionTimeMs = Math.round(performance.now() - startTime);

        if (this.logger) {
          this.logger.info(`Process exited: code=${exitCode}, signal=${signal}, time=${executionTimeMs}ms`);
        }

        // Success: exit code 0
        if (exitCode === 0) {
          if (resultLine) {
            resolve(mapResultLine(resultLine));
          } else {
            // Engine exited cleanly but no result line was received
            reject(new ProcessError(exitCode, signal, stderr,
              'Core Engine exited with code 0 but produced no result line'));
          }
          return;
        }

        // Failure: non-zero exit code or signal
        const errorMessage = `Core Engine exited with code ${exitCode}${signal ? ` and signal ${signal}` : ''}${stderr ? `\n[stderr]: ${stderr}` : ''}`;
        reject(new ProcessError(exitCode, signal, stderr, errorMessage));
      });

      // Handle spawn errors
      child.on('error', (error) => {
        clearTimeouts();
        rl.close();
        reject(new ProcessError(null, null, error.message, `Failed to spawn Core Engine: ${error.message}`));
      });

      // Build an explicit engine payload — guarantees field presence and correct types.
      const enginePayload: Record<string, unknown> = {
        trading_pair:                 String(request.trading_pair),
        start_date:                   String(request.start_date),
        end_date:                     String(request.end_date),
        price_entry:                  String(request.price_entry),
        price_scale:                  String(request.price_scale),
        amount_scale:                 String(request.amount_scale),
        number_of_orders:             Number(request.number_of_orders),
        amount_per_trade:             String(request.amount_per_trade),
        margin_type:                  String(request.margin_type),
        multiplier:                   Number(request.multiplier),
        take_profit_distance_percent: String(request.take_profit_distance_percent),
        account_balance:              String(request.account_balance),
        exit_on_last_order:           Boolean(request.exit_on_last_order),
        clickhouse_addr:              String(request.clickhouse_addr),
        clickhouse_db:                String(request.clickhouse_db),
        clickhouse_user:              String(request.clickhouse_user),
        clickhouse_password:          String(request.clickhouse_password),
      };
      if (request.idempotency_key) {
        enginePayload.idempotency_key = String(request.idempotency_key);
      }
      const configJson = JSON.stringify(enginePayload) + '\n';
      child.stdin!.write(configJson, (err) => {
        if (err) {
          clearTimeouts();
          rl.close();
          reject(new ProcessError(null, null, err.message, `Failed to write to stdin: ${err.message}`));
          return;
        }

        // Close stdin to signal end of input
        child.stdin!.end();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// T028: mapResultLine — maps EngineResultLine → BacktestExecutionResult
// ---------------------------------------------------------------------------

/**
 * Maps the final NDJSON result line from the Go engine to BacktestExecutionResult.
 * This is a pure transformation; it performs no I/O.
 */
export function mapResultLine(line: EngineResultLine): BacktestExecutionResult {
  return {
    pnlSummary:           line.pnlSummary,
    tradeEvents:          line.tradeEvents,
    safetyOrderUsage:     line.safetyOrderUsage,
    engineExecutionTimeMs: line.executionTimeMs,
    candleCount:          line.candleCount,
    eventCount:           line.eventCount,
  };
}
