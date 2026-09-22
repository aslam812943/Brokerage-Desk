const { Pool } = require('pg');
require('@next/env').loadEnvConfig(__dirname);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured before running this script.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
    console.log('--- PUBLIC TABLES ---');
    for (const r of res.rows) {
      const t = r.table_name;
      try {
        const c = await pool.query(`SELECT count(*) FROM "${t}"`);
        console.log(`${t}: ${c.rows[0].count} rows`);
      } catch (err) {
        console.log(`${t}: error (${err.message})`);
      }
    }

    console.log('\n--- TARGETS ---');
    const targets = await pool.query('SELECT * FROM "Targets" LIMIT 5');
    console.log(JSON.stringify(targets.rows, null, 2));

    console.log('\n--- DEALERS ---');
    const dealers = await pool.query('SELECT * FROM "Dealer" ORDER BY name');
    console.log(`Dealers count: ${dealers.rows.length}`);
    console.log(dealers.rows.map(d => d.name));

    console.log('\n--- RMS ---');
    const rms = await pool.query('SELECT * FROM "Rm" ORDER BY name');
    console.log(`RMs count: ${rms.rows.length}`);
    console.log(rms.rows.map(r => r.name));

    console.log('\n--- DAILY DATES SUMMARY (Top 15) ---');
    const dailyDates = await pool.query('SELECT date, count(*) as records, sum("netBrok") as total_brok, count(distinct code) as clients FROM "DailyRecord" GROUP BY date ORDER BY date DESC LIMIT 15');
    console.log(dailyDates.rows);

    console.log('\n--- DEBIT DATES SUMMARY (Top 15) ---');
    const debitDates = await pool.query('SELECT date, count(*) as records, sum(debit) as total_debit FROM "DebitRecord" GROUP BY date ORDER BY date DESC LIMIT 15');
    console.log(debitDates.rows);

    console.log('\n--- MASTER CLIENTS SUMMARY ---');
    const clientStats = await pool.query('SELECT count(*) as total_clients, count(distinct dealer) as dealers_used, count(distinct rm) as rms_used, count(distinct branch) as branches FROM "MasterClient"');
    console.log(clientStats.rows);

    console.log('\n--- TRADING HOLIDAYS ---');
    const holidays = await pool.query('SELECT * FROM "TradingHoliday" ORDER BY date');
    console.log(holidays.rows);

    console.log('\n--- DEALER TASKS ---');
    const tasks = await pool.query('SELECT count(*) as total_tasks, count(distinct dealer) as dealers_with_tasks, count(distinct month) as months FROM "DealerTask"');
    console.log(tasks.rows);

    console.log('\n--- CLIENT UPLOADS ---');
    const uploads = await pool.query('SELECT id, "createdAt", "fileName", "userId", username, "createdCount", "updatedCount" FROM "ClientUpload" ORDER BY "createdAt" DESC LIMIT 5');
    console.log(uploads.rows);

    console.log('\n--- USERS IN DEALER DB ---');
    const users = await pool.query('SELECT id, username, role, "mustChangePassword", "createdAt" FROM "User"');
    console.log(users.rows);

  } catch (err) {
    console.error('Error connecting to DB:', err);
  } finally {
    await pool.end();
  }
}

main();
