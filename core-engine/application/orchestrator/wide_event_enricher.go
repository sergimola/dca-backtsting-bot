package orchestrator

import (
	"bufio"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	// wideEventChannelCap is the lossless back-pressure channel capacity.
	// At ~800 bytes per event, 65536 slots ≈ 50 MiB worst-case memory.
	wideEventChannelCap = 65536

	// wideEventBufSize is the bufio.Writer buffer size (256 KiB).
	// Amortizes syscall cost across ~350 events per flush.
	wideEventBufSize = 256 * 1024
)

// WideEventEnricher writes WideEvent records to a per-run .jsonl file via a
// lossless buffered-channel + goroutine pattern. The PSM loop sends events via
// Emit(); a background worker serializes and writes them. Back-pressure stall
// duration is tracked for FR-012 observability.
type WideEventEnricher struct {
	ch         chan WideEvent
	done       chan struct{}
	file       *os.File
	bw         *bufio.Writer
	stallTime  time.Duration
	stallMu    sync.Mutex
	outputPath string
}

// NewWideEventEnricher creates the output directory (if needed), opens the .jsonl file,
// and starts the background worker goroutine.
func NewWideEventEnricher(outputDir, runID string) (*WideEventEnricher, error) {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, err
	}

	filePath := filepath.Join(outputDir, runID+".jsonl")
	f, err := os.Create(filePath)
	if err != nil {
		return nil, err
	}

	e := &WideEventEnricher{
		ch:         make(chan WideEvent, wideEventChannelCap),
		done:       make(chan struct{}),
		file:       f,
		bw:         bufio.NewWriterSize(f, wideEventBufSize),
		outputPath: filePath,
	}

	go e.worker()
	return e, nil
}

// Emit sends a WideEvent to the background writer. The send blocks when the
// channel buffer is full (back-pressure). Stall time is accumulated for FR-012.
func (e *WideEventEnricher) Emit(event WideEvent) {
	start := time.Now()
	e.ch <- event // blocking send — lossless guarantee
	elapsed := time.Since(start)
	if elapsed > time.Microsecond {
		e.stallMu.Lock()
		e.stallTime += elapsed
		e.stallMu.Unlock()
	}
}

// worker drains the channel and writes each event as a JSON line.
// Uses AppendJSON with a reusable buffer to avoid json.Marshal reflection overhead.
func (e *WideEventEnricher) worker() {
	defer close(e.done)
	buf := make([]byte, 0, 1024) // reused across all events; grows once then stays
	for event := range e.ch {
		buf = event.AppendJSON(buf[:0])
		buf = append(buf, '\n')
		e.bw.Write(buf) //nolint:errcheck // bufio sticky error checked at Flush
	}
}

// Close shuts down the enricher: closes the channel, waits for the worker to
// drain, flushes the bufio buffer, syncs and closes the file. Returns the
// cumulative stall duration.
func (e *WideEventEnricher) Close() (time.Duration, error) {
	close(e.ch)    // 1. signal: no more events
	<-e.done       // 2. wait: goroutine drains channel completely

	flushErr := e.bw.Flush() // 3. flush remaining bytes
	_ = e.file.Sync()        // 4. fsync for durability (best-effort)
	closeErr := e.file.Close() // 5. release FD

	if flushErr != nil {
		return e.stallTime, flushErr
	}
	return e.stallTime, closeErr
}

// OutputPath returns the absolute path of the .jsonl file.
func (e *WideEventEnricher) OutputPath() string {
	return e.outputPath
}
