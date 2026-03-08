# State Machine Contract: DCA Frontend Backtest Lifecycle

**Date**: March 8, 2026  
**Scope**: Application state transitions, event triggers, view routing

---

## State Machine Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                   DCA Frontend State Machine                         │
└─────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │  CONFIGURATION_IDLE  │
                    │                      │
                    │ View: ConfigForm     │
                    │ Actions: fill form   │
                    └──────────────────────┘
                            │
                            │ Event: USER_SUBMIT_FORM
                            │ Action: validate locally + POST /backtest
                            ↓
                    ┌──────────────────────┐
                    │  SUBMITTING_CONFIG   │
                    │                      │
                    │ View: ConfigForm     │
                    │ UI: Submit disabled  │
                    │      Spinner        │
                    └──────────────────────┘
                        ↙       ↘       ↖
         ┌──────────────┘         └────────────────┐
         │ SUBMIT SUCCESS         SUBMIT ERROR   │
         │                                         │
         ↓                                         ↓
    ┌─────────────────────┐        ┌──────────────────────┐
    │  POLLING_ACTIVE     │        │ SUBMISSION_ERROR     │
    │                     │        │                      │
    │ View: PollingPage   │        │ View: ConfigForm     │
    │ Actions:            │        │ UI: Show error msg   │
    │ - Poll every 2s     │        │ Actions: User can    │
    │ - Track elapsed     │        │ modify & resubmit    │
    │ - Monitor timeout   │        └──────────────────────┘
    │                     │
    └─────────────────────┘
         ↙       ↘         ↖
    ┌──────────────┴────────────────────┐
    │                                    │
    │ Event: STATUS_COMPLETED            │ Event: TIMEOUT_5MIN
    │ Action: GET /backtest/{id}/results │ Action: Show timeout msg
    ↓                                    │
┌──────────────────┐          ┌──────────────────────┐
│ RESULTS_LOADED   │          │ POLLING_TIMEOUT      │
│                  │          │                      │
│ View: Dashboard  │          │ View: PollingPage    │
│ UI: Show metrics │          │ UI: Error msg +      │
│    chart, table  │          │     [Retry] button   │
│                  │          │                      │
│ Actions:         │          │ Event: USER_RETRY    │
│ [Run New]        │          │ → Back to            │
│ [Modify & Re-run]│          │    POLLING_ACTIVE    │
└──────────────────┘          │                      │
    ↙         ↘               └──────────────────────┘
    │         │
    │ Event:  │ Event:
    │ RUN_NEW │ MODIFY_CONFIG
    │         │
    ↓         ↓
    └─→ CONFIGURATION_IDLE (form reset/populated)

