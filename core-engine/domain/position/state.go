package position

// PositionState represents the current phase of a position lifecycle
type PositionState int

const (
	StateIdle PositionState = iota
	StateOpening
	StateSafetyOrderWait
	StateClosed
)

func (s PositionState) String() string {
	switch s {
	case StateIdle:
		return "IDLE"
	case StateOpening:
		return "OPENING"
	case StateSafetyOrderWait:
		return "SAFETY_ORDER_WAIT"
	case StateClosed:
		return "CLOSED"
	default:
		return "UNKNOWN"
	}
}

// OrderType distinguishes market vs. limit orders
type OrderType int

const (
	OrderTypeMarket OrderType = iota
	OrderTypeLimit
)

func (t OrderType) String() string {
	switch t {
	case OrderTypeMarket:
		return "MARKET"
	case OrderTypeLimit:
		return "LIMIT"
	default:
		return "UNKNOWN"
	}
}
