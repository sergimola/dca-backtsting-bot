# Tasks: Postgres Async Architecture

**Input**: Design documents from `/specs/010-postgres-async-architecture/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/api-contracts.md ✅, quickstart.md ✅
**Branch**: `010-postgres-async-architecture`
**Total Tasks**: 34 across 9 phases

**Green Light Protocol**: All existing `orchestrator/api/` tests MUST be green before starting Phase 3. No merges permitted with failing tests. New integration tests (T015, T020, T022, T025) are mandatory per the spec constitution gate.

**Domain Boundary**: All 34 tasks are `[orchestrator]`. Zero `core-engine/` changes.

---

## Phase 1: Setup

**Purpose**: Project-level configuration that unblocks all downstream phases. All tasks touch different files and can run in parallel.

- [X] T001 Add `postgres` service (official image, named volume, port 5432) and `pgadmin` service (port 5050) to the root `docker-compose.yml`
- [X] T002 [P] Add `drizzle-orm`, `pg` to `dependencies` and `drizzle-kit`, `@types/pg` to `devDependencies` in `orchestrator/api/package.json`
- [X] T003 [P] Add `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` entries to `orchestrator/api/.env.example`
- [X] T004 [P] Create `orchestrator/api/drizzle.config.ts` pointing `schema` at `./src/db/schema.ts` and `out` at `./drizzle`

---

## Phase 2: Foundational DB Layer

**Purpose**: The Drizzle ORM stack — schema, connection client, migration runner, generated SQL files, and both repositories — that ALL user stories depend on. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: Complete this phase before starting Phase 3.

- [X] T005 Create `orchestrator/api/src/db/schema.ts` with `backtests` table (UUID PK, `status` TEXT + CHECK constraint, `config` JSONB NOT NULL, `summary` JSONB nullable, `trades` JSONB nullable, `safety_orders` JSONB nullable, `error_message` TEXT nullable, `created_at`, `updated_at`) and `market_data_syncs` table (UUID PK, `symbol` TEXT, `start_date` TIMESTAMPTZ, `end_date` TIMESTAMPTZ, `created_at`, `updated_at`) per `data-model.md`
- [X] T006 [P] Create `orchestrator/api/src/db/client.ts` exporting a `pg.Pool` instance and a `drizzle(pool)` db instance; read `DATABASE_URL` from `process.env`
- [X] T007 [P] Create `orchestrator/api/src/db/migrate.ts` exporting `runMigrations()` that calls `migrate(db, { migrationsFolder: './drizzle' })` from `drizzle-orm/node-postgres/migrator`
- [X] T008 Run `npx drizzle-kit generate` to generate `orchestrator/api/drizzle/0001_create_backtests.sql` and `orchestrator/api/drizzle/0002_create_market_data_syncs.sql`; commit the generated SQL files
- [X] T009 [P] Create `orchestrator/api/src/services/BacktestJobRepository.ts` with methods: `insert(config)` → `{ id }`, `getById(id)` → full row or null, `listWithoutBlobs()` → rows without `trades`/`safetyOrders` using `getTableColumns()` destructure, `updateStatus(id, status, payload?)`, `claimPending()` → `UPDATE … SET status='running' … FOR UPDATE SKIP LOCKED RETURNING *`
- [X] T010 [P] Create `orchestrator/api/src/services/SyncLedgerRepository.ts` with methods: `checkCoverage(symbol, start, end)` → boolean (SELECT where start_date ≤ start AND end_date ≥ end), `upsert(symbol, startDate, endDate)` → void
- [X] T011 Update `orchestrator/api/src/app.ts`: replace `ResultStore` and `ProcessManager` fields on `AppServices` interface with `backtestJobRepository: BacktestJobRepository` and `syncLedgerRepository: SyncLedgerRepository`; update `createApp()` wiring accordingly

**Checkpoint**: `npm run build` in `orchestrator/api/` must pass (zero TypeScript errors) before Phase 3.

---

## Phase 3: User Story 1 — Submit a Multi-Year Backtest (Priority: P1) 🎯 MVP

**Goal**: `POST /backtest` accepts any date range (removes 1-month cap), inserts into Postgres, and returns HTTP 202 immediately. The HTTP lifecycle is closed before any engine work begins.

**Independent Test**: Submit a request with `start_date: "2021-01-01T00:00:00Z"` and `end_date: "2024-12-31T23:59:59Z"`. Expect HTTP 202 with a `job_id` in < 500ms. No `same_month_guard` error.

- [X] T012 [P] [US1] Remove the `same_month_guard` validation block (~lines 180-191) from `validateBacktestRequest()` in `orchestrator/api/src/types/configuration.ts`
- [X] T013 [P] [US1] Remove the `same_month_guard: ErrorCode.VALIDATION_OUT_OF_BOUNDS` entry from the `CONSTRAINT_TO_CODE` map in `orchestrator/api/src/middleware/validation.middleware.ts`
- [X] T014 [US1] Rewrite the `POST /backtest` handler in `orchestrator/api/src/routes/backtest.routes.ts`: call `backtestJobRepository.insert(validatedConfig)`, respond `res.status(202).json({ job_id, status: 'pending', message: '...' })` — no engine invocation, no `await` on execution
- [X] T015 [US1] Write integration test in `orchestrator/api/src/__tests__/acceptance/us1-async-submit.test.ts`: (1) POST with 3-year range → assert 202 + `job_id` present; (2) POST with 3-year range → assert no `same_month_guard` error in response; (3) assert response arrives in < 500ms

**Checkpoint**: `GET /backtests/:id/status` for the new `job_id` should return `pending`. User Story 1 is independently demonstrable here.

---

## Phase 4: User Story 2 — Background Worker + Job Polling (Priority: P2)

**Goal**: A background worker picks up `pending` jobs, executes the Go engine via `spawn` (streaming stdout), and writes the result back to Postgres. Two new endpoints expose job status and full results.

**Independent Test**: Submit → poll `GET /backtests/:id/status` until `completed` → call `GET /backtests/:id` → assert `trades` array present; also test `failed` path with bad binary.

- [X] T016 [US2] Create `orchestrator/api/src/services/BackgroundWorker.ts`: `start()` → `setInterval(tick, 2000)`; `tick()` uses `isProcessing` mutex; calls `backtestJobRepository.claimPending()`; spawns Go binary via `child_process.spawn` (NEVER `exec`); accumulates stdout chunks via `proc.stdout.on('data')`; on `close` exit 0 → `JSON.parse(output)` → `updateStatus('completed', { summary, trades, safetyOrders })`; on failure → `updateStatus('failed', { errorMessage: stderr })`; Node process MUST NOT crash on worker errors
- [X] T017 [P] [US2] Add `GET /backtests/:id/status` route in `orchestrator/api/src/routes/backtest.routes.ts`: call `backtestJobRepository.getById(id)`, return `{ id, status, error_message }`; 404 if not found
- [X] T018 [P] [US2] Add `GET /backtests/:id` route in `orchestrator/api/src/routes/backtest.routes.ts`: call `backtestJobRepository.getById(id)`, return full row including `trades` and `safetyOrders`; 404 if not found
- [X] T019 [US2] Update `orchestrator/api/src/main.ts`: call `await runMigrations()` before `app.listen()`; construct `BackgroundWorker` with `backtestJobRepository` and `binaryPath`; call `worker.start()` before `app.listen()`
- [X] T020 [US2] Write integration test in `orchestrator/api/src/__tests__/acceptance/us2-job-lifecycle.test.ts`: submit → poll status until terminal → assert `completed`; GET full result → assert `trades` array exists; assert `failed` status when binary path is invalid (non-zero exit)

**Checkpoint**: Two concurrent submissions each receive unique `job_id`s and both reach `completed` independently. User Story 2 independently testable.

---

## Phase 5: User Story 3 — List Backtests Without Memory Pressure (Priority: P3)

**Goal**: `GET /backtests` returns all runs without loading the heavy JSONB blob columns.

**Independent Test**: Create several backtest records; call `GET /backtests`; assert no `trades` or `safetyOrders` key in any returned object.

- [X] T021 [US3] Add `GET /backtests` route in `orchestrator/api/src/routes/backtest.routes.ts`: call `backtestJobRepository.listWithoutBlobs()` (which uses `getTableColumns()` destructure to exclude `trades`/`safetyOrders`); return array ordered by `createdAt` descending; assert all statuses are included
- [X] T022 [US3] Write unit test in `orchestrator/api/src/__tests__/us3-select-omission.test.ts`: mock `listWithoutBlobs()` return; call `GET /backtests` via Supertest; assert neither `trades` nor `safetyOrders` appears anywhere in the response JSON (use `JSON.stringify` check)

**Checkpoint**: `GET /backtests` with 100 seeded records completes < 2s and heap memory increase is negligible.

---

## Phase 6: User Story 4 — Market Data Cache Verified Before Any Network Calls (Priority: P4)

**Goal**: `GapResolver` queries the Postgres `market_data_syncs` table before making any ClickHouse network call. `BinanceDownloader` writes the actual last-candle timestamp (not the user's `end_date`) to Postgres.

**Independent Test**: Seed `market_data_syncs` covering the requested range; submit backtest; mock ClickHouse client and assert zero calls made.

- [X] T023 [US4] Rewrite `orchestrator/api/src/services/GapResolver.ts`: Stage 1 — call `syncLedgerRepository.checkCoverage(symbol, start, end)`; if covered return `{ hasGap: false }` immediately without touching ClickHouse; Stage 2 (only if uncovered) — existing `COUNT(*) FINAL` ClickHouse logic unchanged
- [X] T024 [US4] Modify `orchestrator/api/src/services/BinanceDownloader.ts`: (1) declare `let lastCandleTs = start.getTime()` before the download loop; (2) update `lastCandleTs = ohlcv[ohlcv.length - 1][0]` on every pagination page; (3) after the loop, call `syncLedgerRepository.upsert(symbol, start, new Date(lastCandleTs))` instead of writing to ClickHouse `market_data_syncs`
- [X] T025 [US4] Write unit test in `orchestrator/api/src/__tests__/us4-sync-ledger.test.ts`: mock `SyncLedgerRepository.checkCoverage()` returning true; mock ClickHouse client; call `GapResolver.check()`; assert `chClient.query` was never called; also test `end_date` accuracy: after a download where last candle ts is `T`, assert `syncLedgerRepository.upsert` was called with third arg `new Date(T)` not the original `end` arg

**Checkpoint**: With ClickHouse container stopped, a second submission for the same covered symbol still returns 202 (Postgres ledger serves as cache).

---

## Phase 7: User Story 5 — Infrastructure Verification (Priority: P5)

**Purpose**: Verify the Phase 1 docker-compose additions work end-to-end as a running system. US5 acceptance scenarios are now testable.

- [X] T026 [US5] Run `docker-compose up -d` from project root; verify: (1) `postgres` container starts and accepts connections on port 5432; (2) `pgadmin` is reachable at `http://localhost:5050`; (3) `npm run dev` in `orchestrator/api/` logs "Migrations applied successfully" and "BackgroundWorker started"; (4) `docker-compose down && docker-compose up -d` preserves Postgres data in named volume (verify by checking tables still exist in pgAdmin)

