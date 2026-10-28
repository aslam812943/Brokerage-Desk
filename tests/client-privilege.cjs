const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { transform } = require('next/dist/build/swc');

async function screen(isAdmin = true, master) {
  const slots = [];
  const notices = [], requests = [];
  let cursor = 0, tree, saved, success = true;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useRef: value => ({ current: value }),
  };
  const jsx = (type, props) => ({ type, props });
  const source = fs.readFileSync('app/Dashboard.jsx', 'utf8') + '\nexport { ClientsTab };';
  const { code } = await transform(source, { filename: 'Dashboard.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' } });
  const exports = {};
  vm.runInNewContext(code, { exports, process: { env: {} }, fetch: async url => { requests.push(url); return Response.json([]); }, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    return {};
  } });
  const props = { master: master ?? [{ code: 'A', name: 'Alice', privilege: false }, { code: 'B', name: 'Bob', privilege: true }, { code: 'C', name: 'Carol', privilege: false }], targets: {}, latestDebitByCode: {}, dealerNames: [], rmNames: [], isAdmin, showToast: (...args) => notices.push(args), onSave: async rows => { saved = rows; if (success) props.master = rows; return success; } };
  const render = () => { cursor = 0; tree = exports.ClientsTab(props); };
  const nodes = () => { const out = []; function visit(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(visit); out.push(n); visit(n.props?.children); } visit(tree); return out; };
  const label = text => nodes().find(n => n.props?.['aria-label'] === text)?.props;
  const button = text => nodes().find(n => n.type === 'button' && JSON.stringify(n.props.children).includes(text))?.props;
  render();
  return { render, label, button, nodes, notices, requests, get saved() { return saved; }, fail() { success = false; } };
}

test('add and edit persist privilege Yes/No', async () => {
  const s = await screen();
  s.button('Add client').onClick(); s.render();
  assert.equal(s.label('New client privilege').value, 'false');
  s.nodes().find(n => n.props?.placeholder === 'Client code').props.onChange({ target: { value: 'D' } }); s.render();
  s.label('New client privilege').onChange({ target: { value: 'true' } }); s.render();
  await s.button('Save').onClick(); s.render();
  assert.equal(s.saved.find(r => r.code === 'D').privilege, true);
  s.label('Edit client D').onClick(); s.render();
  s.label('Privilege for D').onChange({ target: { value: 'false' } }); s.render();
  await s.label('Save client D').onClick();
  assert.equal(s.saved.find(r => r.code === 'D').privilege, false);
});

test('bulk updates only selected clients and preserves selection after failed save', async () => {
  const s = await screen();
  for (const code of ['A', 'C']) { s.label(`Select client ${code}`).onChange({ target: { checked: true } }); s.render(); }
  await s.button('Set privilege: Yes').onClick(); s.render();
  assert.ok(s.saved.every(r => r.privilege));
  assert.equal(s.label('Select client A').checked, false);
  s.label('Select client A').onChange({ target: { checked: true } }); s.render();
  s.fail(); await s.button('Set privilege: No').onClick(); s.render();
  assert.equal(s.saved.find(r => r.code === 'A').privilege, false);
  assert.equal(s.saved.find(r => r.code === 'B').privilege, true);
  assert.equal(s.label('Select client A').checked, true);
});

test('select all selects only visible search results and viewers cannot select', async () => {
  const s = await screen();
  s.nodes().find(n => n.props?.placeholder?.startsWith('Search code')).props.onChange({ target: { value: 'Alice' } }); s.render();
  s.label('Select all visible clients').onChange({ target: { checked: true } }); s.render();
  await s.button('Set privilege: Yes').onClick();
  assert.equal(s.saved.find(r => r.code === 'A').privilege, true);
  assert.equal(s.saved.find(r => r.code === 'C').privilege, false);
  const viewer = await screen(false);
  assert.equal(viewer.label('Select all visible clients'), undefined);
  assert.equal(viewer.button('Set privilege: Yes'), undefined);
  assert.equal(viewer.label('Edit client A'), undefined);
  assert.equal(viewer.label('Client code for A'), undefined);
  assert.equal(viewer.label('Added date for A'), undefined);
});

