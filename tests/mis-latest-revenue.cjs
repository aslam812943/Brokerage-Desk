const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { transform } = require("next/dist/build/swc");

async function fixture() {
  let latestQuery;
  const prisma = {
    targets: { findUnique: async () => ({ kotakSharePct: 80, rmSplitPct: 25 }) },
    tradingHoliday: { findMany: async () => [] },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      if (sql.includes("WITH latest_records")) {
        latestQuery = { text: strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values };
        return [{ person: "alice", date: "2026-10-12", revenue: 0 }, { person: "bob", date: "2026-08-03", revenue: 42 }];
      }
      if (sql.includes("SELECT DISTINCT date")) return [{ date: "2026-10-12" }, { date: "2026-10-09" }];
      if (sql.includes("SELECT person, COUNT")) return [];
      if (sql.includes("WITH records")) return [];
      if (sql.includes('FROM "Dealer"')) return ["ALICE", "BOB", "NO DATA"].map((name) => ({ name }));
      throw new Error(sql);
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../app/api/mis/summary/route.js"), "utf8");
  const { code } = await transform(source, { filename: "route.js", jsc: { parser: { syntax: "ecmascript" }, target: "es2020" }, module: { type: "commonjs" } });
  const exports = {};
  const mocks = {
    "next/server": { NextResponse: { json: (body) => Response.json(body) } },
    "../../../../lib/prisma": { prisma },
    "../../../../lib/apiAuth": { requireSession: async () => ({ session: { user: { role: "ADMIN" } } }) },
  };
  vm.runInNewContext(code, { exports, require: (name) => mocks[name] });
  const data = await (await exports.GET()).json();
  return { data, latestQuery };
}

test("MIS distinguishes latest zero revenue, older personal dates, and no history", async () => {
  const { data } = await fixture();
  const rows = Object.fromEntries(data.rows.map((row) => [row.dealer, row]));
  assert.equal(rows.ALICE.latestRevenue, 0);
  assert.equal(rows.ALICE.latestRevenueDate, "2026-10-12");
  assert.equal(rows.BOB.latestRevenue, 42);
  assert.equal(rows.BOB.latestRevenueDate, "2026-08-03");
  assert.equal(rows.BOB.mtdRevenue, 0, "older revenue must not enter this month's total");
  assert.equal(rows["NO DATA"].latestRevenue, null);
  assert.equal(rows["NO DATA"].latestRevenueDate, null);
});

// Opt in with RUN_DB_TESTS=1. Only SELECT statements with synthetic CTE data:
// no business records are read or changed by this integration test.
test("Postgres latest-date SQL handles splits, case, old reports, zero and negative revenue", { skip: process.env.RUN_DB_TESTS !== "1" }, async () => {
  require("@next/env").loadEnvConfig(path.join(__dirname, ".."));
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  try {
    const { latestQuery } = await fixture();
    const query = latestQuery.text.replace('WITH latest_records', `WITH
      fixture_clients("codeNorm", dealer, rm) AS (VALUES
        ('A','Alice','Bob'), ('B','ALICE','alice'), ('C','Old',''), ('D','','RM ONLY'), ('E','Zero',''), ('F','Negative','')),
      fixture_records(date,"codeNorm","netBrok",source) AS (VALUES
        ('2026-10-09','A',999::float8,''),
        ('2026-10-12','A',100::float8,'KOTAK'),
        ('2026-10-12','A',40::float8,''),
        ('2026-10-12','B',10::float8,''),
        ('2026-08-03','C',42::float8,''),
        ('2026-09-30','D',20::float8,'KOTAK'),
        ('2026-10-09','E',100::float8,''),
        ('2026-10-12','E',0::float8,''),
        ('2026-10-12','F',-7::float8,''),
        ('2026-10-13','F',100::float8,'')) , latest_records`)
      .replace('"DailyRecord"', 'fixture_records').replace('"MasterClient"', 'fixture_clients');
    const result = await pool.query(query, latestQuery.values);
    const rows = Object.fromEntries(result.rows.map((row) => [row.person, row]));
    assert.equal(rows.alice.revenue, 100); // (100 * 80% + 40) * 75% + 10
    assert.equal(rows.bob.revenue, 30);
    assert.equal(rows.old.date, "2026-08-03");
    assert.equal(rows.old.revenue, 42);
    assert.equal(rows["rm only"].revenue, 16);
    assert.equal(rows.zero.date, "2026-10-12");
    assert.equal(rows.zero.revenue, 0);
    assert.equal(rows.negative.revenue, -7);
    assert.equal(rows.negative.date, "2026-10-12");
  } finally { await pool.end(); }
});