**Checkpoint**: Any developer can clone the repo, run `docker-compose up -d && npm run dev`, and have a fully functional Postgres-backed API in under 2 minutes.

---

## Phase 8: File System Eradication

**Purpose**: Delete the three legacy modules and remove all filesystem-based result-persistence references. These deletions are safe only after Phases 3–6 are complete and all tests are green.

**⚠️ Do NOT start these tasks until all previous phases are green (npm test passes).**

- [X] T027 [P] Delete `orchestrator/api/src/services/ProcessManager.ts`
- [X] T028 [P] Delete `orchestrator/api/src/services/ResultStore.ts`
- [X] T029 Remove all remaining import statements and references to `ProcessManager` and `ResultStore` from `orchestrator/api/src/app.ts`, `orchestrator/api/src/routes/backtest.routes.ts`, and any other files that still import them
- [X] T030 Audit `orchestrator/api/src/` for any remaining `fs.readFileSync` calls used for reading backtest result JSON or index files; remove every such call; verify results are fetched exclusively from `BacktestJobRepository.getById()`
- [X] T031 Add a `"lint:eradication"` script to `orchestrator/api/package.json` that greps `orchestrator/api/src/` for `ProcessManager|ResultStore|readFileSync` and exits non-zero if any match is found; run it and confirm zero matches

