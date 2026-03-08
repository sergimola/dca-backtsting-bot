# 📋 DCA Frontend Web Application (Feature 005) - Complete Specification Package

**Feature**: 005-dca-frontend  
**Status**: Ready for Implementation (Phase 1)  
**Date Created**: March 8, 2026  
**Total Estimated Duration**: 15-18 days (10 implementation phases)

---

## 📚 Documentation Index

### A. **Specification & Requirements** 📖

1. **[spec.md](spec.md)** - Feature Specification (COMPLETE ✅)
   - 7 prioritized user stories (4 P1 core, 2 P2 important, 1 P3 nice-to-have)
   - Acceptance scenarios with Given/When/Then format
   - 15 functional requirements (FR-001 to FR-015)
   - 5 key entities defined (BacktestConfiguration, PnlSummary, etc.)
   - Success criteria with measurable outcomes
   - Assumptions, edge cases, out-of-scope items
   - **Read this first** to understand what we're building

2. **[checklists/requirements.md](checklists/requirements.md)** - Quality Checklist (COMPLETE ✅)
   - Specification completeness validated
   - All clarifications resolved (polling: fixed 2-second intervals)
   - Ready for planning phase

### B. **Architecture & Design** 🏗️

3. **[plan.md](plan.md)** - Implementation Plan (COMPLETE ✅)
   - 10 implementation phases with durations
   - Technical context (TypeScript 5.1+, React 18, Vite, TailwindCSS, Recharts)
   - Constitution compliance checklist (all 5 gates ✅ PASS)
   - Project structure & folder organization
   - Component design & data flow diagrams (ASCII art)
   - useBacktestPolling hook design (core custom hook)
   - 10 key technical decisions with rationales
   - Dependencies & libraries listed
   - **Read this** to understand the overall architecture

4. **[research.md](research.md)** - Design Decisions (COMPLETE ✅)
   - 20 design decisions rationale explained
   - Tech choices: Vite vs CRA, TailwindCSS, Recharts, custom hook vs react-query
   - Alternatives considered for each decision
   - **Read this** for design justification

5. **[data-model.md](data-model.md)** - Entity & State Definitions (COMPLETE ✅)
   - 5 core entities with full TypeScript interfaces
   - State schemas for App, Form, Polling, Results
   - Validation rules per entity
   - Data flow diagrams
   - **Read this** for data structures

### C. **Component & API Contracts** 📝

6. **[contracts/react-components.md](contracts/react-components.md)** - Component Interface (COMPLETE ✅)
   - Props interfaces for 6 main components
   - Render contracts (ASCII box diagrams)
   - Behavior specifications
   - Initial values & validation rules
   - Usage examples
   - **Read this** before implementing components

7. **[contracts/backtest-api.md](contracts/backtest-api.md)** - REST API Contract (COMPLETE ✅)
   - 3 required API endpoints
   - Request/response schemas (JSON)
   - Error handling & status codes
   - Polling flow documentation
   - Assumptions (async processing, status polling)
   - **Read this** to understand API integration

8. **[contracts/state-machine.md](contracts/state-machine.md)** - State Machine (COMPLETE ✅)
   - 9 application states defined
   - 15+ state transitions
   - Event triggers & guards
   - ASCII state diagram
   - State property definitions
   - **Read this** to understand app flow

### D. **Implementation Roadmap** 🛣️

9. **[tasks.md](tasks.md)** - Implementation Tasks (COMPLETE ✅) 📍 **START HERE FOR CODING**
   - **98 actionable tasks** organized into 20 sequential phases
   - Strict Test-Driven Development (TDD) order
   - **2 explicit visual verification checkpoints** (Phase 3 & 4)
   - Every task includes:
     - Task ID (T001-T098)
     - File paths (exact, ready to code)
     - Success criteria
     - Test requirements
   - Phases:
     - Phase 1-3: Foundation & API services
     - Phase 4-8: Form & polling (with **T079 visual check**)
     - Phase 9-14: Results display (with **T080 visual check**)
     - Phase 15-20: Error handling, testing, docs, integration
   - **Start Phase 1** with tasks T001-T019

10. **[TASKS-SUMMARY.md](TASKS-SUMMARY.md)** - Quick Reference (COMPLETE ✅)
    - Phase breakdown table (20 phases, estimated durations)
    - Key highlights & parallelization opportunities
    - Development workflow quick commands
    - Success criteria per phase
    - File structure created by tasks
    - **Read before starting implementation**

### E. **Developer Guides** 👨‍💻

