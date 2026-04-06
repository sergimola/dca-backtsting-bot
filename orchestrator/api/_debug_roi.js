import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://dca_user:dca_pass@localhost:5532/dca_bot' });
client.connect().then(() =>
  client.query("SELECT run_id, roi, max_drawdown, total_fees, config_json->>'account_balance' AS account_balance, config_json->>'monthly_addition' AS monthly_injection, created_at FROM sweep_run_summaries WHERE run_id = '7679e712-3219-4655-9f76-3e64651bbdc4'")
).then(r => { console.log(JSON.stringify(r.rows, null, 2)); client.end(); }).catch(e => { console.error(e.message); client.end(); });
