const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { transform } = require('next/dist/build/swc');
const { Prisma } = require('@prisma/client');

async function load(file, mocks, suffix = '') {
  const { code } = await transform(fs.readFileSync(file, 'utf8') + suffix, { filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: file.endsWith('.jsx') }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' } });
  const exports = {};
  vm.runInNewContext(code, { exports, URL, process: { env: {} }, require: name => mocks[name] || {} });
  return exports;
}

test('privilege applies before RM/dealer allocation, including custom and boundary percentages', async () => {
  const { splitShares } = await load('app/Dashboard.jsx', {}, '\nexport { splitShares };');
  const shares = (...args) => JSON.parse(JSON.stringify(splitShares(...args)));
  assert.deepEqual(shares('Dealer', 'RM', 50, true, 50), { dealerPct: 25, rmPct: 25, samePerson: false });
  assert.deepEqual(shares('Dealer', 'RM', 50, false, 50), { dealerPct: 50, rmPct: 50, samePerson: false });
  assert.equal(shares('Dealer', 'RM', 25, true, 60).dealerPct, 45);
  assert.equal(shares('Dealer', 'RM', 25, true, 60).rmPct, 15);
  assert.equal(shares('Dealer', 'dealer', 50, true, 50).dealerPct, 50);
  assert.equal(shares('Dealer', '', 50, true, 50).dealerPct, 50);
  assert.equal(shares('', 'RM', 50, true, 50).rmPct, 50);
  assert.equal(shares('Dealer', 'RM', 50, true, 0).dealerPct, 0);
  assert.equal(shares('Dealer', 'RM', 50, true, 100).dealerPct, 50);
});

test('Targets saves a configurable privilege percentage and rejects invalid values', async () => {
  let stored = { privilegeSharePct: 65 };
  const route = await load('app/api/targets/route.js', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, zod: require('zod'),
    '../../../lib/apiAuth': { requireAdmin: async () => ({}), requireSession: async () => ({ session: { user: { role: 'ADMIN' } } }) },
    '../../../lib/prisma': { prisma: { targets: { findUnique: async () => stored, upsert: async ({ update }) => (stored = { ...stored, ...update }) } } },
  });
  const put = value => route.PUT({ json: async () => value });
  for (const value of [-1, 101, '50', null]) assert.equal((await put({ privilegeSharePct: value })).status, 400);
  await put({ privilegeSharePct: 60 });
  assert.equal((await (await route.GET()).json()).privilegeSharePct, 60);
  await put({ monthly: 123 });
  assert.equal(stored.privilegeSharePct, 60, 'older clients must not reset the saved percentage');
});

// Runs production SQL against synthetic CTEs only; no business data is read or written.
test('Postgres dashboard, MIS, RM and report earnings agree for privilege clients', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  require('@next/env').loadEnvConfig(process.cwd());
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  const fixtures = `fixture_clients("codeNorm",code,name,dealer,rm,privilege) AS (VALUES
    ('P','P','Privilege','PD','PR',true), ('N','N','Normal','ND','NR',false),
    ('S','S','Same','SD','sd',true), ('D','D','Dealer only','DD','',true),
    ('R','R','RM only','','RR',true), ('K','K','Kotak','KD','KR',true)),
    fixture_records(date,"codeNorm",code,name,"netBrok",source) AS (
      SELECT d, c."codeNorm", c.code, c.name, 100::float8, CASE WHEN c.code='K' THEN 'KOTAK' ELSE '' END
      FROM fixture_clients c CROSS JOIN (VALUES ('2026-10-12'),('2026-09-12')) dates(d)),
    fixture_dealers(name) AS (SELECT dealer FROM fixture_clients WHERE dealer <> ''),
    fixture_rms(name) AS (SELECT rm FROM fixture_clients WHERE rm <> '')`;
  let pct = 50;
  const db = {
    targets: { findUnique: async () => ({ kotakSharePct: 85, rmSplitPct: 50, privilegeSharePct: pct }) },
    dailyRecord: { findFirst: async () => ({ date: '2026-10-12' }), findMany: async () => [{ date: '2026-10-12' }] },
    masterClient: { groupBy: async () => [], findMany: async () => [{ codeNorm: 'P' }] },
    dealer: { findMany: async () => [] }, tradingHoliday: { findMany: async () => [] },
    async $queryRaw(strings, ...values) {
      const query = Array.isArray(strings) ? Prisma.sql(strings, ...values) : strings;
      let text = query.text.replaceAll('"MasterClient"', 'fixture_clients').replaceAll('"DailyRecord"', 'fixture_records').replaceAll('"Dealer"', 'fixture_dealers').replaceAll('"Rm"', 'fixture_rms');
      // SQL may begin with comments before its WITH clause.
      if (/^\s*(?:--[^\n]*\n\s*)*WITH\b/i.test(text)) text = text.replace(/^(\s*(?:--[^\n]*\n\s*)*)WITH\b/i, (_, comments) => `${comments}WITH ${fixtures},`);
      else text = `WITH ${fixtures} ${text}`;
      return (await pool.query(text, query.values)).rows;
    },
  };
  let role = 'ADMIN';
  async function route(file) {
    return load(file, {
      '@prisma/client': { Prisma },
      'next/server': { NextResponse: { json: body => Response.json(body) } },
      '../../../../lib/prisma': { prisma: db },
      '../../../../lib/apiAuth': { requireAdmin: async () => ({}), requireSession: async () => ({ session: { user: { role, viewerName: 'PD' } } }), viewerClientWhere: () => ({}) },
    });
  }
  const request = { url: 'http://localhost/api?period=month' };
  try {
    const dashboard = await route('app/api/dashboard/summary/route.js');
    const rms = await route('app/api/rms/summary/route.js');
    const reports = await route('app/api/reports/dealers/route.js');
    const mis = await route('app/api/mis/summary/route.js');
    for (const percentage of [50, 60, 0, 100]) {
      pct = percentage;
      role = 'ADMIN';
      const dash = await (await dashboard.GET(request)).json();
      assert.equal(dash.kpi.mtd, 585, 'company total remains unreduced');
      assert.equal(dash.dealerRows.find(r => r.dealer === 'PD').value, Math.round(pct / 2));
      const rm = await (await rms.GET(request)).json();
      assert.equal(rm.rows.find(r => r.rm === 'PR').netBrokerage, pct / 2);
      assert.equal(rm.rows.find(r => r.rm === 'RR').netBrokerage, pct);
      const report = await (await reports.GET(request)).json();
      const pd = report.rows.find(r => r.dealer === 'PD');
      assert.equal(pd.totalBrokerage, 100);
      assert.equal(pd.netBrokerage, pct / 2);
      assert.equal(pd.prevNetBrokerage, pct / 2);
      assert.equal(report.rows.find(r => r.dealer === 'ND').netBrokerage, 50);
      assert.equal(report.rows.find(r => r.dealer === 'SD').netBrokerage, pct);
      assert.equal(report.rows.find(r => r.dealer === 'DD').netBrokerage, pct);
      assert.ok(Math.abs(report.rows.find(r => r.dealer === 'KD').netBrokerage - 0.85 * pct / 2) < 1e-9);
      const data = await (await mis.GET()).json();
      assert.equal(data.rows.find(r => r.dealer === 'PD').mtdRevenue, pct / 2);
      assert.equal(data.rows.find(r => r.dealer === 'PD').latestRevenue, pct / 2);
      role = 'VIEWER';
      const viewer = await (await dashboard.GET(request)).json();
      assert.equal(viewer.kpi.mtd, pct / 2);
    }
  } finally { await pool.end(); }
});