11. **[quickstart.md](quickstart.md)** - Local Development Setup (COMPLETE ✅)
    - Step-by-step project initialization
    - npm scripts reference
    - Component structure & naming conventions
    - How to run dev server, tests, builds
    - Common issues & solutions
    - **Read after Phase 1 to set up dev environment**

12. **[PHASE-1-COMPLETION-SUMMARY.md](PHASE-1-COMPLETION-SUMMARY.md)** - Phase 1 Executive Summary
    - What's completed in Phase 1
    - Constitution compliance status
    - Timeline & success metrics
    - Risks & mitigations
    - Next steps
    - **Read after completing Phase 1**

### F. **Project Management** 📊

13. **[INDEX.md](INDEX.md)** - Documentation Navigation (COMPLETE ✅)
    - Reading paths by role (developer, architect, QA, PM)
    - Document relationships
    - Roadmap & FAQs
    - **This file** - serves as navigation hub

---

## 🎯 Getting Started: The Right Reading Order

### For **Developers** (coding the feature):

1. ✅ Read **[spec.md](spec.md)** (5 min) - Understand user stories
2. ✅ Read **[TASKS-SUMMARY.md](TASKS-SUMMARY.md)** (5 min) - Overview of 20 phases
3. ✅ Read **[tasks.md](tasks.md)** (10 min) - Find Phase 1 tasks
4. ✅ Start **Phase 1** with task **T001** (initialize Vite)
5. ✅ Run tests after each task
6. ✅ Do **T079 visual check** (end of Phase 3) - verify form + polling render
7. ✅ Do **T080 visual check** (end of Phase 4) - verify results render
8. ✅ Continue through Phases 5-20

### For **Architects** (design review):

1. ✅ Read **[plan.md](plan.md)** (15 min) - Architecture overview
2. ✅ Read **[contracts/react-components.md](contracts/react-components.md)** (10 min) - Component design
3. ✅ Read **[contracts/state-machine.md](contracts/state-machine.md)** (10 min) - State transitions
4. ✅ Review **[research.md](research.md)** (10 min) - Design decisions
5. ✅ Verify **[data-model.md](data-model.md)** (5 min) - Entity definitions

### For **Project Managers** (tracking progress):

1. ✅ Read **[spec.md](spec.md)** (10 min) - User stories & priorities
2. ✅ Read **[TASKS-SUMMARY.md](TASKS-SUMMARY.md)** (5 min) - Phase timeline
3. ✅ Reference **[tasks.md](tasks.md)** for task count per phase
4. ✅ Track visual verification checkpoints (T079, T080)
5. ✅ Monitor test coverage target (>80% by Phase 18)

### For **QA / Testers** (quality verification):

1. ✅ Read **[spec.md](spec.md)** (10 min) - Acceptance scenarios
2. ✅ Read **[contracts/](contracts/)** - Component & API contracts
3. ✅ Reference **[tasks.md](tasks.md)** - Test requirements per task
4. ✅ Create **[PHASE-1-COMPLETION-SUMMARY.md](PHASE-1-COMPLETION-SUMMARY.md)** - Track Phase 1 completion
5. ✅ Verify visual checks (T079, T080) hit success criteria

---

## 🚀 How to Start

### Step 1: Understand the Feature
```
Read spec.md (7 user stories)
→ 5 min read
```

### Step 2: Understand the Plan
```
Read TASKS-SUMMARY.md (20 phases overview)
→ 5 min read
```

### Step 3: Begin Implementation
```
Open tasks.md
→ Find Phase 1 (T001-T019)
→ Follow each task sequentially
→ Run tests after each task
→ ~1-2 days for Phase 1
```

### Step 4: Verify First Checkpoint
```
At end of Phase 3 (after T035):
→ Run T079: visual verification
→ Take screenshots of form + polling
→ Verify no console errors
→ Proceed to Phase 4 only if T079 passes
```

### Step 5: Verify Second Checkpoint
```
At end of Phase 4 (after T067):
→ Run T080: visual verification
→ Take screenshots of results dashboard
→ Verify all 3 components render
→ Proceed to Phase 5 only if T080 passes
```

### Step 6: Continue Implementation
```
Complete Phases 5-20 sequentially
→ 13-16 more days
→ Each phase has tests + success criteria
→ Documentation written during phases
```

---

## 📊 Project Statistics

