# Quickstart Guide: DCA Frontend Web Application Setup

**Date**: March 8, 2026  
**Document**: Developer setup and local development guide

---

## Prerequisites

- **Node.js**: v18+ (check with `node --version`)
- **npm**: v9+ (comes with Node.js)
- **Git**: For version control
- **API Layer Running**: Feature 004 backend should be running on http://localhost:3000 (configurable)

---

## Project Initialization

### Step 1: Create Vite React Project

```bash
cd "d:\personal\bot-dca\dca-bot\DCA Backtesting bot"

# Create Vite React + TypeScript project
npm create vite@latest frontend -- --template react-ts

# Navigate to project
cd frontend
```

### Step 2: Install Dependencies

```bash
npm install
```

**Key Dependencies Installed**:
- `react` (18+)
- `react-dom` (18+)
- `typescript` (5.1+)
- `vite` (5+)
- `tailwindcss` (3+)
- `axios` (1+)
- `recharts` (~60KB)

For full package.json, see [Dependencies Reference](#dependencies-reference) below.

### Step 3: Configure TypeScript

Create/update `tsconfig.json` for strict type checking:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": false,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": "src",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "**/*.test.ts", "**/*.test.tsx"]
}
```

### Step 4: Configure TailwindCSS

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Update `tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        profit: '#10b981',  // Green
        loss: '#ef4444',    // Red
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

Update `src/index.css` with Tailwind directives:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Step 5: Configure ESLint & Prettier

```bash
npm install -D eslint @eslint/js typescript-eslint prettier
npm install -D @types/node
```

Create `.eslintrc.json`:

```json
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module"
  },
  "rules": {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
    "react/react-in-jsx-scope": "off"
  }
}
```

Create `prettier.config.js`:

```javascript
export default {
  singleQuote: true,
  trailingComma: 'es5',
  useTabs: false,
  tabWidth: 2,
  semi: true,
  printWidth: 100,
  arrowParens: 'always',
};
```

Create `.prettierignore`:

```
dist/
coverage/
node_modules/
*.log
```

### Step 6: Configure Jest & React Testing Library

```bash
npm install -D jest ts-jest @types/jest @testing-library/react @testing-library/jest-dom jsdom
```

Create `jest.config.js`:

```javascript
export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts(x)?', '**/*.(test|spec).ts(x)?'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/main.tsx',
    '!src/**/*.d.ts',
  ],
};
```

Create `src/__tests__/setup.ts`:

```typescript
import '@testing-library/jest-dom';
```

---

## Project Structure

After setup, your project should look like:

```
frontend/
├── src/
│   ├── main.tsx              # React entry
│   ├── App.tsx               # Root component
│   ├── index.css             # Global Tailwind styles
│   ├── components/           # React components
│   ├── hooks/                # Custom hooks
│   ├── services/             # API communication
│   ├── pages/                # Page containers (optional)
│   └── __tests__/            # Test files
├── public/                   # Static assets
├── index.html                # Vite entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── jest.config.js
├── .eslintrc.json
├── prettier.config.js
└── .gitignore
```

---

## Development Workflow

### Start Development Server

```bash
npm run dev
```

Opens http://localhost:5173 in your browser.

Server has HMR (hot module replacement): changes save automatically.

### Make It Connect to Local API

Create `.env.development`:

```
VITE_API_BASE_URL=http://localhost:3000
```

In your API client (`src/services/backtest-api.ts`):

```typescript
import axios from 'axios';

const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const client = axios.create({
  baseURL: apiUrl,
  timeout: 10000,
});

export const submitBacktest = (config: BacktestConfiguration) =>
  client.post('/backtest', config);

export const getStatus = (backtestId: string) =>
  client.get(`/backtest/${backtestId}/status`);

export const getResults = (backtestId: string) =>
  client.get(`/backtest/${backtestId}/results`);
```

### Run Tests

```bash
# Run all tests
npm test

# Watch mode (re-run on file change)
npm run test:watch

# Coverage report
npm run test:coverage
```

