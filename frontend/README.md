# DCA Frontend Web Application

A modern React + TypeScript + Vite web application for backtesting Dollar Cost Averaging (DCA) strategies with real-time polling and analytics visualization.

## Quick Start

### Prerequisites
- Node.js 18+
- npm 9+

### Installation

```bash
cd frontend
npm install
```

### Development

Start the development server on `http://localhost:5173`:

```bash
npm run dev
```

The application will automatically reload when you make changes to the code.

### Building

Build the application for production:

```bash
npm run build
```

Output will be in the `dist/` directory.

### Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Generate coverage report:

```bash
npm run test:coverage
```

### Code Quality

Lint the code:

```bash
npm run lint
```

Auto-fix linting issues:

```bash
npm run lint:fix
```

## Project Structure

```
frontend/
├── src/
│   ├── components/          # React components
│   ├── hooks/               # Custom React hooks
│   ├── services/            # API clients and utilities
│   ├── pages/               # Page-level containers
│   ├── __tests__/           # Test files
│   ├── App.tsx              # Root component
│   ├── main.tsx             # React entry point
│   └── index.css            # Global styles (Tailwind)
├── public/                  # Static assets
├── index.html               # HTML entry point
├── package.json             # Dependencies
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
├── jest.config.ts           # Jest testing configuration
├── tailwind.config.js       # Tailwind CSS configuration
└── README.md                # This file
```

## Technology Stack

- **React 18+** - UI library
- **TypeScript 5.1+** - Type safety
- **Vite 5+** - Build tool and dev server
- **TailwindCSS 3+** - Utility-first CSS
- **Jest 29+** - Testing framework
- **React Testing Library** - Component testing
- **Axios** - HTTP client
- **Recharts** - Charting library

## Configuration

### Environment Variables

Create a `.env.local` file in the `frontend/` directory:

```
VITE_API_BASE_URL=http://localhost:4000/api
VITE_LOG_LEVEL=debug
```

See `.env.example` for all available variables.

## Features

- **Configuration Form** - Input DCA strategy parameters
- **Real-time Polling** - Monitor backtest progress with 2-second intervals
- **Results Dashboard** - View comprehensive analytics and PnL charts
- **Trade Events Log** - Detailed record of all executed trades
- **Safety Order Analysis** - Visualization of safety order distribution

## Architecture

The application follows a three-page architecture:

1. **Configuration Page** - Form for strategy parameters
2. **Polling Page** - Real-time progress indicator
3. **Results Page** - Analytics dashboard

State management is centralized in the root App component with hooks-based state coordination.

## Contributing

When contributing code:

1. Write tests first (TDD methodology)
2. Ensure all tests pass with `npm test`
3. Run linting with `npm run lint:fix`
4. Follow the existing code style (Prettier configured)

## License

Proprietary - DCA Backtesting Platform