| Metric | Value |
|--------|-------|
| **Total Tasks** | 98 (+ 2 visual checks) |
| **Implementation Phases** | 20 |
| **Components to Build** | 6 main + 3 sub-components |
| **Custom Hooks** | 2 (useFormValidation, useBacktestPolling) |
| **User Stories** | 7 (4 P1, 2 P2, 1 P3) |
| **Estimated Duration** | 15-18 days |
| **Target Test Coverage** | >80% (Jest) |
| **Visual Verification Checkpoints** | 2 (T079, T080) |
| **Documentation Files** | 7 (README, ARCHITECTURE, TESTING, DEPLOYMENT, etc.) |
| **Max Trade Events Handled** | 1000+ rows (virtual scrolling) |
| **Build Output Size Target** | <500KB (gzip) |

---

## ✅ Constitution Compliance

This feature passes all 5 project constitution gates:

- ✅ **No Live Trading**: Frontend-only, submits configs to API Layer
- ✅ **Green Light Protocol**: All user journeys tested (BDD scenarios)
- ✅ **Fixed-Point Arithmetic**: Display-only formatting, no calculations
- ✅ **Polyglot Architecture**: UI adapter in orchestrator/, core in core-engine/
- ✅ **Event-Driven Domain**: Consumes events from API Layer

---

## 🔗 Relationship Map

```
spec.md (Requirements)
    ↓
    ├→ plan.md (Architecture)
    │   ├→ research.md (Why these decisions?)
    │   └→ data-model.md (Data structures)
    │
    ├→ contracts/ (Detailed design)
    │   ├→ react-components.md (UI blueprint)
    │   ├→ backtest-api.md (API blueprint)
    │   └→ state-machine.md (Flow blueprint)
    │
    ├→ tasks.md (DO THIS - Implementation roadmap)
    │   ├→ Phase 1-3: Foundation & API
    │   ├→ Phase 4-8: Forms & Polling
    │   ├→ Phase 9-14: Results display
    │   └→ Phase 15-20: Testing & integration
    │
    └→ quickstart.md (Local dev setup)
        └→ PHASE-1-COMPLETION-SUMMARY.md (Progress tracking)
```

---

## 📞 Quick Reference

### Key Files by Purpose

| I need to... | Read this |
|---|---|
| Understand what to build | spec.md |
| Understand the architecture | plan.md |
| Understand why design choices | research.md |
| Know what components to build | contracts/react-components.md |
| Know what API endpoints needed | contracts/backtest-api.md |
| Know state transitions | contracts/state-machine.md |
| Know data structures | data-model.md |
| Know tasks & implementation order | **tasks.md** |
| Get quick phase overview | TASKS-SUMMARY.md |
| Set up dev environment | quickstart.md |
| Track Phase 1 progress | PHASE-1-COMPLETION-SUMMARY.md |

### Quick Commands

```bash
# Start dev server (Phase 1)
cd frontend && npm run dev

# Run tests (any phase)
npm test

# Run tests with coverage (Phase 18)
npm test -- --coverage

# Build for production (Phase 19)
npm run build

# Lint code (Phase 19)
npm run lint
```

---

## 🎓 Learning Path

### If you're new to the project:
1. Read spec.md (understand user stories)
2. Read TASKS-SUMMARY.md (understand phases)
3. Skim plan.md (understand architecture)
4. Start Phase 1 of tasks.md

### If you're familiar with the project:
1. Skim spec.md (refresh on requirements)
2. Jump to tasks.md Phase X (where you left off)
3. Reference contracts/ as needed during coding

### If you're doing code review:
1. Review spec.md for requirements coverage
2. Review contracts/ for interface compliance
3. Review tasks.md test requirements
4. Verify visual verification checkpoints passed

---

## ✨ Success Indicators

### Phase 1 Complete ✅
- Vite server starts on localhost:5173
- TypeScript strict mode enabled
- TailwindCSS working
- Jest tests running
- All T001-T019 tasks done
- **T019 visual verification passed**

### Phase 3 Complete ✅
- Form component renders correctly
- Polling indicator works
- **T079 visual verification passed** ← CRITICAL CHECKPOINT
- All tests passing
- Ready to proceed to Phase 4

### Phase 4 Complete ✅
- Results dashboard displays all 3 components
- PnlSummary metrics show with color coding
- SafetyOrderChart renders bars correctly
- TradeEventsTable shows events with sorting
- **T080 visual verification passed** ← CRITICAL CHECKPOINT
- Ready to proceed to Phase 5

### Final (Phase 20 Complete) ✅
- >80% Jest test coverage achieved
- E2E tests pass with real API
- All 7 user stories tested (BDD)
- Production build created (<500KB)
- Full documentation complete
- Ready for deployment

---

**Repository**: d:\personal\bot-dca\dca-bot\DCA Backtesting bot\specs\005-dca-frontend\

**Next Action**: Open [tasks.md](tasks.md) and start **Phase 1** with **task T001** 🚀
