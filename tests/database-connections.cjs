const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { transform } = require('next/dist/build/swc');

async function load(file, mocks = {}) {
  const { code } = await transform(fs.readFileSync(file, 'utf8'), { filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2020' }, module: { type: 'commonjs' } });
  const exports = {};
  vm.runInNewContext(code, { exports, URL, process: { env: {} }, console: { error() {} }, require: name => mocks[name] });
  return exports;
}

test('runtime uses transaction pooling only for Supabase shared session endpoints', async () => {
  const { runtimeDatabaseUrl, databasePoolConfig } = await load('lib/databaseConfig.js');
  const original = 'postgresql://postgres.project:p%40ss@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require';
  const result = new URL(runtimeDatabaseUrl(original));
  assert.equal(result.port, '6543');
  assert.equal(result.password, 'p%40ss');
  assert.equal(result.search, '?sslmode=require');
  for (const value of ['postgresql://a:b@localhost:5432/db', 'postgresql://a:b@db.project.supabase.co:5432/postgres', 'postgresql://a:b@aws-0-region.pooler.supabase.com:6543/postgres']) assert.equal(runtimeDatabaseUrl(value), value);
  assert.equal(runtimeDatabaseUrl(undefined), undefined);
  const config = databasePoolConfig(original);
  assert.equal(config.max, 2);
  assert.equal(config.connectionTimeoutMillis, 10000);
});

test('login hides database failures while preserving credential checks', async () => {
  let fail = true;
  const { authOptions } = await load('lib/authOptions.js', {
    'next-auth/providers/credentials': options => options,
    bcryptjs: { compare: async password => password === 'correct' },
    './rateLimit': { isRateLimited: () => false },
    './prisma': { prisma: { user: { findUnique: async () => {
      if (fail) throw Object.assign(new Error('private database detail EMAXCONNSESSION'), { code: 'XX000' });
      return { id: '1', username: 'admin', role: 'ADMIN', passwordHash: 'test' };
    } } } },
  });
  const authorize = authOptions.providers[0].authorize;
  await assert.rejects(authorize({ username: 'admin', password: 'correct' }), { message: 'Sign-in is temporarily unavailable. Please try again shortly.' });
  fail = false;
  assert.equal(await authorize({ username: 'admin', password: 'wrong' }), null);
  assert.equal((await authorize({ username: 'admin', password: 'correct' })).role, 'ADMIN');
});