### Lint & Format Code

```bash
# Lint code
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format with Prettier
npm run format
```

### Build for Production

```bash
npm run build
```

Outputs optimized dist/ folder. Then serve:

```bash
npm run preview   # Preview build locally
```

Or deploy dist/ to a static hosting service (Vercel, Netlify, etc.).

---

## Component Setup Template

### 1. Create a Component

`src/components/ConfigurationForm.tsx`:

```typescript
import React, { useState } from 'react';
import { BacktestConfiguration } from '@/services/types';

interface ConfigurationFormProps {
  onSubmit: (config: BacktestConfiguration) => void;
}

export const ConfigurationForm: React.FC<ConfigurationFormProps> = ({ onSubmit }) => {
  const [config, setConfig] = useState<BacktestConfiguration>({
    entryPrice: 100,
    amounts: [50, 100, 150],
    sequences: 3,
    leverage: 2,
    marginRatio: 0.5,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(config);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label>Entry Price</label>
        <input
          type="number"
          step="0.01"
          value={config.entryPrice}
          onChange={(e) => setConfig({ ...config, entryPrice: parseFloat(e.target.value) })}
          className="w-full px-3 py-2 border rounded-md"
        />
      </div>
      {/* More fields... */}
      <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-md">
        Submit
      </button>
    </form>
  );
};
```

### 2. Create a Hook

`src/hooks/useFormValidation.ts`:

```typescript
import { useState, useCallback } from 'react';
import { BacktestConfiguration } from '@/services/types';

export function useFormValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((config: BacktestConfiguration): boolean => {
    const newErrors: Record<string, string> = {};

    if (config.entryPrice <= 0) {
      newErrors.entryPrice = 'Must be greater than 0';
    }

    if (!config.amounts || config.amounts.length === 0) {
      newErrors.amounts = 'At least one amount required';
    }

    // Add more validations...

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, []);

  return { errors, validate };
}
```

### 3. Create a Service

`src/services/backtest-api.ts`:

```typescript
import axios from 'axios';
import type {
  BacktestConfiguration,
  BacktestSubmissionResponse,
  BacktestStatusResponse,
  BacktestResults,
} from './types';

const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const client = axios.create({
  baseURL: apiUrl,
  timeout: 10000,
});

export const submitBacktest = (config: BacktestConfiguration) =>
  client.post<BacktestSubmissionResponse>('/backtest', config);

export const getStatus = (backtestId: string) =>
  client.get<BacktestStatusResponse>(`/backtest/${backtestId}/status`);

export const getResults = (backtestId: string) =>
  client.get<BacktestResults>(`/backtest/${backtestId}/results`);
```

### 4. Create Tests

`src/components/__tests__/ConfigurationForm.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigurationForm } from '../ConfigurationForm';

test('renders form with input fields', () => {
  const handleSubmit = jest.fn();
  render(<ConfigurationForm onSubmit={handleSubmit} />);

  expect(screen.getByLabelText(/Entry Price/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument();
});

test('calls onSubmit when form is submitted', () => {
  const handleSubmit = jest.fn();
  render(<ConfigurationForm onSubmit={handleSubmit} />);

  fireEvent.click(screen.getByRole('button', { name: /Submit/i }));

  expect(handleSubmit).toHaveBeenCalled();
});
```

---

## Environment Variables

Create `.env.development` and `.env.production`:

**Development**:
```
VITE_API_BASE_URL=http://localhost:3000
VITE_LOG_LEVEL=debug
```

**Production**:
```
VITE_API_BASE_URL=https://api.dca-bot.example.com
VITE_LOG_LEVEL=info
```

Access in code:
```typescript
const apiUrl = import.meta.env.VITE_API_BASE_URL;
const logLevel = import.meta.env.VITE_LOG_LEVEL;
```

---

## Debugging

### Browser DevTools

1. Open http://localhost:5173 in Chrome/Firefox/Safari
2. F12 → DevTools → Console/Network/React Developer Tools