┌──────────────────────────────────┐
│ ERROR PATHS (from any state)     │
│                                  │
│ Event: NETWORK_ERROR             │
│ → NETWORK_ERROR state            │
│ → Show retry message             │
│ → Auto-retry or user manual      │
│                                  │
│ Event: API_ERROR (500)           │
│ → API_ERROR state                │
│ → Show error message             │
│ → Offer "Run New" or "Retry"     │
│                                  │
│ Event: BACKTEST_FAILED (status)  │
│ → BACKTEST_FAILED state          │
│ → Show failure reason            │
│ → Offer "Run New" or retry       │
└──────────────────────────────────┘
```

---

## State Definitions

### State: CONFIGURATION_IDLE

**Description**: Application at rest, waiting for user input on configuration form

**Properties**:
```typescript
{
  currentView: 'configuration',
  backtestId: null,
  submittedConfig: null,
  results: null,
  isLoading: false,
  error: null,
  formState: { values, errors, touched, isValid }
}
```

**UI Rendering**:
- ConfigurationForm visible
- Form fields populated with default or previous values
- Submit button enabled (if form valid)
- No loading indicators

**User Actions**:
- Edit form fields → triggers validation (stay in state)
- Click Submit → transition to SUBMITTING_CONFIG
- Click Clear → reset form (stay in state)

**Entry Point**: Application start, or after USER_RUN_NEW or USER_MODIFY event

---

### State: SUBMITTING_CONFIG

**Description**: Currently submitting form to API; waiting for backtestId response

**Properties**:
```typescript
{
  currentView: 'configuration',  // Form still visible for context
  isLoading: true,
  submittedConfig: BacktestConfiguration,  // User's submitted config
  error: null,
}
```

**UI Rendering**:
- ConfigurationForm visible but all inputs disabled
- Submit button disabled + shows spinner + "Submitting..."
- Other buttons disabled (Clear, etc.)

**Duration**: Typically <1 second (network latency)

**Exit Conditions**:
- Success (201): backtestId received → POLLING_ACTIVE
- Error (400): Validation error from server → SUBMISSION_ERROR
- Error (500): Server error → SUBMISSION_ERROR
- Timeout (10s): Network timeout → NETWORK_ERROR

---

### State: POLLING_ACTIVE

**Description**: Backtest submitted; polling for completion status every 2 seconds

**Properties**:
```typescript
{
  currentView: 'polling',
  backtestId: string,          // From submission response
  submittedConfig: BacktestConfiguration,
  pollingState: {
    elapsedSeconds: number,
    totalSeconds: 300,         // 5 minutes
    status: 'pending',
    retryAttempt: number,      // 0-3
  },
  error: null,
}
```

**UI Rendering**:
- PollingIndicator component
- Spinner animation
- Status message: "Processing backtest..."
- Elapsed time: "45s of 300s"
- Progress bar (optional)
- Buttons: [Retry], [Cancel]

**Polling Loop**:
- Every 2 seconds: GET `/backtest/{backtestId}/status`
- Response handling:
  - `status === 'pending'`: Continue polling, increment elapsed time
  - `status === 'completed'`: Fetch results → RESULTS_LOADED
  - `status === 'failed'`: Extract failure reason → BACKTEST_FAILED
  - Network error: Retry with backoff → NETWORK_ERROR (if 3 retries exhausted)

**Timeout Monitor**:
- If `elapsedSeconds >= 300` (5 minutes): Transition to POLLING_TIMEOUT (but keep polling in background)

**Exit Conditions**:
- User click Cancel → CONFIGURATION_IDLE (discard backtestId)
- Polling receives completed status → fetch results → RESULTS_LOADED
- Polling receives failed status → BACKTEST_FAILED
- Polling timeout (5 min) → POLLING_TIMEOUT
- Network errors (3 retries) → NETWORK_ERROR

---

### State: POLLING_TIMEOUT

**Description**: Backtest still processing after 5 minutes; user notified of timeout

**Properties**:
```typescript
{
  currentView: 'polling',
  backtestId: string,          // Continue polling in background
  pollingState: {
    elapsedSeconds: ≥300,
    status: 'pending',
  },
  error: {
    code: 'TIMEOUT',
    message: 'Backtest processing is taking longer than expected',
    recoveryAction: 'retry',
  }
}
```

**UI Rendering**:
- PollingIndicator with timeout message
- Orange/warning color
- Buttons: [Retry], [Check Status], [Cancel]

**Background Activity**:
- Polling continues every 2s (in case backtest completes soon)

**Exit Conditions**:
- User click Retry → Reset elapsed time counter, continue polling → POLLING_ACTIVE
- User click Check Status → Immediate status check, response determines next state
- User click Cancel → CONFIGURATION_IDLE
- Polling receives completed/failed while user waits → Transition accordingly

---

### State: RESULTS_LOADED

**Description**: Backtest completed successfully; results displayed

**Properties**:
```typescript
{
  currentView: 'results',
  backtestId: string,
  results: BacktestResults,    // Full results object
  submittedConfig: BacktestConfiguration,
  error: null,
}
```

**UI Rendering**:
- ResultsDashboard component
- PnlSummary metrics (ROI, Max Drawdown, Fees)
- SafetyOrderChart (bar chart / list toggle)
- TradeEventsTable (paginated or virtual scrolled)
- Buttons: [Run New Backtest], [Modify & Re-run]

**User Actions**:
- Click Run New → Reset form, go to CONFIGURATION_IDLE
- Click Modify & Re-run → Pre-populate form with previous config, go to CONFIGURATION_IDLE
- Browser back/forward navigation → Results remain in session

**Session Persistence**:
- Results kept in state during browser session
- If user refreshes browser → Results lost (MVP scope)

**Exit Conditions**:
- User Run New → CONFIGURATION_IDLE (reset)
- User Modify → CONFIGURATION_IDLE (pre-populated)

---

### State: BACKTEST_FAILED

**Description**: Backtest processing failed (business logic error on backend)

**Properties**:
```typescript
{
  currentView: 'polling',  // Or custom error view
  backtestId: string,
  error: {
    code: 'BACKTEST_FAILED',
    message: 'Backtest failed',
    details: 'Insufficient balance for entry order',  // From API
    recoveryAction: 'retry',
  }
}
```

**UI Rendering**:
- PollingIndicator or ErrorPage component
- Error icon + message
- Failure reason from API (if provided)
- Buttons: [Run New Backtest], [Retry], [Modify]

**Exit Conditions**:
- User Run New → CONFIGURATION_IDLE (reset)
- User Retry → Back to POLLING_ACTIVE (restart polling)
- User Modify → CONFIGURATION_IDLE (pre-populated)

---

### State: SUBMISSION_ERROR

**Description**: Form submission failed (validation or server error)

**Properties**:
```typescript
{
  currentView: 'configuration',
  error: {
    code: 'VALIDATION_ERROR' | 'API_ERROR',
    message: string,
    details?: Record<string, string>,  // Field-level errors from server
  }
}
```

**UI Rendering**:
- ConfigurationForm with error message
- Field-level error messages (if validation error)
- Generic error message (if server error)
- Submit button enabled (user can retry)

**Exit Conditions**:
- User modifies form + clicks Submit → SUBMITTING_CONFIG

---

### State: NETWORK_ERROR

**Description**: Network connectivity issue during polling

**Properties**:
```typescript
{
  currentView: 'polling',
  backtestId: string,
  pollingState: {
    retryAttempt: number,  // 1-3
    nextRetryAttempt: timestamp,  // Exponential backoff: 1s, 2s, 4s
  },
  error: {
    code: 'NETWORK_ERROR',
    message: 'Connection lost. Retrying...',
    recoveryAction: 'retry',
  }
}
```

**UI Rendering**:
- PollingIndicator with network error message
- Show retry attempt count: "Retry attempt 1 of 3..."
- Auto-retry with countdown: "Retrying in 2 seconds..."
- Buttons: [Retry Now], [Cancel]

**Auto-Retry Strategy**:
- 1st attempt: Wait 1 second, retry
- 2nd attempt: Wait 2 seconds, retry
- 3rd attempt: Wait 4 seconds, retry
- 4th failure: Transition to POLLING_TIMEOUT or offer manual retry

**Exit Conditions**:
- User Retry Now → Immediate retry attempt
- User Cancel → CONFIGURATION_IDLE
- Retry succeeds → Back to POLLING_ACTIVE
- Max retries exhausted → POLLING_TIMEOUT

---

## Event Definitions

### Event: USER_SUBMIT_FORM

**Trigger**: User clicks Submit button on ConfigurationForm  
**Precondition**: Form is valid (all validations pass client-side)  
**Action**: 
1. Validate form locally one more time
2. POST /backtest with config
3. Transition to SUBMITTING_CONFIG
**Next State**: SUBMITTING_CONFIG (or error states if request fails)

### Event: SUBMIT_SUCCESS

**Trigger**: POST /backtest returns 201 with backtestId  
**Action**:
1. Store backtestId in state
2. Start polling interval (2 seconds)
3. Transition to POLLING_ACTIVE
**Next State**: POLLING_ACTIVE

### Event: SUBMIT_FAILED

**Trigger**: POST /backtest returns 4xx/5xx  
**Action**:
1. Display error message (from response or generic)
2. Transition to SUBMISSION_ERROR (keep on form)
**Next State**: SUBMISSION_ERROR

### Event: POLLING_STATUS_CHANGE

**Trigger**: Polling interval fires; GET /backtest/{id}/status returns  
**Responses**:
1. `status === 'pending'`: Continue polling, update elapsed time
2. `status === 'completed'`: Fetch results → EVENT_POLLING_SUCCESS
3. `status === 'failed'`: Event POLLING_FAILED

### Event: POLLING_SUCCESS

**Trigger**: Poll receives `status === 'completed'` and GET results succeeds  
**Action**:
1. Stop polling interval
2. Store results in state
3. Transition to RESULTS_LOADED
**Next State**: RESULTS_LOADED

### Event: POLLING_FAILED

**Trigger**: Poll receives `status === 'failed'`  
**Action**:
1. Stop polling interval
2. Extract failureReason from response
3. Transition to BACKTEST_FAILED
**Next State**: BACKTEST_FAILED

### Event: POLLING_TIMEOUT

**Trigger**: Elapsed time reaches 300 seconds (5 minutes) while still pending  
**Action**:
1. Display timeout message
2. Continue polling in background
3. Transition to POLLING_TIMEOUT
**Next State**: POLLING_TIMEOUT (but continue polling)

### Event: NETWORK_ERROR

**Trigger**: GET /backtest/{id}/status fails (network error, timeout, etc.)  
**Action**:
1. Increment retry counter
2. Calculate backoff time (exponential: 1s, 2s, 4s)
3. Transition to NETWORK_ERROR
4. Auto-retry after backoff
**Next State**: NETWORK_ERROR (or back to POLLING_ACTIVE on successful retry)

### Event: USER_RETRY

**Trigger**: User clicks Retry button in PollingIndicator or error state  
**Action**:
1. If in POLLING_TIMEOUT: Reset elapsed counter, restart polling
2. If in NETWORK_ERROR: Immediate retry attempt
3. If in BACKTEST_FAILED: Restart polling (requeue backtest? or just check status?)
**Next State**: POLLING_ACTIVE or NETWORK_ERROR (depending on context)

### Event: USER_CANCEL

**Trigger**: User clicks Cancel button in PollingIndicator  
**Action**:
1. Stop polling interval
2. Discard backtestId and submitted config
3. Reset form (or keep previous values)
4. Transition to CONFIGURATION_IDLE
**Next State**: CONFIGURATION_IDLE

### Event: USER_RUN_NEW

**Trigger**: User clicks "Run New Backtest" button on ResultsDashboard  
**Action**:
1. Clear form fields to defaults
2. Clear results, backtestId, error
3. Transition to CONFIGURATION_IDLE
**Next State**: CONFIGURATION_IDLE (clean)

### Event: USER_MODIFY

**Trigger**: User clicks "Modify & Re-run" button on ResultsDashboard  
**Action**:
1. Pre-populate form with previous backtestConfig
2. Clear results, backtestId, error
3. Transition to CONFIGURATION_IDLE
**Next State**: CONFIGURATION_IDLE (form pre-populated)

---

## State Transition Table

| Current State | Event | Next State | Side Effects |
|---|---|---|---|
| CONFIGURATION_IDLE | USER_SUBMIT_FORM | SUBMITTING_CONFIG | POST /backtest |
| SUBMITTING_CONFIG | SUBMIT_SUCCESS | POLLING_ACTIVE | Start interval, store backtestId |
| SUBMITTING_CONFIG | SUBMIT_FAILED | SUBMISSION_ERROR | Show error, keep form |
| POLLING_ACTIVE | POLLING_SUCCESS | RESULTS_LOADED | Stop polling, fetch results |
| POLLING_ACTIVE | POLLING_FAILED | BACKTEST_FAILED | Stop polling, show failure reason |
| POLLING_ACTIVE | POLLING_TIMEOUT | POLLING_TIMEOUT | Continue polling in background |
| POLLING_ACTIVE | NETWORK_ERROR | NETWORK_ERROR | Exponential backoff, auto-retry |
| POLLING_ACTIVE | USER_CANCEL | CONFIGURATION_IDLE | Stop polling, clear state |
| POLLING_TIMEOUT | USER_RETRY | POLLING_ACTIVE | Reset elapsed timer, continue |
| POLLING_TIMEOUT | USER_CANCEL | CONFIGURATION_IDLE | Stop polling, clear state |
| POLLING_TIMEOUT | POLLING_SUCCESS | RESULTS_LOADED | (While waiting, backtest completes) |
| POLL_FAILED | USER_RETRY | POLLING_ACTIVE | Restart polling or resubmit? |
| POLL_FAILED | USER_RUN_NEW | CONFIGURATION_IDLE | Reset form |
| RESULTS_LOADED | USER_RUN_NEW | CONFIGURATION_IDLE | Reset form, clear results |
| RESULTS_LOADED | USER_MODIFY | CONFIGURATION_IDLE | Pre-populate form, clear results |
| SUBMISSION_ERROR | USER_SUBMIT_FORM | SUBMITTING_CONFIG | User corrected form and resubmitted |
| NETWORK_ERROR | (auto-retry succeeds) | POLLING_ACTIVE | Resume normal polling |
| NETWORK_ERROR | (max retries) | POLLING_TIMEOUT | Offer manual retry |
| NETWORK_ERROR | USER_RETRY | POLLING_ACTIVE | Immediate retry attempt |

---

## Guard Conditions

**Guard: FormValid**
```typescript
const isFormValid = (formState: FormState): boolean => {
  return (
    formState.isValid &&
    formState.values.entryPrice > 0 &&
    formState.values.amounts.length > 0 &&
    formState.values.sequences > 0 &&
    formState.values.leverage > 0 &&
    formState.values.marginRatio >= 0 &&
    formState.values.marginRatio < 1
  );
};
```

**Guard: MaxRetriesExhausted**
```typescript
const isMaxRetriesExhausted = (retryCount: number): boolean => retryCount >= 3;
```

**Guard: TimeoutExceeded**
```typescript
const isTimeoutExceeded = (elapsedSeconds: number): boolean => elapsedSeconds >= 300;
```

---

## Implementation Notes

### Polling Loop Implementation

```typescript
function useBacktestPolling(props: UseBacktestPollingProps) {
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<'pending' | 'completed' | 'failed'>('pending');
  const [retries, setRetries] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const pollOnce = async () => {
      try {
        const response = await getStatus(props.backtestId);
        
        // Handle responses
        if (response.data.status === 'completed') {
          clearInterval(intervalRef.current!);
          const results = await getResults(props.backtestId);
          props.onComplete(results.data);
        } else if (response.data.status === 'failed') {
          clearInterval(intervalRef.current!);
          props.onError({ code: 'BACKTEST_FAILED', message: response.data.failureReason });
        }
      } catch (error) {
        // Handle network error
        if (retries >= 3) {
          props.onError({ code: 'NETWORK_ERROR', message: 'Max retries reached' });
        } else {
          const backoff = Math.pow(2, retries) * 1000; // 1s, 2s, 4s
          setRetries(r => r + 1);
          // Retry after backoff
          setTimeout(pollOnce, backoff);
          return; // Don't set interval yet
        }
      }
    };

    // Start polling loop
    intervalRef.current = setInterval(() => {
      setElapsed(e => {
        if (e >= props.timeoutThreshold!) {
          props.onTimeout();
          return e;
        }
        return e + (props.pollInterval! / 1000); // Add seconds
      });
      pollOnce();
    }, props.pollInterval || 2000);

    return () => clearInterval(intervalRef.current!);
  }, [props.backtestId]);

  return {
    isPolling: true,
    status,
    elapsedSeconds: elapsed,
    // ...
  };
}
```

### View Routing Implementation

```typescript
// App.tsx
function App() {
  const [appState, dispatch] = useReducer(appReducer, initialState);

  return (
    <main>
      {appState.currentView === 'configuration' && (
        <ConfigurationForm onSubmit={(config) => {
          dispatch({ type: 'SUBMIT_CONFIG', payload: config });
        }} />
      )}
      
      {appState.currentView === 'polling' && appState.backtestId && (
        <PollingPage
          backtestId={appState.backtestId}
          onComplete={(results) => {
            dispatch({ type: 'POLLING_SUCCESS', payload: results });
          }}
          onTimeout={() => {
            dispatch({ type: 'POLLING_TIMEOUT' });
          }}
        />
      )}
      
      {appState.currentView === 'results' && appState.results && (
        <ResultsDashboard
          results={appState.results}
          onRunNew={() => dispatch({ type: 'USER_RUN_NEW' })}
          onModify={() => dispatch({ type: 'USER_MODIFY' })}
        />
      )}
    </main>
  );
}
```

---

## Testing Strategy

Each state transition should have a test:

```typescript
describe('State Transitions', () => {
  test('CONFIGURATION_IDLE -> SUBMITTING_CONFIG on form submit', async () => {
    // Render ConfigForm
    // Fill form
    // Click submit
    // Verify state changed to SUBMITTING_CONFIG
    // Verify POST called
  });

  test('POLLING_ACTIVE -> RESULTS_LOADED when status=completed', async () => {
    // Mock API to return status='completed'
    // Mock getResults() response
    // Wait for hook to fetch results
    // Verify onComplete called
  });

  test('POLLING_ACTIVE -> POLLING_TIMEOUT after 5 minutes', async () => {
    // Mock API to always return status='pending'
    // Wait 300
 seconds
    // Verify onTimeout called
  });

  // ... more tests
});
```

---

## Summary

This state machine ensures:
1. **Single view per state**: No ambiguous UI states
2. **Clear transitions**: Every state change has well-defined triggers
3. **Error handling**: Network errors, API errors, timeouts all have paths
4. **User recovery**: Retry, cancel, modify options available
5. **Testability**: Each transition can be tested independently
