# Deployment Guide

## Prerequisites

- Node.js 18+ 
- npm 9+
- Core Engine binary (Go application)
- Market data CSV files

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/your-org/dca-bot.git
cd dca-bot/orchestrator/api
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build TypeScript

```bash
npm run build
```

This generates the `dist/` directory with compiled JavaScript.

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# HTTP Server
PORT=3000
NODE_ENV=production

# Core Engine
CORE_ENGINE_BINARY_PATH=./core-engine
TIMEOUT_MS=30000

# Storage
STORAGE_PATH=./storage
RESULTS_TTL_DAYS=7

# Workers
MAX_WORKER_THREADS=4

# Logging
LOG_LEVEL=info
```

**Variables**:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `NODE_ENV` | development | Environment (development/production) |
| `CORE_ENGINE_BINARY_PATH` | ./core-engine | Path to Core Engine binary |
| `TIMEOUT_MS` | 30000 | Backtest execution timeout |
| `STORAGE_PATH` | ./storage | Directory for result storage |
| `RESULTS_TTL_DAYS` | 7 | Result time-to-live in days |
| `MAX_WORKER_THREADS` | CPU count | Max concurrent workers |
| `LOG_LEVEL` | info | Logging level (debug/info/warn/error) |

### Core Engine Binary

Place the compiled Core Engine binary at the path specified by `CORE_ENGINE_BINARY_PATH`:

```bash
# Copy from build directory
cp ../core-engine/application/orchestrator/orchestrator ./core-engine

# Make executable
chmod +x ./core-engine

# Verify
./core-engine --version
```

### Market Data

Place market data CSV files in an accessible location:

```bash
mkdir -p ./data
cp /path/to/market/data/*.csv ./data/
```

Update backtest requests with paths:
```json
{
  "market_data_csv_path": "./data/BTCUSDT_1h.csv"
}
```

## Running the Server

### Development

```bash
npm run dev
```

This starts the server with auto-reloading (requires `nodemon`).

### Production

```bash
npm start
```

Or using PM2:

```bash
pm2 start dist/main.js --name "dca-api" --instances max
```

## Docker Deployment

### Build Image

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy files
COPY package*.json ./
COPY . .

# Build
RUN npm ci --only=production && npm run build

# Copy core engine
COPY ./core-engine /app/core-engine
RUN chmod +x /app/core-engine

# Expose port
EXPOSE 3000

# Start
CMD ["npm", "start"]
```

Build:
```bash
docker build -t dca-api:latest .
```

Run:
```bash
docker run -d \
  -p 3000:3000 \
  -e PORT=3000 \
  -e CORE_ENGINE_BINARY_PATH=/app/core-engine \
  -e STORAGE_PATH=/data/storage \
  -v /path/to/data:/data \
  -v /path/to/storage:/data/storage \
  --name dca-api \
  dca-api:latest
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      NODE_ENV: production
      CORE_ENGINE_BINARY_PATH: /app/core-engine
      STORAGE_PATH: /data/storage
      LOG_LEVEL: info
    volumes:
      - ./data:/data
      - ./storage:/data/storage
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Deploy:
```bash
docker-compose up -d
```

## Kubernetes Deployment

Create `k8s-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dca-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dca-api
  template:
    metadata:
      labels:
        app: dca-api
    spec:
      containers:
      - name: api
        image: dca-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: PORT
          value: "3000"
        - name: NODE_ENV
          value: "production"
        - name: LOG_LEVEL
          value: "info"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: dca-api-service
spec:
  type: LoadBalancer
  selector:
    app: dca-api
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
```

Deploy:
```bash
kubectl apply -f k8s-deployment.yaml
```

## Testing

### Run Tests

```bash
npm test
```

### Run Specific Test Suite

```bash
npm test -- us1-submit.test.ts
```

### Generate Coverage Report

```bash
npm run test:coverage
```

### Load Testing

Using Apache Bench:
```bash
ab -n 1000 -c 50 -p backtest.json \
  -T application/json \
  http://localhost:3000/backtest
```

Using wrk:
```bash
wrk -t4 -c100 -d30s -s backtest.lua http://localhost:3000/backtest
```

## Monitoring

### Health Endpoint

```bash
curl http://localhost:3000/health
```

Response indicates:
- `status: healthy` - All systems operational
- `status: degraded` - Service operational but issues detected
- `status: unhealthy` - Service cannot operate

### Logs

Logs are output to stdout in JSON format:

```bash
npm start | jq '.'
```

### Metrics

Via PM2:
```bash
pm2 monit
```

## Graceful Shutdown

The server responds to `SIGTERM` and `SIGINT` signals:

```bash
# Drain queue and shutdown
kill -TERM <pid>

# Or
Ctrl+C
```

The server:
1. Stops accepting new requests
2. Drains the pending work queue (max 30 seconds)
3. Stops background jobs
4. Exits

## Troubleshooting

### Port Already in Use

```bash
# Find process
lsof -i :3000

# Kill process
kill -9 <pid>
```

### Core Engine Binary Not Found

Error: `CORE_ENGINE_BINARY_PATH not set or binary not found`

Solution:
1. Copy binary to the correct path
2. Make executable: `chmod +x ./core-engine`
3. Set `CORE_ENGINE_BINARY_PATH` environment variable

### Out of Memory

If backtest runs fail with out-of-memory:
1. Increase Node.js memory: `NODE_OPTIONS="--max-old-space-size=4096"`
2. Reduce `MAX_WORKER_THREADS`
3. Increase server resources

### Timeout Issues

If backtests timeout frequently:
1. Increase `TIMEOUT_MS` environment variable
2. Check CPU and memory usage
3. Verify market data file sizes
4. Review Core Engine logs

## Backup & Recovery

### Backup Results

```bash
tar -czf backtest-storage-$(date +%s).tar.gz ./storage
```

### Restore Results

```bash
tar -xzf backtest-storage-*.tar.gz
```

### Storage Cleanup

Results older than `RESULTS_TTL_DAYS` are automatically cleaned up. Manual cleanup:

```bash
rm ./storage/results/empty_*.json
```

## Scaling

### Horizontal Scaling

Deploy multiple instances:
- Behind a load balancer (nginx, HAProxy)
- Shared storage backend (e.g., S3, NFS)
- Distributed cache (e.g., Redis)

### Vertical Scaling

Increase resources:
- `MAX_WORKER_THREADS` (up to CPU count)
- Node.js heap size
- Available disk space

## Security

### API Security

For production, add:
1. **CORS Configuration**: Restrict origins
2. **Rate Limiting**: Implement per-client limits
3. **Authentication**: Add token/key validation
4. **HTTPS**: Use SSL/TLS termination proxy

### Data Security

1. **Encryption**: Encrypt sensitive data at rest
2. **Access Control**: Restrict file access
3. **Audit Logging**: Log all API requests
4. **Backups**: Regular encrypted backups

## Performance Tuning

### Node.js Options

```bash
NODE_OPTIONS="--max-old-space-size=4096 --enable-source-maps" npm start
```

### Database Connection Pooling

Configure connection pool size in storage service.

### Caching

Enable HTTP caching for health endpoint:
```bash
# In production proxy (nginx)
add_header Cache-Control "max-age=10, public";
```

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Core Engine binary copied and executable
- [ ] Market data files available
- [ ] Tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] Linter passes: `npm run lint`
- [ ] Storage directory writable
- [ ] Sufficient disk space for results
- [ ] Health endpoint responding
- [ ] Sample backtest request succeeds
- [ ] Monitoring configured
- [ ] Backups scheduled
- [ ] Runbooks documented