**Checkpoint**: `grep -r "ProcessManager\|ResultStore\|readFileSync" orchestrator/api/src/` returns zero results.

---

## Phase 9: Polish & Green Light Validation

**Purpose**: Final cross-cutting verification confirming all constitution gates pass.

- [X] T032 [P] Add `"lint:spawn-guard"` script to `orchestrator/api/package.json` that greps `orchestrator/api/src/services/BackgroundWorker.ts` for `child_process.exec` and exits non-zero if found; run it and confirm zero matches
- [X] T033 Run full test suite via `npm test` in `orchestrator/api/`; fix any regressions; confirm all tests pass (Green Light Protocol gate — no merge until green)
- [X] T034 [P] Run the quickstart.md smoke tests (Steps 7–11) end-to-end and confirm all 6 expected outputs match; update `checklists/requirements.md` to mark all spec items complete

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup) — no prerequisites; T001–T004 all parallelizable
     ↓
Phase 2 (Foundational DB Layer) — depends on Phase 1 (npm install before running drizzle-kit)
     T005, T006, T007 parallelizable
     T008 depends on T004 + T005
     T009, T010 parallelizable (after T005)
     T011 depends on T009 + T010
     ↓  ↓  ↓  ↓  ↓
Phase 3  4  5  6  7  (all depend on Phase 2 complete; can run in parallel if staffed)
     ↓
