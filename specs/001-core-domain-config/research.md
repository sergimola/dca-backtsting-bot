# Research Findings: Core Domain Configuration & Order Sequence Math

**Date**: 2026-03-07  
**Feature**: 001-core-domain-config  
**Phase**: 0 (Research & Clarification Resolution)

---

## Overview

This document consolidates research findings for implementing the core domain configuration contract and order sequence formulas in Go using shopspring/decimal. All research tasks resolve specification ambiguities, validate technology choices, and document best practices.

**Clarification Status**: ✅ **ZERO NEEDS CLARIFICATION** markers in spec.md. All technical decisions are explicit. Research validates choices and establishes patterns.

---

## Decision 1: Language Choice (Go 1.20+) & Fixed-Point Library

### Decision
**Go 1.20+ with github.com/shopspring/decimal**

### Rationale
1. **Concurrency**: Go's goroutines and channels are superior for grid-search backtest orchestration (millions of parameter combinations); threadpool-based Python/Node.js approaches scale poorly.
2. **Performance**: Go compiles to native binary; can process multi-year datasets with millions of candles in <60s (constitution requirement).
3. **Fixed-Point Arithmetic**: shopspring/decimal is battle-tested in financial systems (payments processing, crypto exchanges); provides exact Decimal semantics with arbitrary precision.
4. **Type Safety**: Go's static typing catches configuration errors at compile time; interface-based design allows clean adapter architecture (Core Domain + Infrastructure).
5. **Dependency Overhead**: shopspring/decimal is single library dependency (no heavy frameworks); minimal binary bloat.

### Alternatives Considered & Why Rejected
- **Python with Decimal**: Python's GIL limits concurrency for backtest grid-search; interpreted overhead unacceptable for 60s multi-year target. Python reserved for orchestration layer only.
- **Rust**: Excessive complexity for this phase; Go's simplicity accelerates MVP. Rust remains option for later optimization if needed.
- **JavaScript/TypeScript**: No native Decimal support without external library; floating-point default dangerous for financial math. Relegated to orchestration/API layer only.
- **Java**: JVM startup overhead and memory footprint incompatible with serverless backtest workers (stateless workers managed by message queue).

### Implementation Patterns
- All monetary calculations route through `decimal.Decimal` type exclusively.
- Config struct fields using `decimal.Decimal` for price/amount parameters.
- Operations: `decimal.NewFromString()` for string parsing; `.Mul()`, `.Div()`, `.Add()`, `.Sub()` for arithmetic.
- Rounding: `.RoundBank()` with `ROUND_HALF_UP` semantics (shopspring/decimal default).

---

## Decision 2: DCA Formula Implementation (Fixed-Point Geometry)

### Decision
**Implement Price Sequence ($P_n$) and Amount Sequence ($A_n$) formulas using exact fixed-point geometric scaling.**

### Rationale
1. **Mathematical Exactness**: DCA strategy depends on precise geometric scaling:
   - Price Sequence: $P_n = P_{n-1}(1 - \delta/100 \cdot s_p^{n-1})$ requires exact exponentiation with no precision loss.
   - Amount Sequence: $A_n = C \cdot m \cdot s_a^n / R$ where $R = (s_a^N - 1)/(s_a - 1)$ must divide exactly; rounding errors compound across orders.
2. **Canonical Test Validation**: Spec provides exact Decimal outputs (e.g., P_2 = 95.84400000, A_1 = 285.71428571); implementation MUST match to last digit.
3. **Sum Preservation**: Amount sequence must sum to C*m exactly; any rounding in intermediate calculations will violate this invariant.
4. **Monotonicity Guarantee**: Price sequence must satisfy P_0 > P_1 > ... > P_{N-1} strictly; fixed-point arithmetic ensures this property via exact comparisons.

### Geometric Scaling Patterns
- **Exponentiation**: Use `decimal.Decimal.Pow()` for exponents (s_a^n, s_p^n); verify result exactly matches expected test values.
- **Normalization Factor**: Compute $R = (s_a^N - 1)/(s_a - 1)$ using exact division; handle edge case s_a = 1.0 → R = N (no scaling, uniform sizing).
- **Rounding**: Always round final results with ROUND_HALF_UP semantics; never round intermediate computations.
- **Test Validation**: Every price/amount computation validated against canonical test data; zero tolerance for precision mismatch.

