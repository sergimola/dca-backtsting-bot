package orchestrator

import (
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// T006: Event Bus append and retrieval tests
func TestEventBus_Append_And_Retrieval(t *testing.T) {
	testCases := []struct {
		name        string
		eventsCount int
	}{
		{"append 10 events", 10},
		{"append 100 events", 100},
		{"append 1000 events", 1000},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Arrange
			eb := NewEventBus(tc.eventsCount)

			// Create events with sequential timestamps
			events := make([]Event, tc.eventsCount)
			baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
			for i := 0; i < tc.eventsCount; i++ {
				events[i] = Event{
					Timestamp: baseTime.Add(time.Duration(i) * time.Second),
					Type:      EventTypeBuyOrderExecuted,
					Data:      map[string]interface{}{"orderIndex": i},
				}
			}

			// Act: Append all events
			for i, e := range events {
				err := eb.Append(e)
				assert.NoError(t, err, "failed to append event %d", i)
			}

			// Assert: Retrieve all events
			retrieved := eb.GetAllEvents()
			assert.Equal(t, tc.eventsCount, len(retrieved), "event count mismatch")

			// Verify order is preserved
			for i, e := range retrieved {
				assert.Equal(t, events[i].Timestamp, e.Timestamp, "event %d timestamp mismatch", i)
				assert.Equal(t, events[i].Type, e.Type, "event %d type mismatch", i)
			}
		})
	}
}

func TestEventBus_Empty_Returns_Empty_Slice(t *testing.T) {
	// Arrange
	eb := NewEventBus(0)

	// Act
	retrieved := eb.GetAllEvents()

	// Assert
	assert.NotNil(t, retrieved, "empty event bus should return empty slice, not nil")
	assert.Equal(t, 0, len(retrieved), "empty event bus should have zero length")
}

func TestEventBus_Append_Returns_No_Error(t *testing.T) {
	// Arrange
	eb := NewEventBus(1)
	e := Event{
		Timestamp: time.Now(),
		Type:      EventTypePositionOpened,
		Data:      nil,
	}

	// Act
	err := eb.Append(e)

	// Assert
	assert.NoError(t, err)
}

// T007: Event Bus filtering by type
func TestEventBus_GetEventsByType_Filters_Correctly(t *testing.T) {
	// Arrange
	eb := NewEventBus(6)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	events := []struct {
		e    Event
		name string
	}{
		{Event{Timestamp: baseTime, Type: EventTypeBuyOrderExecuted, Data: nil}, "buy1"},
		{Event{Timestamp: baseTime.Add(1 * time.Second), Type: EventTypePositionOpened, Data: nil}, "open1"},
		{Event{Timestamp: baseTime.Add(2 * time.Second), Type: EventTypeBuyOrderExecuted, Data: nil}, "buy2"},
		{Event{Timestamp: baseTime.Add(3 * time.Second), Type: EventTypeTakeProfitHit, Data: nil}, "tp1"},
		{Event{Timestamp: baseTime.Add(4 * time.Second), Type: EventTypeBuyOrderExecuted, Data: nil}, "buy3"},
		{Event{Timestamp: baseTime.Add(5 * time.Second), Type: EventTypeLiquidation, Data: nil}, "liq1"},
	}

	// Append events
	for _, e := range events {
		err := eb.Append(e.e)
		assert.NoError(t, err)
	}

	// Act: Filter by EventTypeBuyOrderExecuted
	buyEvents := eb.GetEventsByType(EventTypeBuyOrderExecuted)

	// Assert: Should have 3 buy events
	assert.Equal(t, 3, len(buyEvents), "should have exactly 3 buy order events")
	for i, e := range buyEvents {
		assert.Equal(t, EventTypeBuyOrderExecuted, e.Type, "buy event %d has wrong type", i)
	}
}

func TestEventBus_GetEventsByType_Empty_When_No_Match(t *testing.T) {
	// Arrange
	eb := NewEventBus(3)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Append only buy order events
	for i := 0; i < 3; i++ {
		eb.Append(Event{
			Timestamp: baseTime.Add(time.Duration(i) * time.Second),
			Type:      EventTypeBuyOrderExecuted,
		})
	}

	// Act: Filter by a non-existent event type
	liquidationEvents := eb.GetEventsByType(EventTypeLiquidation)

	// Assert: Should be empty
	assert.Equal(t, 0, len(liquidationEvents), "should have zero liquidation events")
}

// T008: Event Bus time-range queries
func TestEventBus_GetEventsByTimeRange_Returns_Events_In_Window(t *testing.T) {
	// Arrange
	eb := NewEventBus(5)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Create events with 1-second intervals
	for i := 0; i < 5; i++ {
		eb.Append(Event{
			Timestamp: baseTime.Add(time.Duration(i) * time.Second),
			Type:      EventTypeBuyOrderExecuted,
			Data:      map[string]interface{}{"index": i},
		})
	}

	// Act: Query events between t[1] and t[3] (inclusive)
	startTime := baseTime.Add(1 * time.Second)
	endTime := baseTime.Add(3 * time.Second)
	rangeEvents := eb.GetEventsByTimeRange(startTime, endTime)

	// Assert: Should have events at indices 1, 2, 3 (3 events total)
	assert.Equal(t, 3, len(rangeEvents), "should have exactly 3 events in range")
	assert.Equal(t, startTime, rangeEvents[0].Timestamp, "first event should be at start time")
	assert.Equal(t, endTime, rangeEvents[2].Timestamp, "last event should be at end time")
}

