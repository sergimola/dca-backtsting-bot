import 'dotenv/config';
import { db } from '../db/client.ts'; // or .js if ts-node complains
import { marketDataSyncs } from '../db/schema.ts'; // or .js

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('❌ Usage: npm run sync <symbol> <start_date> <end_date>');
    console.error('👉 Example: npm run sync BTC/USDT 2024-01-01 2024-02-01');
    process.exit(1);
  }

  const [symbol, startDateStr, endDateStr] = args;
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.error('❌ Invalid date format. Please use YYYY-MM-DD');
    process.exit(1);
  }

  console.log(`\n🚀 Starting Market Data Sync for ${symbol}`);
  console.log(`📅 Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log('--------------------------------------------------');

  try {
    const startTime = Date.now();

    // ============================================================
    // 🔌 YOUR DATA FETCHER GOES HERE
    // ============================================================
    // e.g., await MarketDataService.downloadCandles(symbol, startDate, endDate);
    //
    // For now, simulating the download delay so you can test the DB insertion:
    console.log(`⏳ Downloading 1m candles for ${symbol}... (This might take a while)`);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Fake 2-second download
    console.log(`✅ Download complete!`);
    // ============================================================

    // 💾 Record the sync in the database
    console.log(`💾 Updating market_data_syncs table...`);
    await db.insert(marketDataSyncs).values({
      symbol: symbol,
      startDate: startDate,
      endDate: endDate,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🎉 Sync finished successfully in ${duration}s!`);
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error during sync:');
    console.error(error);
    process.exit(1);
  }
}

main();