# Implementation Plan: Postgres Async Architecture

**Branch**: `010-postgres-async-architecture` | **Date**: 2026-03-15 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/010-postgres-async-architecture/spec.md`

## Summary

Refactor the Node.js orchestrator from a synchronous, file-system-based architecture into an
asynchronous, Postgres-backed architecture. The primary outcome is that `POST /backtest` returns
`HTTP 202 Accepted` immediately after a Postgres INSERT, completely decoupling the HTTP request
lifecycle from the Go engine execution. A background worker (`BackgroundWorker.ts`) polls
the `backtests` Postgres table every 2 seconds, spawns the Go engine via `child_process.spawn`
(streaming stdout), and writes the full result back to Postgres on completion.

Three legacy modules are deleted: `ProcessManager.ts`, `ResultStore.ts`, and all
`fs.readFileSync` result-file reads. The ClickHouse `market_data_syncs` sync ledger is migrated
to a Postgres table and `GapResolver` is rewritten to query Postgres before any ClickHouse calls.
The 1-month `same_month_guard` validation constraint is removed, enabling multi-year backtests.
Docker Compose gains a `postgres` service and a `pgadmin` service.

**Technology additions**: Drizzle ORM + `pg` (node-postgres) for schema, migrations, and queries.

## Technical Context

**Language/Version**: TypeScript 5.1 / Node.js 18+
**Primary Dependencies**: Express 5.x (existing), Drizzle ORM (drizzle-orm + drizzle-kit), pg (node-postgres), child_process.spawn (stdlib)
**Storage**: PostgreSQL 16 (new — backtest jobs + sync ledger) + ClickHouse (existing — market data OHLCV only)
**Testing**: Jest 30.x + Supertest 7.x; npm test in orchestrator/api/
**Target Platform**: Linux server (Docker Compose local + CI)
**Project Type**: web-service
**Performance Goals**: POST /backtest responds within 500ms; GET /backtests (100 records) responds within 2s
**Constraints**: trades/safety_orders JSONB never loaded in list queries; spawn not exec for Go engine; zero fs-based result reads after migration
**Scale/Scope**: Single-process Node.js; single Postgres instance; single background worker; up to ~50 stored backtest records in MVP

## Constitution Check

*Gates evaluated before Phase 0. Re-evaluated post Phase 1 design — no violations found.*

| Gate | Status | Evidence |
|------|--------|---------|
| **No Live Trading** | ✅ PASS | Pure infrastructure refactor; no changes to core-engine, trading logic, or execution rules |
| **Green Light Protocol** | ✅ ENFORCED | All existing tests must remain green before any implementation task begins. New integration tests required for 202 response, polling, and sync ledger. No merge with failing tests. |
| **Fixed-Point Arithmetic** | ✅ PASS | No monetary computation in the Node.js layer. All numeric results are stored and returned verbatim from the Go engine's JSON output. No floating-point arithmetic introduced. |
| **Single-Position Invariant** | ✅ PASS | Not touched. Core engine domain logic unchanged. |
| **Gap-Down Execution Rule** | ✅ PASS | Not touched. Go engine execution semantics unchanged. |
| **Architecture Boundary** | ✅ PASS | All changes are in `orchestrator/api/`. Zero changes to `core-engine/`. The Go engine binary remains the sole domain execution unit. |
| **BDD Acceptance Criteria** | ✅ COVERED | 5 user stories with Given/When/Then scenarios in spec.md. 6 constitution gates in the Architectural Constraints table, each with an explicit test verification method. |

## Project Structure

### Documentation (this feature)

```text
specs/010-postgres-async-architecture/
├── plan.md                          # This file
├── research.md                      # Phase 0: 8 resolved unknowns
├── data-model.md                    # Phase 1: backtests + market_data_syncs Drizzle schemas
├── quickstart.md                    # Phase 1: dev setup, smoke tests, gate verification
├── contracts/
│   └── api-contracts.md             # Phase 1: all HTTP endpoints + internal worker contracts
└── tasks.md                         # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code Impact (`orchestrator/api/` only)