### React DevTools Extension

Install from Chrome Web Store / Firefox Add-ons:
- "React Developer Tools" by Facebook

Allows inspection of component tree, props, state.

### ESLint Inspection in VS Code

Install "ESLint" extension (dbaeumer.vscode-eslint).

Auto-shows lint errors in editor as you type.

### TypeScript Type Checking in Terminal

```bash
npx tsc --noEmit   # Check types without emitting JS
```

---

## Common Issues & Solutions

### Issue: Port 5173 Already in Use

**Solution**:
```bash
npm run dev -- --port 5174
```

Or find and kill process:
```bash
# On Windows
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

### Issue: API CORS Error

**Problem**: Frontend at http://localhost:5173 can't reach backend at http://localhost:3000

**Solution**: Backend should have CORS headers:

```typescript
// In orchestrator/api/src/main.ts
import cors from 'cors';
app.use(cors()); // Allow all origins in dev
```

### Issue: TypeScript Errors in Components

**Solution**: Check tsconfig.json `strict: true` is enabled; fix type annotations

### Issue: Styles Not Applying

**Verify**:
1. `src/index.css` has @tailwind directives
2. `tailwind.config.ts` includes `'./src/**/*.{ts,tsx}'`
3. Main.tsx imports `index.css`:
   ```typescript
   import './index.css'
   ```

### Issue: Mock API Not Working in Tests

**Solution**: Install MSW for mocking:

```bash
npm install -D msw
```

Create `src/__tests__/mocks/handlers.ts`:

```typescript
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('/backtest', async () => {
    return HttpResponse.json({ backtestId: 'mock-123', status: 'pending' });
  }),
];
```

---

## Dependencies Reference

### package.json (Complete)

```json
{
  "name": "@dca-bot/frontend",
  "version": "0.1.0",
  "description": "React SPA for DCA backtest configuration and results visualization",
  "main": "dist/main.js",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src --ext .ts,.tsx",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx,json}\"",
    "clean": "rm -rf dist coverage .eslintcache"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "axios": "^1.6.0",
    "recharts": "^2.11.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/node": "^20.10.0",
    "@types/jest": "^30.0.0",
    "@testing-library/react": "^15.0.0",
    "@testing-library/jest-dom": "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^8.56.1",
    "@typescript-eslint/parser": "^8.56.1",
    "typescript": "^5.4.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^10.0.0",
    "@eslint/js": "^10.0.0",
    "prettier": "^3.1.0",
    "jest": "^30.0.0",
    "ts-jest": "^29.1.0",
    "jsdom": "^24.0.0",
    "identity-obj-proxy": "^3.0.0"
  }
}
```

---

## Next Steps

1. ✅ Complete this setup (Steps 1-6)
2. Create folder structure (components/, hooks/, services/, pages/, __tests__/)
3. Implement ConfigurationForm component
4. Implement useBacktestPolling hook
5. Implement API service (backtest-api.ts)
6. Build out remaining components (PnlSummary, SafetyOrderChart, TradeEventsTable)
7. Write comprehensive tests
8. Optimize build (treeshake, code split, bundle analysis)
9. Deploy to production

---

## Resources

- **Vite Docs**: https://vitejs.dev/
- **React 18 Docs**: https://react.dev/
- **TailwindCSS**: https://tailwindcss.com/
- **TypeScript Handbook**: https://www.typescriptlang.org/docs/
- **React Testing Library**: https://testing-library.com/react
- **Axios**: https://axios-http.com/
- **Recharts**: https://recharts.org/

---

## Troubleshooting

For issues not covered above, check:
1. Browser console (F12) for error messages
2. Terminal output for build/server errors
3. `.specify/` templates for additional guidance
4. Spec requirements in [spec.md](spec.md)
5. Plan details in [plan.md](plan.md)

**Questions?** Refer to [ARCHITECTURE.md](ARCHITECTURE.md) for design details or reach out to the DCA Bot team.