### Edge Case Handling
1. **amount_scale = 1.0**: Formula degenerates to uniform ordering. R = N exactly. No division ambiguity.
2. **price_scale = 1.0**: Price deviation uniform. P_n = P_{n-1}(1 - δ/100) repeated. Monotonicity preserved.
3. **number_of_orders = 1**: Only P_0, A_0 computed. No geometry scaling applied. System must not assume N >= 2.
4. **amount_per_trade ≤ 1.0**: Fraction of equity interpretation deferred to trade-entry time. Config stores raw value; runtime computes C = (balance + profit) * amount_per_trade.

---

## Decision 3: Data Structure & Serialization Strategy

### Decision
**Config struct with 13 fields (str, float, int, bool types) + computed Price/Amount sequences as public methods returning []*decimal.Decimal arrays.**

### Rationale
1. **Immutability Post-Validation**: Once Config is instantiated and validated, all parameters are read-only. Sequences are computed on-demand or cached.
2. **Serialization Safety**: Go JSON marshaling of Decimal requires custom handling (shopspring/decimal provides json.Marshaler/Unmarshaler).
3. **Type Exactness**: Config struct fields use Go native types (string, float64 for Python compatibility, int for counts, bool for flags).
   - **Conversion Strategy**: float64 → decimal.Decimal during validation phase; store both if needed for performance.
4. **Sequence Caching**: Price and Amount sequences computed once, cached in Config struct after validation.
5. **Export Pattern**: Public struct with uppercase field names (Go convention); validation via constructor or Validate() method.

### Serialization Formats
- **JSON**: Use shopspring/decimal marshalers; e.g., `"price_entry": 2.00000000` (Decimal string format).
- **YAML**: Leverage existing YAML Go libraries (gopkg.in/yaml.v3); Decimal fields serialize as strings.
- **Round-Trip Guarantee**: Config → JSON → Config must restore all fields exactly (SC-005).

---

## Decision 4: Validation Architecture

### Decision
**Validation separated into type-checking phase and constraint-checking phase. Both executed synchronously during Config instantiation.**

### Rationale
1. **Fail-Fast**: Type errors caught immediately; invalid configs rejected before trading engine receives them.
2. **Diagnostic Messages**: Each validation error includes actionable message (e.g., "margin_type must be 'cross' or 'isolated', got 'leverage'").
3. **Constraint Completeness**: FR-009 through FR-012 all validated:
   - margin_type ∈ {'cross', 'isolated'}
   - multiplier >= 1
   - number_of_orders >= 1
   - All numeric parameters >= 0
4. **Performance**: All validations complete in <1ms (SC-004).

### Type Validation Hierarchy
1. Parse input parameters into Go native types.
2. Check parameter types match expectations (string, float64, int, bool).
3. Construct decimal.Decimal values from float64/string inputs.
4. Run constraint checks on Decimal values.
5. Compute Price/Amount sequences if all checks pass.
6. Raise error immediately and return nil Config if any check fails.

---

## Decision 5: SDD Master Report Traceability

### Decision
**Document all formulas, parameter defaults, and constraints with exact SDD section references. Include equation numbers and cross-references in code comments.**

### Rationale
1. **Reproducibility**: Developers implementing Config validation can verify formulas against SDD without ambiguity.
2. **Constitution Gate 5 Compliance**: FR-015 requires documentation matching SDD exactly; traceability enables automated validation.
3. **Future Port-Ability**: If system migrates to Rust/Python later, SDD references remain canonical source.

### Traceability Map
- **Config Parameters**: SDD Section 4.1, Table 4.1 (13 parameters, exact defaults).
- **Price Sequence Formula**: SDD Section 2.1, Equation (E2.1): $P_n = P_{n-1}(1 - \delta/100 \cdot s_p^{n-1})$.
- **Amount Sequence Formula**: SDD Section 2.2, Equations (E2.2a/E2.2b): $R = (s_a^N - 1)/(s_a - 1)$; $A_n = C \cdot m \cdot s_a^n / R$.
- **Precision Requirements**: SDD Section 2.0 (Lot Size & Precision Constraints): ROUND_HALF_UP, Decimal type mandatory.

