// Read-only audit, opt in with RUN_DB_TESTS=1. Logs counts/settings only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { transform } = require('next/dist/build/swc');

test('live monthly earnings reconcile with an independent per-client calculation', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  require('@next/env').loadEnvConfig(process.cwd());
  const { Pool } = require('pg');
  const { PrismaClient, Prisma } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '5432') url.port = '6543';
  const pool = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 15000 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const mocks = { '@prisma/client': { Prisma }, '../../../../lib/prisma': { prisma },
    '../../../../lib/apiAuth': { requireSession: async () => ({ session: { user: { role: 'ADMIN' } } }), requireAdmin: async () => ({}) },
    'next/server': { NextResponse: { json: body => Response.json(body) } } };
  async function load(file, suffix = '') {
    const { code } = await transform(fs.readFileSync(file, 'utf8') + suffix, { filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: file.endsWith('.jsx') }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' } });
    const exports = {};
    vm.runInNewContext(code, { exports, URL, process: { env: {} }, require: name => mocks[name] || {} });
    return exports;
  }
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.011, `${label}: difference ${actual - expected}`);
  try {
    const [targets, clients, latest] = await Promise.all([
      prisma.targets.findUnique({ where: { id: 1 } }), prisma.masterClient.findMany(),
      prisma.dailyRecord.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
    ]);
    assert.ok(latest);
    const monthStart = latest.date.slice(0, 7) + '-01';
    const raw = await pool.query('SELECT "codeNorm", source, SUM("netBrok")::float8 AS amount FROM "DailyRecord" WHERE date >= $1 AND date <= $2 GROUP BY "codeNorm", source', [monthStart, latest.date]);
    const byCode = new Map();
    const settings = { kotak: targets?.kotakSharePct ?? 85, privilege: targets?.privilegeSharePct ?? 50, rm: targets?.rmSplitPct ?? 50 };
    for (const r of raw.rows) byCode.set(r.codeNorm, (byCode.get(r.codeNorm) || 0) + r.amount * (r.source === 'KOTAK' ? settings.kotak / 100 : 1));
    const dealers = new Map(), rms = new Map(), people = new Map();
    const add = (map, name, amount) => { if (name) map.set(name, (map.get(name) || 0) + amount); };
    const { splitShares } = await load('app/Dashboard.jsx', '\nexport { splitShares };');
    let activePrivilege = 0;
    for (const c of clients) {
      const gross = byCode.get(c.codeNorm) || 0;
      if (c.privilege && gross) activePrivilege++;
      const eligible = gross * (c.privilege ? settings.privilege / 100 : 1);
      const same = c.dealer.toLowerCase() === c.rm.toLowerCase();
      let dealer = 0, rm = 0;
      if (c.dealer && (!c.rm || same)) dealer = eligible;
      else if (!c.dealer && c.rm) rm = eligible;
      else if (c.dealer && c.rm) { rm = eligible * settings.rm / 100; dealer = eligible - rm; }
      add(dealers, c.dealer, dealer); add(rms, c.rm, rm);
      add(people, c.dealer.toLowerCase(), dealer); add(people, c.rm.toLowerCase(), rm);
      const ui = splitShares(c.dealer, c.rm, settings.rm, c.privilege, settings.privilege);
      near(gross * ui.dealerPct / 100, dealer, 'Dealer UI/export formula');
      near(gross * ui.rmPct / 100, rm, 'RM UI/export formula');
    }
    const request = { url: 'http://localhost/api?period=month' };
    const reports = await (await (await load('app/api/reports/dealers/route.js')).GET(request)).json();
    for (const r of reports.rows) near(r.netBrokerage, dealers.get(r.dealer) || 0, 'Report dealer net');
    const rmData = await (await (await load('app/api/rms/summary/route.js')).GET(request)).json();
    for (const r of rmData.rows) near(r.netBrokerage, rms.get(r.rm) || 0, 'RM net');
    const mis = await (await (await load('app/api/mis/summary/route.js')).GET()).json();
    for (const r of mis.rows) near(r.mtdRevenue, people.get(r.dealer.toLowerCase()) || 0, 'MIS personal net');
    const dashboard = await (await (await load('app/api/dashboard/summary/route.js')).GET(request)).json();
    near(dashboard.kpi.mtd, [...byCode.values()].reduce((a, b) => a + b, 0), 'Company gross');
    for (const r of dashboard.dealerRows) near(r.value, Math.round(dealers.get(r.dealer) || 0), 'Dashboard rounded dealer net');
    console.log(JSON.stringify({ latestDate: latest.date, clients: clients.length, privilegeClients: clients.filter(c => c.privilege).length, activePrivilegeClients: activePrivilege, settings, dealersChecked: reports.rows.length, rmsChecked: rmData.rows.length, mismatches: 0 }));
  } finally { await prisma.$disconnect(); await pool.end(); }
});
