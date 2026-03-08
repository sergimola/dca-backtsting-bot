package orchestrator

import (
	"sync"
	"time"
)

// EventBus is an in-memory append-only event log with thread-safe access.
// It uses sync.RWMutex for concurrent read safety during single-threaded appends.
type EventBus struct {
	events []Event
	mu     sync.RWMutex
}

// NewEventBus creates a new EventBus with pre-allocated capacity for performance.
// If preallocSize is 0 or negative, starts with default capacity.
func NewEventBus(preallocSize int) *EventBus {
	cap := preallocSize
	if cap <= 0 {
		cap = 0 // Let Go choose default capacity
	}

	return &EventBus{
		events: make([]Event, 0, cap),
		mu:     sync.RWMutex{},
	}
}

// Append adds a single event to the bus. Thread-safe for append.
// Note: Single-threaded appends assumed during backtest execution.
// Multiple concurrent appends would require stricter synchronization.
func (eb *EventBus) Append(e Event) error {
	eb.mu.Lock()
	defer eb.mu.Unlock()

	eb.events = append(eb.events, e)
	return nil
}

// GetAllEvents returns all captured events in chronological order.
// Returns a snapshot (copy) to prevent external modifications.
// Thread-safe via RWMutex read lock.
func (eb *EventBus) GetAllEvents() []Event {
	eb.mu.RLock()
	defer eb.mu.RUnlock()

	// Return a copy to prevent external code from modifying the internal slice
	if len(eb.events) == 0 {
		return []Event{}
	}

	result := make([]Event, len(eb.events))
	copy(result, eb.events)
	return result
}

// GetEventsByType filters events by type.
// Thread-safe via RWMutex read lock.
func (eb *EventBus) GetEventsByType(eventType EventType) []Event {
	eb.mu.RLock()
	defer eb.mu.RUnlock()

	var result []Event
	for _, e := range eb.events {
		if e.Type == eventType {
			result = append(result, e)
		}
	}

	return result
}

// GetEventsByTimeRange returns events within a time window [start, end] (inclusive).
// Thread-safe via RWMutex read lock.
func (eb *EventBus) GetEventsByTimeRange(start, end time.Time) []Event {
	eb.mu.RLock()
	defer eb.mu.RUnlock()

	var result []Event
	for _, e := range eb.events {
		// Check if timestamp is within range (inclusive)
		if (e.Timestamp.Equal(start) || e.Timestamp.After(start)) &&
			(e.Timestamp.Equal(end) || e.Timestamp.Before(end)) {
			result = append(result, e)
		}
	}

	return result
}
