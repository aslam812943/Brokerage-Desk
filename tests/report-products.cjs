const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { transform } = require('next/dist/build/swc');
const { Prisma } = require('@prisma/client');

test('report counts recorded closures within inclusive India dates, including product-only dealers', async () => {
  const entries = [
    ['A', '2026-10-04T18:29:59Z', 'demat'],
    ['A', '2026-10-04T18:30:00Z', 'demat'],
    ['A', '2026-10-11T18:29:59Z', 'mutual_fund_sip'],
    ['A', '2026-10-11T18:30:00Z', 'mutual_fund_lumpsum'],
    ['Product only', '2026-10-06T00:00:00Z', 'demat'],
  ];
  const db = {
    targets: { findUnique: async () => null },
    dealer: { findMany: async () => [{ name: 'A' }, { name: 'Zero' }] },
    masterClient: { groupBy: async () => [] },
    dailyRecord: { findFirst: async () => ({ date: '2026-10-11' }) },
    $queryRaw: async () => [],
    dealerProductTask: { groupBy: async ({ where, by }) => {
      assert.deepEqual(Array.from(by), ['dealer', 'product']);
      const counts = {};
      for (const [dealer, timestamp, product] of entries) {
        const date = new Date(timestamp), filter = where.createdAt;
        if (filter?.gte && date < filter.gte || filter?.lt && date >= filter.lt) continue;
        const key = JSON.stringify([dealer, product]);
        counts[key] = (counts[key] || 0) + 1;
      }
      return Object.entries(counts).map(([key, count]) => {
        const [dealer, product] = JSON.parse(key);
        return { dealer, product, _count: { _all: count } };
      });
    } },
  };
  const file = 'app/api/reports/dealers/route.js';
  const { code } = await transform(fs.readFileSync(file, 'utf8'), { filename: file, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' }, module: { type: 'commonjs' } });
  const exports = {};
  vm.runInNewContext(code, { exports, URL, require: name => ({
    '@prisma/client': { Prisma },
    'next/server': { NextResponse: { json: body => body } },
    '../../../../lib/prisma': { prisma: db },
    '../../../../lib/apiAuth': { requireAdmin: async () => ({}) },
  }[name]) });
  const report = await exports.GET({ url: 'http://localhost/api?from=2026-10-05&to=2026-10-11' });
  assert.equal(report.rows.find(r => r.dealer === 'A').otherProductsSold, 2);
  assert.equal(report.rows.find(r => r.dealer === 'Zero').otherProductsSold, 0);
  assert.equal(report.rows.find(r => r.dealer === 'Product only').otherProductsSold, 1);
  assert.equal(report.rows.find(r => r.dealer === 'A').netBrokerage, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(report.rows.find(r => r.dealer === 'A').productSalesCounts)), { demat: 1, mutual_fund_sip: 1 });
  assert.equal(Object.keys(report.rows.find(r => r.dealer === 'Zero').productSalesCounts).length, 0);
  assert.equal(report.rows.find(r => r.dealer === 'Product only').productSalesCounts.demat, 1);
  const all = await exports.GET({ url: 'http://localhost/api' });
  assert.equal(all.rows.find(r => r.dealer === 'A').otherProductsSold, 4);
  assert.equal(all.rows.find(r => r.dealer === 'A').productSalesCounts.demat, 2);
  for (const row of all.rows) assert.equal(Object.values(row.productSalesCounts).reduce((sum, count) => sum + count, 0), row.otherProductsSold);
  const month = await exports.GET({ url: 'http://localhost/api?period=month' });
  assert.equal(month.rows.find(r => r.dealer === 'A').otherProductsSold, 3);
});
