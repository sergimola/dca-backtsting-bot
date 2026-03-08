# Research Phase 0: DCA Frontend Design Decisions

**Date**: March 8, 2026  
**Status**: Complete  
**Format**: Decision → Rationale → Alternatives Considered

---

## 1. Build Tool Choice: Vite

**Decision**: Use Vite 5+ for React app bundling and development server  
**Rationale**:
- Fast HMR (hot module replacement): <100ms for file changes vs. 3-5s with CRA
- Smaller build output: ~20% reduction in bundle size
- ES modules natively supported (no transpile overhead during dev)
- Better TypeScript integration out-of-the-box
- Growing ecosystem; widely adopted in React community (2024+)

**Alternatives Considered**:
- **Create React App (CRA)**: Rejected because heavy/slow, limited customization, less developer experience
- **Next.js**: Overkill for SPA (brings SSR, API routes which we don't need); adds server complexity
- **Parcel**: Less mature ecosystem; fewer examples/docs for React projects

**Implementation**:
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm run dev  # starts on localhost:5173
```

---

## 2. Styling Framework: TailwindCSS

**Decision**: Use TailwindCSS 3+ with utility-first approach  
**Rationale**:
- Rapid UI development with pre-defined colors, spacing, shadows
- Zero runtime overhead (pure CSS)
- Responsive design built-in (mobile-first)
- Color palette can be customized for DCA theme (green for profit, red for loss)
- Consistent with modern React ecosystem

**Alternatives Considered**:
- **CSS Modules**: Works but requires manual naming; less consistency
- **Styled-Components**: Runtime JS; adds ~15KB to bundle; overkill for simple forms
- **Material-UI (MUI)**: Heavy, opinionated components; requires theme customization

**Configuration**:
- Minimal custom config needed; default Tailwind has most needed utilities
- Define custom color in `tailwind.config.ts`: `extend.colors: { profit: '#10b981', loss: '#ef4444' }`

---

## 3. Charting Library: Recharts

**Decision**: Use Recharts for Safety Order Usage bar chart  
**Rationale**:
- Lightweight (~60KB gzip); optimized for React
- Composable component API: `<BarChart>`, `<Bar>`, `<XAxis>`, `<YAxis>` match React paradigm
- Responsive out-of-the-box (adapts to container width)
- Accessible (ARIA labels, keyboard navigation)
- Large community; well-documented

**Alternatives Considered**:
- **Chart.js**: Requires wrapper library (react-chartjs-2); canvas-based; less React-native
- **D3**: Powerful but steep learning curve; overkill for single bar chart; ~150KB
- **Custom Canvas**: Would need to build responsiveness, accessibility, tooltips from scratch
- **Nivo**: Built on D3; similar bundle size as Recharts but less popular

**Example Usage**:
```jsx
<BarChart data={safetyOrderData} width={600} height={300}>
  <XAxis dataKey="soLevel" />
  <YAxis />
  <Bar dataKey="count" fill="#3b82f6" />
  <Tooltip />
</BarChart>
```

---

## 4. State Management: React Context + Hooks

**Decision**: Use React's built-in Context API + custom hooks for state (no Redux/Zustand)  
**Rationale**:
- Simple application: only 3 views (config, polling, results); no complex state updates
- Context API sufficient for single-user session data
- Avoids dependency bloat; custom hooks are composable and testable
- Easier debugging (no Redux DevTools needed for MVP)

**Alternatives Considered**:
- **Redux**: Overkill for simple state; requires boilerplate (actions, reducers, selectors)
- **Zustand**: Good but unnecessary for 3 views; would add ~2KB for minimal benefit

**Implementation**: App.tsx as root state container; useBacktestPolling hook for polling logic

---

## 5. HTTP Client: Axios vs. Fetch API

**Decision**: Use Axios 1+ for HTTP requests  
**Rationale**:
- Built-in request/response interceptors (useful for retry logic, auth headers)
- Cleaner error handling (distinguishes network vs. HTTP errors)
- Automatic JSON serialization/deserialization
- Timeout support out-of-the-box
- Lighter than alternatives; ~15KB gzip

**Alternatives Considered**:
- **Fetch API**: Built-in but error handling is verbose; timeouts require AbortController
- **Superagent**: Similar to Axios; smaller (~18KB) but less adoption

**Configuration**:
```typescript
// src/services/backtest-api.ts
import axios from 'axios';

const client = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000',
  timeout: 10000, // 10 second timeout
});

export const submitBacktest = (config: Config) =>
  client.post('/backtest', config);

export const getStatus = (backtestId: string) =>
  client.get(`/backtest/${backtestId}/status`);

export const getResults = (backtestId: string) =>
  client.get(`/backtest/${backtestId}/results`);
