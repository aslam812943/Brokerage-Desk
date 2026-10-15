const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { transform } = require('next/dist/build/swc');

async function fixture(failed = false) {
  let cursor = 0, tree;
  const slots = [], effects = [];
  const pending = {};
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(fn); } },
    useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }),
  };
  const jsx = (type, props) => ({ type, props });
  const { code } = await transform(fs.readFileSync('app/Dashboard.jsx', 'utf8'), { filename: 'Dashboard.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' } });
  const exports = {};
  vm.runInNewContext(code, { exports, process: { env: {} }, setTimeout,
    fetch: async url => {
      if (url === '/api/viewer-scope') return Response.json({ isAdmin: true, matched: true });
      if (url === '/api/master') return Response.json(failed ? {} : [{ code: 'A', name: 'Existing client' }], { status: failed ? 500 : 200 });
      if (url === '/api/targets') return Response.json({ monthly: 0 });
      if (url === '/api/daily/dates' || url === '/api/debit/latest') return new Promise(resolve => { pending[url] = resolve; });
      return Response.json([]);
    },
    require: name => ({ react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next-auth/react': { useSession: () => ({ data: { user: { name: 'admin', role: 'ADMIN' } } }) } })[name] || {},
  });
  const render = () => { cursor = 0; tree = exports.default(); };
  function nodes() { const out = []; function visit(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(visit); out.push(n); visit(n.props?.children); } visit(tree); return out; }
  render(); effects.forEach(fn => fn());
  await new Promise(resolve => setImmediate(resolve)); render();
  return { render, nodes, pending };
}

test('client data renders while upload dates and debit are still pending', async () => {
  const s = await fixture();
  const dashboard = s.nodes().find(n => n.type?.name === 'Dashboard');
  assert.equal(dashboard.props.master[0].name, 'Existing client');
  assert.ok(s.nodes().some(n => n.props?.children === 'Loading upload dates…'));
  assert.ok(!s.nodes().some(n => n.props?.children === 'No data uploaded yet'));
  s.pending['/api/daily/dates'](Response.json(['2026-10-14']));
  s.pending['/api/debit/latest'](Response.json([]));
  await new Promise(resolve => setImmediate(resolve)); s.render();
  assert.ok(s.nodes().some(n => typeof n.props?.children === 'string' && n.props.children.startsWith('Data through')));
});

test('failed client requests display a retry instead of an empty editable client list', async () => {
  const s = await fixture(true);
  assert.ok(s.nodes().some(n => n.props?.role === 'alert'));
  assert.ok(s.nodes().some(n => n.type === 'button' && n.props.children === 'Retry'));
  assert.ok(!s.nodes().some(n => n.type?.name === 'Dashboard' || n.type?.name === 'ClientsTab'));
});
