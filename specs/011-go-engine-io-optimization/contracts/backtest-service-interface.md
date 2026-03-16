# Contract: BacktestService Streaming Interface

**Version**: 1.0 | **Feature**: 011-go-engine-io-optimization | **Date**: 2026-03-15

This contract defines the updated TypeScript interface for `BacktestService.execute()` and the `BacktestExecutionResult` return type after the readline refactor.

---

## BacktestExecutionResult (revised)

```typescript
/**
 * Result of a successful BacktestService.execute() call.
 * Matches the engine's EngineResultPayload (minus the `type` discriminant).
 *
 * BREAKING CHANGE from previous version:
 *   Old: { events: any[]; finalPosition: any; executionTimeMs: number }
 *   New: { pnlSummary, tradeEvents, safetyOrderUsage, engineExecutionTimeMs, candleCount, eventCount }
 */
export interface BacktestExecutionResult {
  pnlSummary:            StoredPnlSummary;
  tradeEvents:           StoredTradeEvent[];
  safetyOrderUsage:      SafetyOrderUsageEntry[];
  /** Engine-internal execution time (StartTime → EndTime inside RunBacktest). */
  engineExecutionTimeMs: number;
  candleCount:           number;
  eventCount:            number;
}
```

---

## BacktestService.execute() Signature (revised)

```typescript
/**
 * Execute a backtest against the Go core engine.
 *
 * @param request     Full engine request including ClickHouse credentials.
 * @param options     Optional configuration for this execution.
 * @returns           Structured result payload from the engine.
 * @throws ProcessError  On non-zero exit, timeout, or missing result line.
 */
async execute(
  request: ApiBacktestRequest & ClickhouseCredentials,
  options?: BacktestExecuteOptions,
): Promise<BacktestExecutionResult>
```

### BacktestExecuteOptions

```typescript
export interface BacktestExecuteOptions {
  /** Override the instance-level timeoutMs for this single call. */
  timeoutMs?: number;
  /**
   * Called for each `{"type":"progress",...}` line received from the engine.
   * Fire-and-forget: the BacktestService does not await this callback.
   * Errors thrown inside are caught and logged but do not affect the main promise.
   */
  progressHandler?: (line: ProgressLine) => Promise<void>;
}
```

---

## Internal Readline Loop Contract

The `executeInternal()` private method must implement the following state machine:

```
State: RUNNING
  On readline 'line' event:
    → Try JSON.parse(line)
    → On parse failure: log WARN, discard, stay RUNNING
    → parsed.type === "progress" && progressHandler exists:
        fire-and-forget progressHandler(parsed as ProgressLine)
        stay RUNNING
    → parsed.type === "result":
        resultLine = parsed as EngineResultLine
        resultReceived = true
        stay RUNNING (wait for process exit to resolve)
    → parsed.type === anything else: discard, stay RUNNING

  On child process 'exit':
    if exitCode === 0 && resultReceived:
      resolve(mapResultLine(resultLine))
    elif !resultReceived:
      reject(new ProcessError("Engine exited without result line", exitCode, signal, stderr))
    else:
      reject(new ProcessError("Engine exited non-zero", exitCode, signal, stderr))
```

### mapResultLine()

```typescript
function mapResultLine(line: EngineResultLine): BacktestExecutionResult {
  return {
    pnlSummary:            line.pnlSummary,
    tradeEvents:           line.tradeEvents,
    safetyOrderUsage:      line.safetyOrderUsage,
    engineExecutionTimeMs: line.executionTimeMs,
    candleCount:           line.candleCount,
    eventCount:            line.eventCount,
  };
}
```

---

## CLI Flag Passthrough to Engine Binary

`BacktestService` spawns the engine with the following additional flags (appended to `args`):

```typescript
const engineFlags = [
  '--log-level', process.env.ENGINE_LOG_LEVEL ?? 'INFO',
  '--progress-interval-ms', String(process.env.ENGINE_PROGRESS_INTERVAL_MS ?? '250'),
];
// Spawn: spawn(command, [...engineFlags], {...})
```

These are sourced from environment variables so they can be configured per deployment without code changes. Default values ensure backward compatibility with existing test environments.

---

## BackgroundWorker.processJob() Contract

```typescript
private async processJob(job: BacktestRow): Promise<void> {
  const claimStartTime = Date.now();

  const result = await this.service.execute(request, {
    progressHandler: async (line: ProgressLine) => {
      await this.repo.updateProgress(job.id, line.percent, line);
    },
  });

  // Worker wall-clock time (includes ClickHouse data-fetch time in BackgroundWorker,
  // but NOT the GapResolver/downloader time — measured from service.execute() call)
  const workerExecutionTimeMs = Date.now() - claimStartTime;

  await this.repo.markCompleted(
    job.id,
    result.pnlSummary,
    result.tradeEvents,
    result.safetyOrderUsage,
    workerExecutionTimeMs,  // Postgres executionTimeMs = worker wall-clock, not engine internal
  );
}
```

> **Design note**: Two `executionTimeMs` values exist: the engine-internal one (`result.engineExecutionTimeMs`, excludes ClickHouse connection overhead) and the worker wall-clock one (persisted to Postgres, includes spawning and piping overhead). The engine-internal value is available in `result.engineExecutionTimeMs` if needed for telemetry but is not persisted in this iteration.
