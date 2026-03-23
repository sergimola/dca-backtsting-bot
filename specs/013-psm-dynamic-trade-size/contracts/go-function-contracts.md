# Go Function Contracts: PSM Dynamic Trade Sizing

**Feature**: 013-psm-dynamic-trade-size  
**Package**: `core-engine/domain/config`

This document records the updated public function signatures introduced by Feature 013. These are internal Go domain contracts — no HTTP, gRPC, or external API surfaces change.

---

## `Config.ComputeAmountSequence`

```go
// ComputeAmountSequence distributes Total Volume V across N orders using a geometric
// weighting scheme. SDD §2.2:
//
//   Percentage mode (AmountPerTrade ≤ 1.0):
//     V = dynamicBalance × AmountPerTrade × Multiplier
//
//   Absolute mode (AmountPerTrade > 1.0):
//     V = AmountPerTrade × Multiplier
//
// dynamicBalance is the live compounding account equity provided by the Orchestrator
// at trade-open time. It MUST be > 0 when AmountPerTrade ≤ 1.0; otherwise a
// SequenceComputationError is returned.
//
// Returns SequenceComputationError for:
//   - dynamicBalance ≤ 0 AND AmountPerTrade ≤ 1.0
//
// The returned AmountSequence sums exactly to V (sum-invariant enforced by
// last-element adjustment). To obtain base-currency quantities call
// ComputeBaseQuantities(dynamicBalance, prices).
func (c *Config) ComputeAmountSequence(dynamicBalance decimal.Decimal) (AmountSequence, error)
```

---

## `Config.ComputeBaseQuantities`

```go
// ComputeBaseQuantities converts USDT dollar amounts (from ComputeAmountSequence)
// into base-currency quantities by dividing each D_n by the corresponding limit price.
// SDD §2.2: Quantity[n] = D_n / P_n
//
// dynamicBalance is forwarded to ComputeAmountSequence unchanged.
// prices must have the same length as the AmountSequence produced by ComputeAmountSequence.
//
// Returns SequenceComputationError for:
//   - empty prices slice
//   - prices/amounts length mismatch
//   - any price[i] == 0
//   - any error from ComputeAmountSequence
func (c *Config) ComputeBaseQuantities(dynamicBalance decimal.Decimal, prices PriceSequence) (AmountSequence, error)
```