Phase 8 (Eradication) — depends on Phases 3–6 all green
     T027, T028 parallelizable
     T029 depends on T027 + T028
     T030 depends on T029
     T031 depends on T030
     ↓
Phase 9 (Polish) — depends on Phase 8
     T032, T034 parallelizable
     T033 depends on T032
```

### User Story Dependencies  

| Story | Can Start After | Depends On Other Stories? |
|-------|----------------|--------------------------|
| US1 (P1) | Phase 2 complete | No — independently testable |
| US2 (P2) | Phase 2 complete | Builds on US1's `job_id` in Postgres, but independently testable |
| US3 (P3) | Phase 2 complete | No — independently testable (just needs records seeded) |
| US4 (P4) | Phase 2 complete | No — independently testable against mocked ClickHouse |
| US5 (P5) | Phase 1 complete (docker-compose already updated) | No — infrastructure verification only |

### Parallel Opportunities per Story

```
US1: T012 ‖ T013   (then T014 → T015)
US2: T017 ‖ T018   (after T016 is written)
US4: T023 ‖ T024   (then T025)
Phase 8: T027 ‖ T028 (then T029 → T030 → T031)
Phase 9: T032 ‖ T034 (then T033)
```

---

## Implementation Strategy

**MVP**: Complete Phase 1 + Phase 2 + Phase 3 (US1). At this point `POST /backtest` accepts multi-year ranges and returns 202, delivering the core async contract. Jobs will sit in `pending` state (no worker yet) but the HTTP detachment and date removal are fully demonstrable.

**Full Feature**: Complete Phases 4 (worker) and 5 (list) to deliver the complete async cycle with polling recovery.

**Complete Delivery**: Phases 6 (sync ledger), 7 (infra verification), 8 (eradication), and 9 (polish) deliver the full specification including cache efficiency, infra reproducibility, and zero legacy footprint.

