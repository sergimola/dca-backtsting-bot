import pg from 'pg';
const client = new pg.Client('postgresql://dca_user:dca_pass@localhost:5532/dca_bot');
await client.connect();
const res = await client.query(
  "SELECT run_id, longest_trade_duration_ms, max_safety_orders_used, promoted_at FROM sweep_run_summaries WHERE session_id = '42c4cde0-7189-4f27-8646-81742f0e89a4' LIMIT 5"
);
console.log(JSON.stringify(res.rows, null, 2));
await client.end();
