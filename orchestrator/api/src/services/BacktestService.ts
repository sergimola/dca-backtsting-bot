/**
 * BacktestService - Manages Core Engine subprocess execution and event streaming
 *
 * Spawns Core Engine as a child process, streams backtest configuration via stdin,
 * reads Event Bus output as ndjson, and handles timeouts with graceful cleanup.
 */

import { spawn } from 'child_process';
import split from 'split2';
import { BacktestRequest, TradeEvent } from '../types/index.js';
import { ProcessError } from '../types/errors.js';
import { parseEventLine } from '../utils/EventBusParser.js';
import * as fs from 'fs';

/**
 * Execution result from BacktestService.execute()
 */
export interface BacktestExecutionResult {
  events: TradeEvent[];
  executionTimeMs: number;
}

/**
 * BacktestService - Handles subprocess lifecycle and event streaming
 *
 * Responsibilities:
 * - Spawn Core Engine binary as child_process.spawn()
 * - Stream configuration to stdin as JSON + newline
 * - Parse ndjson Event Bus output line-by-line
 * - Enforce 30-second timeout with SIGTERM → SIGKILL escalation
 * - Capture stderr for error mapping
 * - Track execution time with high-resolution timer
 *
 * @example
 * const service = new BacktestService('/path/to/core-engine');
 * const result = await service.execute(backtestRequest, 30000);
 * console.log(`Executed ${result.events.length} events in ${result.executionTimeMs}ms`);
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
   * @param request - BacktestRequest with configuration
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
   *   console.log(`${result.events.length} events in ${result.executionTimeMs}ms`);
   * } catch (error) {
   *   if (error instanceof ProcessError) {
   *     console.error(`Exit: ${error.exitCode}, Signal: ${error.signal}`);
   *     console.error(`Stderr: ${error.stderr}`);
   *   }
   * }
   */
  async execute(request: BacktestRequest, timeoutMs?: number): Promise<BacktestExecutionResult> {
    const timeout = timeoutMs ?? this.timeoutMs;
    return this.executeInternal(request, timeout, []);
  }

  /**
   * Executes backtest with additional flags (for testing with mock binary)
   *
   * @param request - BacktestRequest with configuration
   * @param flags - Additional command-line flags to pass to binary (e.g., ['--fail', '--timeout'])
   * @returns BacktestExecutionResult or throws with stderr attached
   */
  async executeWithStderr(request: BacktestRequest, flags: string[] = []): Promise<BacktestExecutionResult> {
    return this.executeInternal(request, this.timeoutMs, flags);
  }

  /**
   * Internal implementation of execute with optional flags for testing
   */
  private async executeInternal(
    request: BacktestRequest,
    timeoutMs: number,
    flags: string[] = []
  ): Promise<BacktestExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const events: TradeEvent[] = [];
      let stderr = '';
      let lineNumber = 0;

      // Determine if we need to use 'node' (for .js files on Windows)
      let command: string;
      let args: string[];

      if (this.binaryPath.endsWith('.js')) {
        // Node.js script (mock binary)
        command = 'node';
        args = [this.binaryPath, ...flags];
      } else {
        // Direct executable
        command = this.binaryPath;
        args = flags;
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

      // Setup timeout
      setupTimeout();

      // Capture stderr for error mapping
      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const stderrOutput = data.toString();
          stderr += stderrOutput;
          // Log Go engine errors to console immediately for visibility
          console.error('[Go Engine Error]:', stderrOutput);
        });
      }

      // Parse ndjson from stdout
      if (child.stdout) {
        child.stdout.pipe(split()).on('data', (line: string) => {
          lineNumber++;

          // Skip empty lines
          if (!line.trim()) {
            return;
          }

          try {
            const event = parseEventLine(line, lineNumber);
            events.push(event);
          } catch (error) {
            // Log parse error but continue (graceful degradation)
            if (this.logger) {
              this.logger.error(`Parse error at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        });
      }

      // Handle process exit
      child.on('exit', (exitCode, signal) => {
        clearTimeouts();
        const executionTimeMs = Math.round(performance.now() - startTime);

        if (this.logger) {
          this.logger.info(`Process exited: code=${exitCode}, signal=${signal}, time=${executionTimeMs}ms, events=${events.length}`);
        }

        // Success: exit code 0
        if (exitCode === 0) {
          resolve({
            events,
            executionTimeMs,
          });
          return;
        }

        // Failure: non-zero exit code or signal
        // Include stderr in error message for API logs
        const errorMessage = `Core Engine exited with code ${exitCode}${signal ? ` and signal ${signal}` : ''}${stderr ? `\n[stderr]: ${stderr}` : ''}`;
        const error = new ProcessError(exitCode, signal, stderr, errorMessage);
        reject(error);
      });

      // Handle spawn errors
      child.on('error', (error) => {
        clearTimeouts();
        reject(new ProcessError(null, null, error.message, `Failed to spawn Core Engine: ${error.message}`));
      });

      // Write configuration to stdin
      const configJson = JSON.stringify(request) + '\n';
      child.stdin!.write(configJson, (err) => {
        if (err) {
          clearTimeouts();
          reject(new ProcessError(null, null, err.message, `Failed to write to stdin: ${err.message}`));
          return;
        }

        // Close stdin to signal end of input
        child.stdin!.end();
      });
    });
  }
}