func TestEventBus_GetEventsByTimeRange_Excludes_Outside_Window(t *testing.T) {
	// Arrange
	eb := NewEventBus(5)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Create events
	for i := 0; i < 5; i++ {
		eb.Append(Event{
			Timestamp: baseTime.Add(time.Duration(i) * time.Second),
			Type:      EventTypeBuyOrderExecuted,
		})
	}

	// Act: Query narrow window (t[2] only)
	targetTime := baseTime.Add(2 * time.Second)
	rangeEvents := eb.GetEventsByTimeRange(targetTime, targetTime)

	// Assert: Should have only 1 event
	assert.Equal(t, 1, len(rangeEvents), "should have exactly 1 event at target time")
	assert.Equal(t, targetTime, rangeEvents[0].Timestamp)
}

// T010: Event Bus memory safety and race conditions
func TestEventBus_Concurrent_Reads_No_Race(t *testing.T) {
	// This test is designed to catch race conditions
	// Run with: go test -race ./...

	// Arrange
	eb := NewEventBus(1000)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Pre-populate with some events
	for i := 0; i < 1000; i++ {
		eb.Append(Event{
			Timestamp: baseTime.Add(time.Duration(i) * time.Millisecond),
			Type:      EventTypeBuyOrderExecuted,
		})
	}

	// Act: Concurrent readers
	wg := sync.WaitGroup{}
	numReaders := 10

	for reader := 0; reader < numReaders; reader++ {
		wg.Add(1)
		go func(readerID int) {
			defer wg.Done()
			// Each reader performs multiple queries
			for attempt := 0; attempt < 100; attempt++ {
				_ = eb.GetAllEvents()
				_ = eb.GetEventsByType(EventTypeBuyOrderExecuted)
				_ = eb.GetEventsByTimeRange(baseTime, baseTime.Add(500*time.Millisecond))
			}
		}(reader)
	}

	wg.Wait()

	// Assert: All events still intact
	assert.Equal(t, 1000, len(eb.GetAllEvents()))
}

func TestEventBus_No_Memory_Leaks_Large_Event_Count(t *testing.T) {
	// Arrange: Create and measure memory before
	var memBefore runtime.MemStats
	runtime.ReadMemStats(&memBefore)

	// Act: Create EventBus and populate with 1M events (simulated large backtest)
	eb := NewEventBus(1000000)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Simulate large event capture (simplified: just timestamps and types)
	for i := 0; i < 100000; i++ { // 100K events for faster test
		eb.Append(Event{
			Timestamp: baseTime.Add(time.Duration(i) * time.Millisecond),
			Type:      EventTypeBuyOrderExecuted,
			Data:      map[string]interface{}{"index": i},
		})
	}

	// Assert: Verify events are stored
	allEvents := eb.GetAllEvents()
	assert.Equal(t, 100000, len(allEvents), "should have 100K events")

	// Memory after
	var memAfter runtime.MemStats
	runtime.ReadMemStats(&memAfter)

	// Assert: Memory allocation is reasonable (rough check)
	// Each event with map data is ~1-2 KB, so 100K should be ~100-200 MB
	allocatedBytes := memAfter.Alloc - memBefore.Alloc
	assert.Less(t, allocatedBytes, uint64(250*1024*1024), "memory allocation should be <250MB for 100K events")

	// Clean up - verify EventBus still works after heavy use
	eb.Append(Event{
		Timestamp: time.Now(),
		Type:      EventTypePositionOpened,
	})

	assert.Equal(t, 100001, len(eb.GetAllEvents()), "should have 100,001 events after append")
}

func TestEventBus_Thread_Safety_With_RWMutex(t *testing.T) {
	// Verify thread safety even under concurrent load
	// This should pass with: go test -race ./...

	eb := NewEventBus(10000)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	wg := sync.WaitGroup{}

	// Writer goroutines
	for writer := 0; writer < 2; writer++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < 5000; i++ {
				eb.Append(Event{
					Timestamp: baseTime.Add(time.Duration(w*5000+i) * time.Millisecond),
					Type:      EventTypeBuyOrderExecuted,
					Data:      map[string]interface{}{"writer": w, "index": i},
				})
			}
		}(writer)
	}

	// Reader goroutines
	for reader := 0; reader < 5; reader++ {
		wg.Add(1)
		go func(r int) {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				_ = eb.GetAllEvents()
				_ = eb.GetEventsByType(EventTypeBuyOrderExecuted)
			}
		}(reader)
	}

	wg.Wait()

	// Assert
	assert.Equal(t, 10000, len(eb.GetAllEvents()), "should have 10K events after concurrent appends")
}

func BenchmarkEventBus_Append(b *testing.B) {
	eb := NewEventBus(b.N)
	e := Event{
		Timestamp: time.Now(),
		Type:      EventTypeBuyOrderExecuted,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eb.Append(e)
	}
}

func BenchmarkEventBus_GetAllEvents(b *testing.B) {
	eb := NewEventBus(10000)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Pre-populate
	for i := 0; i < 10000; i++ {
		eb.Append(Event{
			Timestamp: baseTime.Add(time.Duration(i) * time.Millisecond),
			Type:      EventTypeBuyOrderExecuted,
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = eb.GetAllEvents()
	}
}

func BenchmarkEventBus_GetEventsByType(b *testing.B) {
	eb := NewEventBus(10000)
	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	// Pre-populate with mixed event types
	for i := 0; i < 10000; i++ {
		var eventType EventType
		switch i % 4 {
		case 0:
			eventType = EventTypeBuyOrderExecuted
		case 1:
			eventType = EventTypeTakeProfitHit
		case 2:
			eventType = EventTypeLiquidation
		default:
			eventType = EventTypePositionOpened
		}
		eb.Append(Event{
			Timestamp: baseTime.Add(time.Duration(i) * time.Millisecond),
			Type:      eventType,
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = eb.GetEventsByType(EventTypeBuyOrderExecuted)
	}
}