const originalClients = [
  { code: 'A', name: 'Alice', dealer: 'Dealer', rm: 'RM', branch: 'HO', privilege: true, createdAt: '2026-09-03T20:00:00.000Z' },
  { code: 'B', name: 'Bob', dealer: '', rm: '', branch: '', privilege: false, createdAt: '2026-09-22T08:30:00.000Z' },
];

test('admin edits client code and added date together, preserving other fields and selection', async () => {
  const s = await screen(true, originalClients);
  s.label('Select client A').onChange({ target: { checked: true } }); s.render();
  s.label('Edit client A').onClick(); s.render();
  const localDate = new Date(originalClients[0].createdAt);
  assert.equal(s.label('Added date for A').value, `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`);
  s.label('Client code for A').onChange({ target: { value: ' NEW1 ' } }); s.render();
  s.label('Added date for A').onChange({ target: { value: '2026-09-15' } }); s.render();
  await s.label('Save client A').onClick(); s.render();
  assert.deepEqual(JSON.parse(JSON.stringify(s.saved)), [
    { ...originalClients[0], code: 'NEW1', createdAt: new Date('2026-09-15T00:00:00').toISOString() },
    originalClients[1],
  ]);
  assert.equal(s.label('Select client NEW1').checked, true);
  assert.equal(s.label('Save client A'), undefined);
  assert.ok(s.requests.includes('/api/master/added-dates'));
  s.label('Edit client NEW1').onClick(); s.render();
  assert.equal(s.label('Added date for NEW1').value, '2026-09-15');
});

test('code-only changes preserve the exact original added timestamp', async () => {
  const s = await screen(true, originalClients);
  s.label('Edit client A').onClick(); s.render();
  s.label('Client code for A').onChange({ target: { value: 'NEW1' } }); s.render();
  await s.label('Save client A').onClick();
  assert.equal(s.saved[0].createdAt, originalClients[0].createdAt);
  assert.equal(s.requests.length, 0);
});

test('invalid code/date edits never save or discard the draft', async () => {
  const s = await screen(true, originalClients);
  s.label('Edit client A').onClick(); s.render();
  for (const code of [' ', ' b ', 'B', 'x'.repeat(65)]) {
    s.label('Client code for A').onChange({ target: { value: code } }); s.render();
    await s.label('Save client A').onClick(); s.render();
    assert.equal(s.saved, undefined);
    assert.ok(s.label('Save client A'));
  }
  s.label('Client code for A').onChange({ target: { value: 'A' } }); s.render();
  for (const date of ['', '2026-02-30', 'invalid']) {
    s.label('Added date for A').onChange({ target: { value: date } }); s.render();
    await s.label('Save client A').onClick(); s.render();
    assert.equal(s.saved, undefined);
    assert.equal(s.notices.at(-1)[0], 'Enter a valid added date.');
  }
});

test('failed save keeps code and date drafts; cancel restores the original values', async () => {
  const s = await screen(true, originalClients);
  s.label('Edit client A').onClick(); s.render();
  s.label('Client code for A').onChange({ target: { value: 'NEW1' } }); s.render();
  s.label('Added date for A').onChange({ target: { value: '2026-09-15' } }); s.render();
  s.fail(); await s.label('Save client A').onClick(); s.render();
  assert.equal(s.label('Client code for A').value, 'NEW1');
  assert.equal(s.label('Added date for A').value, '2026-09-15');
  const actions = s.nodes().find(n => Array.isArray(n.props?.children) && n.props.children.some(c => c?.props?.['aria-label'] === 'Save client A'));
  actions.props.children[1].props.onClick(); s.render();
  s.label('Edit client A').onClick(); s.render();
  assert.equal(s.label('Client code for A').value, 'A');
  assert.notEqual(s.label('Added date for A').value, '2026-09-15');
});