```

---

## 6. Polling Implementation: Custom Hook

**Decision**: Implement custom `useBacktestPolling` hook; do not use external polling library  
**Rationale**:
- Polling logic is simple: 2-second intervals, 5-minute timeout
- Custom hook provides full control over retry logic, backoff strategy
- No external dependency needed; ~100 lines of code
- Fully testable; easy to modify polling behavior

**Alternatives Considered**:
- **react-query/TanStack Query**: Full-featured data fetching; overkill for single polling endpoint; adds 50KB
- **Custom setInterval**: Hook encapsulates concerns (timing, cleanup, error handling)

**Hook Signature**:
```typescript
interface UseBacktestPollingProps {
  backtestId: string;
  onComplete: (results: BacktestResults) => void;
  onError: (error: Error) => void;
  onTimeout: () => void;
  pollInterval?: number; // ms, default 2000
  timeoutThreshold?: number; // ms, default 5*60*1000
}

function useBacktestPolling(props: UseBacktestPollingProps): {
  isPolling: boolean;
  status: 'pending' | 'completed' | 'failed';
  elapsedSeconds: number;
  errorMessage?: string;
}
```

**Implementation Strategy**:
- Track elapsed time with `startTime` ref
- Use `setInterval` to poll every `pollInterval` ms
- Check `elapsed >= timeoutThreshold` and call `onTimeout()`
- On 'completed' status, call `getResults()` then `onComplete(results)`
- Exponential backoff retry on network errors (max 3 attempts)
- Cleanup interval on unmount or when polling completes

---

## 7. Form Validation: Client-Side (MVP)

**Decision**: Implement client-side validation only (MVP phase); server also validates  
**Rationale**:
- Fast feedback: <100ms per keystroke
- Better UX (no network latency)
- Server is always authoritative (protects against tampering)
- Simplifies frontend logic

**Validation Rules**:
```typescript
interface FormValidation {
  entryPrice: number > 0;
  amounts: Array with all elements > 0, non-empty;
  sequences: integer > 0;
  leverage: number > 0;
  marginRatio: 0 <= value <= 100;
}
```

**Alternatives Considered**:
- **Server-side validation only**: Slower UX, poor feedback
- **Real-time server validation**: Adds complexity, polling overhead for MVP

**Implementation**: `useFormValidation` hook returns `{ isValid, errors }` in <100ms

---

## 8. Error Handling Strategy

**Decision**: User-friendly error messages + actionable recovery options  
**Rationale**:
- Users need to understand what went wrong and what to do next
- Reduces support burden (clear messages guide self-service recovery)
- Improves confidence in application (transparent about failures)

**Error Scenarios & Handling**:

| Scenario | Message | Recovery |
|----------|---------|----------|
| Form validation error | "Entry Price must be > 0" | User corrects field |
| Network timeout on submit | "Connection timeout. Retrying..." | Auto-retry up to 3x |
| API returns 400 (bad request) | Show field errors from response | User corrects and resubmits |
| API returns 500 (server error) | "Server error. Retrying..." | Auto-retry or manual "Retry" button |
| API returns status='failed' | "Backtest failed: {reason}" | "Retry" or "Run New Backtest" |
| Polling timeout (5 minutes) | "Processing is taking longer than expected" | "Retry" or "Check Status" |
| Network error during polling | "Connection lost. Retrying..." | Auto-retry; manual "Retry" button |

**Alternative**: Silent failures with generic "Error" message (rejected: poor UX)

---

## 9. Component Architecture: Shallow vs. Deep Trees

**Decision**: Keep component tree shallow; prop drilling acceptable for MVP  
**Rationale**:
- ~5 main components; prop drilling is manageable
- Avoids context complexity for simple state
- Easier to reason about data flow
- Better performance (fewer re-renders)

**Alternatives Considered**:
- **Heavy Context nesting**: Adds indirection; less readable for small apps
- **Redux**: Overkill; adds boilerplate

---

## 10. Browser Support: Modern Browsers (ES2020+)

**Decision**: Target modern browsers only (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)  
**Rationale**:
- React 18+ requires ES2020+ anyway
- IE11 support would add 30-50KB polyfills; not worth MVP scope
- Aligns with rest of DCA stack (orchestrator/api assumes modern Node/TS)

**Alternative**: IE11 support rejected (too expensive for single-user dev environment)

**Configuration** (tsconfig.json):
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  }
}
```

---

## 11. Testing Framework: Jest + React Testing Library

**Decision**: Use Jest + React Testing Library for unit and component tests  
**Rationale**:
- Jest: Standard testing framework in React ecosystem; fast, built-in fixtures, mocking
- React Testing Library: Tests components as users interact with them (not implementation details)
- Encourages writing more maintainable, accessible tests
- Aligns with orchestrator/api project (already using Jest)

**Alternatives Considered**:
- **Vitest**: Faster than Jest but newer; less community support
- **Enzyme**: Tests implementation details; React Testing Library is preferred industry standard

**Configuration**:
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts(x)?'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

---

## 12. Routing: React Router v6 (or Simple State)

**Decision**: If SPA stays <=3 views, use simple conditional rendering; add React Router later if needed  
**Rationale**:
- MVP scope: 3 main views (config, polling, results)
- Conditional rendering in App.tsx simpler than router setup
- Router can be added later without refactoring components
- Lighter bundle initially

**If routing becomes complex** (future):
```tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<ConfigurationPage />} />
    <Route path="/polling/:backtestId" element={<PollingPage />} />
    <Route path="/results/:backtestId" element={<ResultsPage />} />
  </Routes>
</BrowserRouter>
```

