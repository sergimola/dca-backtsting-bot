# Troubleshooting Guide

## Common Issues

### 1. Server Fails to Start

#### Error: `CORE_ENGINE_BINARY_PATH not set or binary not found`

**Cause**: Core Engine binary is missing or path is incorrect.

**Solutions**:
1. Verify binary exists:
   ```bash
   ls -la ./core-engine
   ```

2. If missing, copy it:
   ```bash
   cp ../core-engine/application/orchestrator/orchestrator ./core-engine
   chmod +x ./core-engine
   ```

3. Verify executable:
   ```bash
   ./core-engine --version
   ```

4. Set environment variable if needed:
   ```bash
   export CORE_ENGINE_BINARY_PATH=/path/to/core-engine
   npm start
   ```

---

#### Error: `Port 3000 already in use`

**Cause**: Another process is listening on the configured port.

**Solutions**:
1. Find the process:
   ```bash
   lsof -i :3000
   ```

2. Kill it (if you're sure):
   ```bash
   kill -9 <PID>
   ```

3. Or use a different port:
   ```bash
   PORT=3001 npm start
   ```

---

#### Error: `ENOENT: no such file or directory, open './storage'`

**Cause**: Storage directory doesn't exist.

**Solutions**:
1. Create directory:
   ```bash
   mkdir -p ./storage
   ```

2. Or configure a different path:
   ```bash
   STORAGE_PATH=/tmp/backtest-storage npm start
   ```

3. Ensure directory is writable:
   ```bash
   touch ./storage/test.txt && rm ./storage/test.txt
   ```

---

### 2. Backtest Requests Timeout

#### Error: `EXECUTION_TIMEOUT` (HTTP 504)

**Cause**: Backtest execution exceeded the timeout limit (default 30 seconds).

**Why**:
- Large CSV file (millions of candles)
- Complex DCA strategy (many sequences)
- Slow system resources
- Core Engine performance issue

**Solutions**:

1. **Increase timeout**:
   ```bash
   TIMEOUT_MS=60000 npm start  # 60 seconds
   ```

2. **Reduce backtest complexity**:
   - Use fewer sequences
   - Use smaller amounts
   - Try shorter time period

3. **Use smaller market data**:
   ```json
   {
     "market_data_csv_path": "./data/BTCUSDT_1h.csv"  // hourly instead of 1m
   }
   ```

4. **Check system resources**:
   ```bash
   # Memory usage
   top -p $(pgrep -f "npm start")
   
   # CPU usage
   ps aux | grep node
   ```

5. **Reduce concurrent requests**:
   - Queue requests rather than firing them simultaneously
   - Check health endpoint for queue depth

---

### 3. Backtest Execution Fails Unexpectedly

#### Error: `EXECUTION_BINARY_CRASH` (HTTP 500)

**Cause**: Core Engine binary crashed or exited with error code.

**Why**:
- Core Engine process error/panic
- Invalid market data format
- Out of memory
- Segmentation fault

**Solutions**:

1. **Check Core Engine logs**:
   ```bash
   # Run Core Engine directly to see errors
   ./core-engine --version
   
   # Try running a test
   ./core-engine --help
   ```

2. **Verify market data format**:
   ```bash
   # Check CSV structure
   head -n 20 ./data/BTCUSDT_1h.csv
   
   # Validate with Core Engine
   ./core-engine --validate-csv ./data/BTCUSDT_1h.csv
   ```

3. **Increase memory**:
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm start
   ```

4. **Check error details in response**:
   - Look at `error.details.stderr_snippet` for Core Engine output
   - Check application logs for full Core Engine output

5. **Rebuild Core Engine**:
   ```bash
   cd ../core-engine/application/orchestrator
   go build -o orchestrator
   cp orchestrator ../../../api/core-engine
   ```

---

### 4. API Returns 400 Validation Errors

#### Error: `VALIDATION_FLOAT_PRECISION`

```json
{
  "error": {
    "code": "VALIDATION_FLOAT_PRECISION",
    "message": "Field 'entry_price' must be a decimal string, not a float"
  }
}
```

**Cause**: Numeric value provided as float instead of decimal string.

**Solution**: Use decimal strings with exactly 8 decimal places:

```json
{
  "entry_price": "100.50000000"  // ✓ Correct
}
```

Not:
```json
{
  "entry_price": 100.50          // ✗ Float - WRONG
}
```

---

#### Error: `VALIDATION_OUT_OF_BOUNDS`

```json
{
  "error": {
    "code": "VALIDATION_OUT_OF_BOUNDS",
    "message": "Field 'margin_ratio' is out of bounds. Expected range: [0, 1). Got: 1.50000000"
  }
}
```

**Cause**: Value outside valid range.

**Solution**: Adjustvalue to be within valid ranges:

| Field | Min | Max |
|-------|-----|-----|
| `margin_ratio` | 0 | < 1 |
| `leverage` | 1 | 100 |
| `entry_price` | > 0 | unlimited |

Example fix for margin_ratio:
```json
{
  "margin_ratio": "0.75000000"  // Must be < 1.0
}
```

---

#### Error: `VALIDATION_MISSING_FIELD`

```json
{
  "error": {
    "code": "VALIDATION_MISSING_FIELD",
    "message": "Missing required field: entry_price"
  }
}
```

**Cause**: Required field is missing from request.

**Solution**: Include all required fields:

```json
{
  "entry_price": "100.50000000",
  "amounts": ["10.00000000"],
  "sequences": [0],
  "leverage": "2.00000000",
  "margin_ratio": "0.75000000",
  "market_data_csv_path": "/data/BTCUSDT_1h.csv"
}
```

---

### 5. Query Results Returns Empty (404)

#### Error: `GET /backtest/:request_id` returns 404

**Cause**: Result not found or expired.

**Why**:
- Result expired (default 7 days TTL)
- Request ID doesn't exist
- Wrong format request ID

**Solutions**:

1. **Use correct request ID format**:
   ```bash
   # Must be a valid UUID
   curl http://localhost:3000/backtest/550e8400-e29b-41d4-a716-446655440000
   ```

2. **Check result expiration**:
   ```bash
   RESULTS_TTL_DAYS=30 npm start  # Extend TTL
   ```

3. **Query by date range** to find results:
   ```bash
   curl "http://localhost:3000/backtest?from=2025-12-30&to=2025-12-31"
   ```

4. **Check storage directory**:
   ```bash
   ls -la ./storage/results/
   find ./storage -name "*.json" | wc -l
   ```

---

#### Error: `GET /backtest` returns no results

**Cause**: No results match the date range or filter.

**Solutions**:

1. **Verify date range**:
   ```bash
   # Use current dates
   NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   PAST=$(date -u -d "1 month ago" +%Y-%m-%dT%H:%M:%SZ)
   curl "http://localhost:3000/backtest?from=$PAST&to=$NOW"
   ```

2. **Remove status filter**:
   ```bash
   # Query all results regardless of status
   curl "http://localhost:3000/backtest?from=2025-12-01&to=2025-12-31&status=all"
   ```

3. **Check if results exist**:
   ```bash
   find ./storage -name "*.json" -type f | head -5
   ```

---

### 6. Memory Issues

#### Error: `JavaScript heap out of memory` or `ENOMEM`

**Cause**: Node.js ran out of memory.

**Solutions**:

1. **Increase Node.js heap**:
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm start
   ```

2. **Reduce worker threads**:
   ```bash
   MAX_WORKER_THREADS=2 npm start
   ```

3. **Use a 64-bit system**:
   - More addressable memory
   - Heap can grow larger

4. **Monitor memory usage**:
   ```bash
   # Watch memory in real-time
   watch -n 1 'ps aux | grep node'
   ```

5. **Analyze heap dump**:
   ```bash
   NODE_OPTIONS="--inspect" npm start
   # Then use Chrome DevTools: chrome://inspect
   ```

---

### 7. Concurrent Request Issues

#### Issue: Results appear corrupted when multiple requests run simultaneously

**Cause**: Data race or isolation issue.

**Solutions**:

1. **Verify results isolation**:
   ```bash
   # Check if request IDs are unique
   curl http://localhost:3000/backtest?from=2025-12-31&to=2025-12-31 | jq '.results[].request_id | unique | length'
   ```

2. **Enable detailed logging**:
   ```bash
   LOG_LEVEL=debug npm start
   ```

3. **Test with single request**:
   ```bash
   # Verify it works alone
   curl -X POST http://localhost:3000/backtest -H "Content-Type: application/json" -d '{...}'
   ```

4. **Check for file system issues**:
   ```bash
   # Verify storage has no corruption
   find ./storage -name "*.json" -exec validate-json {} \;
   ```

---

### 8. Health Endpoint Issues

#### Response: `status: degraded` or `unhealthy`

**Cause**: Service has issues but might still be operational.

**How to investigate**:

1. **Check health response**:
   ```bash
   curl http://localhost:3000/health | jq '.'
   ```

2. **Review error details**:
   ```bash
   curl http://localhost:3000/health | jq '.errors[]'
   ```

3. **Check dependencies**:
   ```bash
   # Verify Core Engine is accessible
   ./core-engine --version
   
   # Verify storage directory
   ls -la ./storage
   ```

4. **Check logs** for recent errors:
   ```bash
   npm start 2>&1 | grep -i error
   ```

---

### 9. Docker-Specific Issues

#### Error: `cannot execute binary file`

**Cause**: Binary wrong architecture for container OS.

**Solution**:
```dockerfile
# Ensure build and runtime use same OS
FROM node:18-alpine
RUN apk add --no-cache ca-certificates
COPY ./core-engine /app/core-engine
RUN chmod +x /app/core-engine && file /app/core-engine
```

#### Volume mount issues

**Ensure volumes are properly mounted**:
```bash
docker run \
  -v /path/to/data:/data \
  -v /path/to/storage:/data/storage \
  dca-api
```

Verify inside container:
```bash
docker exec <container-id> ls -la /data/storage/
```

---

## Performance Optimization

### Slow Backtest Execution

1. **Profile Core Engine**:
   ```bash
   # Run with profiling
   ./core-engine --profile ./core-engine.prof
   ```

2. **Check market data size**:
   ```bash
   du -sh ./data/*.csv
   ```

3. **Optimize for I/O**:
   - Use SSD for market data
   - Store results on fast disk

---

### High Memory Usage

1. **Monitor heap growth**:
   ```bash
   # Enable heap snapshots
   NODE_OPTIONS="--expose-gc --max-old-space-size=2048" npm start
   ```

2. **Check for leaks**:
   - Use Chrome DevTools
   - Monitor for sustained memory growth
   - Test with load testing tool

---

## Getting Help

### Enable Debug Logging

```bash
LOG_LEVEL=debug npm start
```

This outputs detailed logs including:
- Request/response bodies
- Database operations
- Process spawning details

### Collect Diagnostics

```bash
#!/bin/bash
echo "=== Node Version ===" 
node --version

echo "=== Environment ===" 
env | grep -E "(PORT|CORE_ENGINE|STORAGE|NODE_ENV|LOG_LEVEL)"

echo "=== File System ===" 
ls -la ./core-engine
ls -la ./storage
df -h

echo "=== Health Check ===" 
curl http://localhost:3000/health

echo "=== Recent Logs ===" 
tail -100 ./error.log
```

### Report Issue

Include:
1. Error message and stack trace
2. Request that failed (sanitized)
3. Environment variables configured
4. Diagnostics output above
5. Steps to reproduce
