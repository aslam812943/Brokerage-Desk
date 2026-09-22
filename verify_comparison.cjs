const { Pool } = require('pg');
require('@next/env').loadEnvConfig(__dirname);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured before running this script.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function isoDate(y, m0, d) { return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

function tradingDaysInMonth(year, month0, holidaySet, throughDay) {
  const daysInMonth = throughDay ?? new Date(year, month0 + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month0, d).getDay();
    if (dow === 0 || dow === 6) continue;
    if (holidaySet.has(isoDate(year, month0, d))) continue;
    count++;
  }
  return count;
}

function caseInsensitiveGet(obj, key) {
  const matchKey = Object.keys(obj || {}).find((k) => k.toLowerCase() === key.toLowerCase());
  return matchKey ? obj[matchKey] : undefined;
}

async function verifyAll() {
  console.log('================================================================');
  console.log('DEALER TERMINAL DATA & MIS DEALER CALCULATION VERIFICATION REPORT');
  console.log('================================================================\n');

  // 1. Check Table Counts
  console.log('--- 1. DATABASE RECORD COUNTS ---');
  const tableCounts = {};
  const tables = ['MasterClient', 'Dealer', 'Rm', 'DailyRecord', 'DebitRecord', 'Targets', 'TradingHoliday', 'DealerTask', 'ClientUpload', 'User', 'AuditLog'];
  for (const t of tables) {
    const res = await pool.query(`SELECT COUNT(*) as count FROM "${t}"`);
    tableCounts[t] = parseInt(res.rows[0].count, 10);
    console.log(`  • ${t.padEnd(16)}: ${tableCounts[t].toLocaleString()} rows`);
  }

  // 2. Targets & Settings
  console.log('\n--- 2. SYSTEM TARGETS & SETTINGS ---');
  const targetsRes = await pool.query('SELECT * FROM "Targets" WHERE id = 1');
  const targets = targetsRes.rows[0] || {};
  console.log(`  • Company Monthly Target : ₹${targets.monthly || 0}`);
  console.log(`  • Kotak Share %          : ${targets.kotakSharePct}% (Sharewealth gets ${100 - (targets.kotakSharePct || 85)}%)`);
  console.log(`  • RM Split %             : ${targets.rmSplitPct}%`);
  console.log(`  • Incentive Multiplier   : ${targets.incentiveMultiplier}x`);
  console.log(`  • Dealer Salaries Configured:`, targets.dealerSalary);
  console.log(`  • Dealer Targets Configured :`, targets.dealerMonthly);

  // 3. Holidays
  console.log('\n--- 3. TRADING HOLIDAYS ---');
  const holRes = await pool.query('SELECT date, name FROM "TradingHoliday" ORDER BY date');
  console.log(`  • Total Holidays: ${holRes.rows.length}`);
  holRes.rows.forEach(h => console.log(`    - ${h.date}: ${h.name || '(NSE/BSE Holiday)'}`));

  // 4. Latest and Date Boundaries
  const dateRes = await pool.query('SELECT DISTINCT date FROM "DailyRecord" ORDER BY date DESC LIMIT 2');
  const latestDate = dateRes.rows[0]?.date;
  const prevDate = dateRes.rows[1]?.date;
  console.log(`\n--- 4. LATEST DATA DATES ---`);
  console.log(`  • Latest Uploaded Date : ${latestDate}`);
  console.log(`  • Previous Date (T-1)  : ${prevDate}`);

  const [y, m0] = latestDate.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n));
  const mStart = isoDate(y, m0, 1);
  const qStart = isoDate(y, Math.floor(m0 / 3) * 3, 1);
  const yStart = isoDate(y, 0, 1);
  const holidaySet = new Set(holRes.rows.map(h => h.date));
  const latestDay = Number(latestDate.split('-')[2]);
  const totalTradingDays = tradingDaysInMonth(y, m0, holidaySet);
  const tradingDaysSoFar = tradingDaysInMonth(y, m0, holidaySet, latestDay);

  console.log(`  • Month Start Date     : ${mStart}`);
  console.log(`  • Quarter Start Date   : ${qStart}`);
  console.log(`  • Year Start Date      : ${yStart}`);
  console.log(`  • Total Trading Days   : ${totalTradingDays} days (September 2026 minus 1 holiday on 2026-09-14)`);
  console.log(`  • Trading Days Elapsed : ${tradingDaysSoFar} days`);

  // 5. Dashboard Tab KPIs
  console.log('\n--- 5. DASHBOARD TAB KPIs & METRICS (ADMIN VIEW) ---');
  const kpiQuery = `
    WITH records AS (
      SELECT dr.date, dr.code, dr."netBrok",
             (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${targets.kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS "netRaw"
      FROM "DailyRecord" dr
      WHERE dr.date >= '${yStart}' AND dr.date <= '${latestDate}'
    )
    SELECT
      COALESCE(SUM("netRaw") FILTER (WHERE date = '${latestDate}'), 0)::float8 AS today_raw,
      COALESCE(SUM("netRaw") FILTER (WHERE date = '${prevDate}'), 0)::float8 AS yesterday_raw,
      COALESCE(SUM("netRaw") FILTER (WHERE date >= '${mStart}'), 0)::float8 AS mtd_raw,
      COALESCE(SUM("netRaw") FILTER (WHERE date >= '${qStart}'), 0)::float8 AS qtd_raw,
      COALESCE(SUM("netRaw") FILTER (WHERE date >= '${yStart}'), 0)::float8 AS ytd_raw
    FROM records
  `;
  const kpiRes = await pool.query(kpiQuery);
  const kpi = kpiRes.rows[0];
  console.log(`  • Today (${latestDate}) Net Brokerage : ₹${Math.round(kpi.today_raw).toLocaleString('en-IN')}`);
  console.log(`  • Yesterday (${prevDate}) Net Brokerage : ₹${Math.round(kpi.yesterday_raw).toLocaleString('en-IN')}`);
  console.log(`  • MTD Net Brokerage                     : ₹${Math.round(kpi.mtd_raw).toLocaleString('en-IN')}`);
  console.log(`  • QTD Net Brokerage                     : ₹${Math.round(kpi.qtd_raw).toLocaleString('en-IN')}`);
  console.log(`  • YTD Net Brokerage                     : ₹${Math.round(kpi.ytd_raw).toLocaleString('en-IN')}`);

  // 6. Dealer Performance Breakdown (Month)
  console.log('\n--- 6. DEALER BREAKDOWN (MTD) ---');
  const dealerMtdQuery = `
    WITH records AS (
      SELECT dr.date, dr.code,
             COALESCE(NULLIF(m.dealer, ''), 'Unmapped') AS dealer,
             COALESCE(m.rm, '') AS rm,
             (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${targets.kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS "netRaw",
             (CASE
               WHEN COALESCE(m.dealer, '') = '' THEN 0
               WHEN COALESCE(m.rm, '') = '' THEN 100
               WHEN lower(m.dealer) = lower(m.rm) THEN 100
               ELSE 100 - ${targets.rmSplitPct}::float8
             END) AS "dealerPct"
      FROM "DailyRecord" dr
      LEFT JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
      WHERE dr.date >= '${mStart}' AND dr.date <= '${latestDate}'
    )
    SELECT dealer, COUNT(DISTINCT code) as active_clients, SUM("netRaw" * "dealerPct" / 100.0)::float8 AS dealer_brok, SUM("netRaw")::float8 AS total_client_brok
    FROM records
    GROUP BY dealer
    ORDER BY dealer_brok DESC
  `;
  const dealerMtdRes = await pool.query(dealerMtdQuery);
  console.table(dealerMtdRes.rows.map(r => ({
    Dealer: r.dealer,
    'Active Clients': r.active_clients,
    'Dealer Share (MTD)': `₹${Math.round(r.dealer_brok).toLocaleString('en-IN')}`,
    'Total Client Brok': `₹${Math.round(r.total_client_brok).toLocaleString('en-IN')}`
  })));

  // 7. Top 10 Clients (MTD)
  console.log('\n--- 7. TOP 10 CLIENTS (MTD) ---');
  const topClientsQuery = `
    WITH records AS (
      SELECT dr.code, dr.name,
             (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${targets.kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS "netRaw"
      FROM "DailyRecord" dr
      WHERE dr.date >= '${mStart}' AND dr.date <= '${latestDate}'
    )
    SELECT code, MAX(name) as client_name, SUM("netRaw")::float8 AS client_brok
    FROM records
    GROUP BY code
    ORDER BY client_brok DESC
    LIMIT 10
  `;
  const topClientsRes = await pool.query(topClientsQuery);
  console.table(topClientsRes.rows.map(r => ({
    'Client Code': r.code,
    'Client Name': r.client_name,
    'MTD Brokerage': `₹${Math.round(r.client_brok).toLocaleString('en-IN')}`
  })));

  // 8. MIS Tab Summary for Dealers
  console.log('\n--- 8. MIS TAB - DEALER INCENTIVE & DAILY TARGET METRICS ---');
  const misDealerQuery = `
    WITH records AS (
      SELECT dr.date, dr."codeNorm", dr.code, dr.name,
             COALESCE(NULLIF(m.dealer, ''), '') AS dealer,
             COALESCE(NULLIF(m.rm, ''), '') AS rm,
             (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${targets.kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS "netRaw"
      FROM "DailyRecord" dr
      LEFT JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
      WHERE dr.date >= '${mStart}' AND dr.date <= '${latestDate}'
    ),
    split AS (
      SELECT *,
        (CASE WHEN dealer = '' THEN 0 WHEN rm = '' THEN 100 WHEN lower(dealer) = lower(rm) THEN 100 ELSE 100 - ${targets.rmSplitPct}::float8 END) AS "dealerPct"
      FROM records
    )
    SELECT dealer,
           SUM("netRaw" * "dealerPct" / 100.0)::float8 AS mtd_revenue,
           SUM(CASE WHEN date = '${prevDate}' THEN "netRaw" * "dealerPct" / 100.0 ELSE 0 END)::float8 AS yesterday_revenue,
           COUNT(DISTINCT "codeNorm") as traded_clients
    FROM split
    WHERE dealer <> ''
    GROUP BY dealer
    ORDER BY mtd_revenue DESC
  `;
  const misDealerRes = await pool.query(misDealerQuery);
  const misReport = misDealerRes.rows.map(r => {
    const salary = caseInsensitiveGet(targets.dealerSalary, r.dealer) || 0;
    const target = salary > 0 ? salary * (targets.incentiveMultiplier || 10) : 0;
    const dailyTarget = totalTradingDays > 0 ? target / totalTradingDays : 0;
    const dailyAvg = tradingDaysSoFar > 0 ? r.mtd_revenue / tradingDaysSoFar : 0;
    const shortfall = Math.max(0, dailyTarget - dailyAvg);
    const multiplier = salary > 0 ? r.mtd_revenue / salary : null;
    const eligible = salary > 0 && multiplier >= (targets.incentiveMultiplier || 10);

    return {
      Dealer: r.dealer,
      'Salary': salary ? `₹${salary.toLocaleString('en-IN')}` : '—',
      'Target (Salary x Mult)': target ? `₹${target.toLocaleString('en-IN')}` : '—',
      'Daily Target': dailyTarget ? `₹${Math.round(dailyTarget).toLocaleString('en-IN')}` : '—',
      'MTD Revenue': `₹${Math.round(r.mtd_revenue).toLocaleString('en-IN')}`,
      'Daily Avg Achieved': `₹${Math.round(dailyAvg).toLocaleString('en-IN')}`,
      'Daily Shortfall': shortfall > 0 ? `₹${Math.round(shortfall).toLocaleString('en-IN')}` : '₹0',
      'Multiplier': multiplier ? `${multiplier.toFixed(2)}x` : '—',
      'Incentive Eligible': eligible ? 'YES' : 'NO',
      'Traded Clients': r.traded_clients
    };
  });
  console.table(misReport);

  // 9. RM Summary
  console.log('\n--- 9. RM TAB / RM SUMMARY (MTD) ---');
  const rmQuery = `
    WITH records AS (
      SELECT dr.date, dr.code,
             COALESCE(NULLIF(m.dealer, ''), '') AS dealer,
             COALESCE(NULLIF(m.rm, ''), '') AS rm,
             (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${targets.kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS "netRaw",
             (CASE
               WHEN COALESCE(m.rm, '') = '' THEN 0
               WHEN COALESCE(m.dealer, '') = '' THEN 100
               WHEN lower(m.dealer) = lower(m.rm) THEN 0
               ELSE ${targets.rmSplitPct}::float8
             END) AS "rmPct"
      FROM "DailyRecord" dr
      LEFT JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
      WHERE dr.date >= '${mStart}' AND dr.date <= '${latestDate}'
    )
    SELECT rm, COUNT(DISTINCT code) as active_clients, SUM("netRaw" * "rmPct" / 100.0)::float8 AS rm_brok
    FROM records
    WHERE rm <> ''
    GROUP BY rm
    ORDER BY rm_brok DESC
  `;
  const rmRes = await pool.query(rmQuery);
  console.table(rmRes.rows.map(r => ({
    RM: r.rm,
    'Active Clients': r.active_clients,
    'RM Share (MTD)': `₹${Math.round(r.rm_brok).toLocaleString('en-IN')}`
  })));

  await pool.end();
}

verifyAll();