**Alternative**: React Router v6 from start (overkill for MVP)

---

## 13. API Response Format: REST JSON

**Decision**: Assume Feature 004 (API Layer) provides JSON REST endpoints  
**Rationale**:
- Spec assumes JSON API (Feature 004 uses Express.json())
- Simple, stateless, cacheable
- Aligns with industry standard

**Endpoints Expected**:
- `POST /backtest` → returns `{ backtestId, status }`
- `GET /backtest/{id}/status` → returns `{ status, progress }`
- `GET /backtest/{id}/results` → returns `{ pnlSummary, safetyOrderUsage, tradeEvents }`

**Alternative**: GraphQL (not needed for simple CRUD operations)

---

## 14. Monorepo Structure: Packages at Root Level

**Decision**: Keep frontend/ at workspace root; separate npm project  
**Rationale**:
- Clean separation from core-engine (Go) and orchestrator/api (separate TS project)
- Each project has independent package.json, build process, test suite
- Easier to develop/deploy independently

**Alternative**: Monorepo with yarn workspaces (adds complexity for MVP)

---

## 15. Build Output: dist/ Directory

**Decision**: Vite builds to dist/ (then served by Express static middleware or CDN)  
**Rationale**:
- Standard Vite convention
- dist/ can be served by Express `app.use(express.static('dist'))`
- Future CDN deployment is straightforward

---

## 16. Environment Variables: .env Files

**Decision**: Use .env files for API_BASE_URL (and future config)  
**Rationale**:
- Vite supports VITE_* prefix automatically
- .env.development for local dev (points to localhost:3000)
- .env.production for deployment (points to production API)

**Configuration**:
```
# .env.development
VITE_API_BASE_URL=http://localhost:3000

# .env.production
VITE_API_BASE_URL=https://api.dca-bot.example.com
```

**Usage**:
```typescript
const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
```

---

## 17. TypeScript Strict Mode

**Decision**: Enable TypeScript strict mode and strict null checks  
**Rationale**:
- Catches type errors at compile-time (prevents runtime bugs)
- Aligns with orchestrator/api configuration
- Better IDE support and autocomplete

**Configuration** (tsconfig.json):
```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "noImplicitThis": true
  }
}
```

---

## 18. Code Formatting: Prettier

**Decision**: Use Prettier for code formatting (auto-format on save)  
**Rationale**:
- Removes style debates (one consistent style)
- Faster code review (no formatting comments)
- Aligns with orchestrator/api setup

**prettier.config.js**:
```javascript
module.exports = {
  singleQuote: true,
  trailingComma: 'es5',
  useTabs: false,
  tabWidth: 2,
  semi: true,
  printWidth: 100,
};
```

---

## 19. Session Data Persistence (MVP)

**Decision**: Keep backtest results in component state only (no localStorage/DB)  
**Rationale**:
- MVP scope; simplifies development
- User session persists results during browser session
- localStorage can be added later for cross-session recovery

**Future Enhancement**:
```typescript
// Optional: Save to localStorage on results arrival
localStorage.setItem('lastBacktestResults', JSON.stringify(results));
```

---

## 20. Accessibility (a11y) Standards

**Decision**: WCAG 2.1 Level AA compliance (target)  
**Rationale**:
- Improves usability for all users (not just those with disabilities)
- Legal compliance in many jurisdictions
- Better SEO

**Requirements**:
- ARIA labels on form inputs
- Keyboard navigation (Tab, Shift+Tab, Enter, Escape)
- Color contrast >=4.5:1 for text (WCAG AA)
- Semantic HTML (no div-spam)
- Form error messages linked to inputs via aria-describedby

**Testing**: axe-core or Lighthouse accessibility audit (Phase 8)

---

## Summary Table

| Decision | Choice | Rationale (Brief) | Alternative | Weight |
|----------|--------|-------------------|-------------|--------|
| Build Tool | Vite | Fast HMR, small builds | CRA | High |
| Styling | TailwindCSS | Rapid dev, consistency | Styled-Components | High |
| Charts | Recharts | React-native, responsive | D3, Chart.js | Medium |
| State Mgmt | Context + Hooks | Simple, sufficient | Redux | Medium |
| HTTP | Axios | Interceptors, error handling | Fetch | Medium |
| Polling | Custom Hook | Simple, controlled | react-query | Medium |
| Forms | Client validation | Fast feedback, UX | Server-only | High |
| Testing | Jest + RTL | Industry standard | Vitest | High |
| Routing | Conditional (MVP) | Lightweight start | React Router | Low |
| Persistence | Session only (MVP) | Simplicity | localStorage | Low |
| TypeScript | Strict mode | Type safety | Loose mode | High |
| CSS | TailwindCSS | Utility-first | CSS Modules | High |

---

## Conclusion

All NEEDS CLARIFICATION items from Technical Context are now resolved. Feature 005 is ready to proceed to Phase 1 (Design & Contracts).

**Phase 0 Status**: ✅ Complete  
**Next**: Generate data-model.md, contracts/, quickstart.md
