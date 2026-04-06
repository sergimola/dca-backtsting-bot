import pg from 'pg';
const { Pool } = pg;
const db = new Pool({ host: 'localhost', port: 5532, user: 'dca_user', password: 'dca_pass', database: 'dca_bot' });

// Check stats stats of aa9e5ebb runs - how many have non-zero drawdown and total stops
const r = await db.query(`
  SELECT 
    max_drawdown::numeric,
    total_stops_triggered,
    COUNT(*) AS cnt,
    AVG(roi::numeric) AS avg_roi
  FROM sweep_run_summaries
  WHERE session_id = 'aa9e5ebb-f9b0-4c08-9982-54dd90b3ee62'
  GROUP BY max_drawdown, total_stops_triggered
  ORDER BY cnt DESC
  LIMIT 10
`);
console.log('== drawdown distribution ==', JSON.stringify(r.rows, null, 2));

// Check specifically runs with total_stops > 0
const r2 = await db.query(`
  SELECT run_id, roi, max_drawdown, total_stops_triggered, created_at
  FROM sweep_run_summaries
  WHERE session_id = 'aa9e5ebb-f9b0-4c08-9982-54dd90b3ee62'
    AND total_stops_triggered > 0
  LIMIT 5
`);
console.log('== runs with SL triggered ==', JSON.stringify(r2.rows, null, 2));

await db.end();