### Code Documentation Pattern
```go
// Price Sequence: Compute P_n using recurrence relation
// SDD Section 2.1, Equation (E2.1): P_n = P_{n-1} * (1 - delta/100 * s_p^(n-1))
// Reference: SDD Master Report §2.1, equation number E2.1
func (c *Config) ComputePriceSequence(currentPrice decimal.Decimal) ([]*decimal.Decimal, error) { ... }
```

---

## Decision 6: Testing Strategy (TDD + BDD + Canonical Data)

### Decision
**Implement Test-Driven Development with canonical test data as acceptance gates. BDD given-when-then scenarios for all 18 acceptance criteria.**

### Rationale
1. **Canonical Data Binding**: Spec provides exact expected outputs (Test Cases 1, 2, 3); implementation must produce these exact values or fail.
2. **BDD Clarity**: User stories include 18 acceptance scenarios (Given/When/Then); each is independently testable.
3. **Green Light Protocol**: SC-003 mandates 100% passing tests before merge; backlog cannot proceed without all tests green.
4. **Regression Prevention**: Tests lock in expected behavior; future changes to Config won't accidentally break invariants.

### Test Organization
1. **Unit Tests** (Go testing package):
   - Test each FR independently: FR-001 (Config instantiation), FR-004 (PriceSequence), FR-006 (AmountSequence), etc.
   - Canonical test cases (Test 1, 2, 3) implemented as Go test functions with exact Decimal comparisons.
   - Type validation tests: invalid margin_type, multiplier < 1, number_of_orders = 0, etc.
2. **BDD / Acceptance Tests** (Gherkin via go-testify or similar):
   - Implement all 18 Given/When/Then scenarios as executable Go tests.
   - Each scenario documents user intent and validates behavior.
3. **Integration Tests**:
   - JSON serialization/deserialization round-trip (SC-005).
   - Config + PriceSequence + AmountSequence end-to-end validation.

### Canonical Data Validation
- Price Sequence Test: Assert P_1 = 98.00, P_2 = 95.84400000, P_3 = 93.52457520 (exact Decimal comparison).
- Amount Sequence Test: Assert R = 7.00, A_0 = 142.85714286, A_1 = 285.71428571, A_2 = 571.42857143; sum = 1000.00.
- Config Defaults Test: Instantiate minimal config, verify all 13 defaults populated exactly.

---

## Decision 7: Architecture Integration (Core Domain Placement)

### Decision
**Feature belongs to `core-engine/domain/config/` package in Go. No infrastructure, API, or UI logic in this feature; clean separation per ports-and-adapters pattern.**

### Rationale
1. **Constitution Gate**: Architecture constraint mandates core domain zero dependencies on infrastructure, I/O, or frameworks.
2. **Testability**: Pure Go package (no I/O, no HTTP, no external services) is easily unit-testable.
3. **Polyglot Stack**: Orchestration layer (TypeScript/Python) consumes Config via exported interfaces; core-engine remains language-isolated.
4. **Future Portability**: Config package can migrate to Rust without touching orchestrator code.

### Package Structure
```
core-engine/domain/config/
├── config.go           # Config struct + validation + constructors
├── sequences.go        # Price/Amount sequence computation
├── config_test.go      # Unit tests + canonical data validation
├── sequences_test.go   # Sequence computation tests
└── README.md           # Documentation + SDD references
```

---

## Verification Checklist

- ✅ Zero "[NEEDS CLARIFICATION]" markers in spec.md.
- ✅ Language choice (Go + shopspring/decimal) justified against alternatives.
- ✅ Formula implementation patterns documented (fixed-point geometry, exact division, rounding semantics).
- ✅ Edge case handling defined (scale=1.0, amount_per_trade≤1.0, N=1).
- ✅ Data structure design (Config struct + sequence methods + validation).
- ✅ Serialization strategy (JSON/YAML with round-trip guarantee).
- ✅ Validation architecture (type-checking + constraint-checking).
- ✅ SDD traceability map (Section 2.0, 2.1, 2.2, 4.1 referenced in code).
- ✅ Testing strategy (TDD + canonical data + BDD acceptance scenarios).
- ✅ Architecture placement (core-engine/domain/config/ with zero external dependencies).

---

## Phase 0 Completion: ✅ READY FOR PHASE 1 DESIGN

All research tasks complete. No critical unknowns remain. Proceed to generate data-model.md, contracts/, and quickstart.md.