```text
orchestrator/api/
│  [root project docker-compose.yml]  ← ADD: postgres + pgadmin services
│
├── src/
│   ├── db/
│   │   ├── schema.ts                ← NEW: Drizzle ORM schema (backtests, market_data_syncs)
│   │   ├── client.ts                ← NEW: pg Pool + drizzle() db instance export
│   │   └── migrate.ts               ← NEW: programmatic migrate() runner
│   │
│   ├── services/
│   │   ├── BackgroundWorker.ts      ← NEW: setInterval poller + spawn + DB result write
│   │   ├── BacktestJobRepository.ts ← NEW: insert, getById, listWithoutBlobs, updateStatus
│   │   ├── SyncLedgerRepository.ts  ← NEW: upsert sync record + check coverage
│   │   ├── GapResolver.ts           ← REWRITE: Postgres first, ClickHouse COUNT second
│   │   ├── BinanceDownloader.ts     ← MODIFY: write sync receipt to Postgres; track last candle ts
│   │   ├── BacktestService.ts       ← UNCHANGED (already uses spawn; used by BackgroundWorker)
│   │   ├── ProcessManager.ts        ← DELETE
│   │   └── ResultStore.ts           ← DELETE
│   │
│   ├── routes/
│   │   └── backtest.routes.ts       ← REWRITE: POST→202, GET /backtests, GET /backtests/:id,
│   │                                            GET /backtests/:id/status
│   │
│   ├── types/
│   │   └── configuration.ts         ← MODIFY: remove same_month_guard block
│   │
│   ├── middleware/
│   │   └── validation.middleware.ts ← MODIFY: remove same_month_guard constraint mapping
│   │
│   ├── app.ts                        ← MODIFY: swap ProcessManager/ResultStore for new services
│   └── main.ts                       ← MODIFY: await migrate(db); worker.start() before listen()
│
├── drizzle/
│   ├── 0001_create_backtests.sql    ← NEW: generated by drizzle-kit
│   └── 0002_create_market_data_syncs.sql  ← NEW: generated by drizzle-kit
│
├── drizzle.config.ts                 ← NEW: drizzle-kit config pointing to src/db/schema.ts
├── .env.example                      ← MODIFY: add DATABASE_URL + PG* vars
└── package.json                      ← MODIFY: add drizzle-orm, pg, drizzle-kit, @types/pg
```

**No changes** to `core-engine/`, `frontend/`, or `orchestrator/jobs/`.

## Complexity Tracking

No constitution violations. The only new abstractions introduced are directly necessary:

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|-----------|--------------------------------------|
| `db/` folder (3 files) | Postgres integration requires schema, connection client, and migration runner | Inline DB calls in routes would scatter connection logic, making it untestable |
| `BackgroundWorker.ts` | HTTP 202 detachment requires the engine to run outside the request lifecycle | Running engine inline in the route handler blocks the response (the bug being fixed) |
| `BacktestJobRepository.ts` + `SyncLedgerRepository.ts` | Encapsulates all DB queries for easier mocking in unit tests | Inline `db.select()` in routes and services couples route logic to DB implementation |

**Net complexity change is negative**: `ProcessManager.ts` + `ResultStore.ts` + all fs-based index files are deleted. The codebase shrinks overall.

---

## Phase 0: Research Summary

All unknowns resolved. See [research.md](research.md) for full details.

| Unknown | Resolution |
|---------|-----------|
| Drizzle + ESM packages | `drizzle-orm` + `pg`; `drizzle-kit` + `@types/pg`; programmatic `migrate()` at startup |
| Background worker pattern | `setInterval` 2s + `isProcessing` mutex; `FOR UPDATE SKIP LOCKED` atomic job claim |
| Drizzle select omission | `getTableColumns()` destructure → spread remaining cols into `.select()` |
| `synced_to` / `end_date` accuracy | Track `lastCandleTs` per page in BinanceDownloader; write actual last candle ts, not user's `end_date` |
| JSONB column definition | `jsonb().$type<T[]>()` in `drizzle-orm/pg-core` |
| Status column type | `text().default('pending')` + CHECK constraint (not ENUM) |
| `market_data_syncs` migration | New Postgres table; ClickHouse table deprecated (no new writes); GapResolver rewritten |
| Atomic job claim | `UPDATE … FOR UPDATE SKIP LOCKED RETURNING *` — safe for single and multi-worker |

---

## Phase 1: Design Artifacts

- [data-model.md](data-model.md) — Drizzle schemas for `backtests` and `market_data_syncs`; `BacktestJobRow` list projection type; `BacktestConfig` / `PnlSummary` TypeScript types; migration file structure; `end_date` invariant documentation
- [contracts/api-contracts.md](contracts/api-contracts.md) — Full HTTP contracts for all 4 endpoints (`POST /backtest` 202, `GET /backtests`, `GET /backtests/:id`, `GET /backtests/:id/status`); `BackgroundWorker` lifecycle contract; `GapResolver` query-order contract; breaking changes table
- [quickstart.md](quickstart.md) — Dev setup (Docker Compose, env vars, migration, binary build); 6 smoke tests with expected outputs; constitution gate manual verification table; troubleshooting guide

---

## Post-Design Constitution Re-Check

All 7 gates remain GREEN after Phase 1 design:

- No monetary computation added. `summary`, `trades`, `safetyOrders` are stored and returned as raw JSON from the Go engine — zero re-computation in Node.js.
- `BackgroundWorker` uses `spawn` (enforced in contracts/api-contracts.md internal contract). No `exec` callsite introduced. CI grep gate enforces this.
- `GapResolver` query order is locked in contracts: Postgres Stage 1 → ClickHouse Stage 2 (only if no Postgres record covers the range). Unit test verifies ClickHouse mock is never called on a cache hit.
- `GET /backtests` list query uses `getTableColumns()` destructure — `trades` and `safety_orders` are structurally excluded at the Drizzle ORM layer before any data is fetched from the DB.
- Green Light Protocol enforced: `BacktestService.ts` (which already uses `spawn`) is 100% unchanged, preserving all existing test coverage. All existing tests must be green before implementation begins.
- Architecture boundary preserved: zero changes to `core-engine/`. The Go engine is called exactly as before; only the lifecycle management around it changes.
