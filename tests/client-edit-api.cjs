const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { transform } = require('next/dist/build/swc');

async function fixture() {
  let rows = [
    { code: 'A', name: 'Alice', privilege: true, createdAt: new Date('2026-09-03T20:00:00.000Z') },
    { code: 'B', name: 'Bob', privilege: false, createdAt: new Date('2026-09-22T08:30:00.000Z') },
  ];
  let denied = false, writes = 0;
  const audits = [];
  const prisma = {
    masterClient: {
      findMany: async () => rows,
      deleteMany: () => () => { rows = []; },
      createMany: ({ data }) => () => { rows = data; },
    },
    $transaction: async operations => { writes++; operations.forEach(fn => fn()); },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    zod: require('zod'),
    '../../../lib/prisma': { prisma },
    '../../../lib/apiAuth': {
      requireAdmin: async () => denied ? { response: Response.json({ error: 'Forbidden' }, { status: 403 }) } : { session: { user: { id: 'admin', name: 'admin', role: 'ADMIN' } } },
      requireSession: async () => ({ session: { user: { role: 'ADMIN' } } }),
    },
    '../../../lib/audit': { writeAudit: async entry => audits.push(entry) },
  };
  const { code } = await transform(fs.readFileSync('app/api/master/route.js', 'utf8'), {
    filename: 'route.js', jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' }, module: { type: 'commonjs' },
  });
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => mocks[name] });
  return {
    put: body => exports.PUT({ json: async () => body }),
    read: async () => (await exports.GET()).json(),
    deny: () => { denied = true; },
    get writes() { return writes; }, audits,
  };
}

test('admin code and date edits survive a reload without changing another client', async () => {
  const f = await fixture();
  const original = await f.read();
  assert.equal((await f.put([{ ...original[0], code: 'NEW1', createdAt: '2026-09-15T00:00:00+05:30' }, original[1]])).status, 200);
  const saved = await f.read();
  assert.equal(saved[0].code, 'NEW1');
  assert.equal(saved[0].createdAt, '2026-09-14T18:30:00.000Z');
  assert.equal(saved[0].privilege, true);
  assert.equal(saved[1].createdAt, original[1].createdAt);
  assert.equal(saved[1].name, original[1].name);
  assert.equal(f.audits.length, 1);
});

test('code-only edits preserve supplied timestamps and older saves preserve omitted dates/privilege', async () => {
  const f = await fixture();
  const original = await f.read();
  await f.put([{ ...original[0], code: 'NEW1' }, { code: 'B', name: 'Bob updated' }]);
  const saved = await f.read();
  assert.equal(saved[0].createdAt, original[0].createdAt);
  assert.equal(saved[0].privilege, true);
  assert.equal(saved[1].createdAt, original[1].createdAt);
  assert.equal(saved[1].privilege, false);
});

test('invalid dates, empty codes and normalized duplicates are rejected before writing', async () => {
  const f = await fixture();
  const original = await f.read();
  for (const rows of [
    [{ code: 'A', createdAt: 'invalid' }],
    [{ code: 'A', createdAt: '2026-02-30T00:00:00Z' }],
    [{ code: 'A', createdAt: '' }],
    [{ code: ' ' }],
    [{ code: 'A1' }, { code: ' a 1 ' }],
  ]) assert.equal((await f.put(rows)).status, 400);
  assert.equal(f.writes, 0);
  assert.deepEqual(await f.read(), original);
});

test('non-admin requests cannot edit client code or added date', async () => {
  const f = await fixture();
  f.deny();
  assert.equal((await f.put([{ code: 'NEW1', createdAt: '2026-09-15T00:00:00Z' }])).status, 403);
  assert.equal(f.writes, 0);
  assert.equal(f.audits.length, 0);
});
