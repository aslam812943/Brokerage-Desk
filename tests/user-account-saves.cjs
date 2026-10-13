const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { transform } = require("next/dist/build/swc");

async function screen() {
  const assignments = ["PERSON A", "PERSON B", "PERSON C"].map((name) => ({ name, dealerClients: 2, rmClients: 0 }));
  const users = ["alice", "bob"].map((id, i) => ({
    id, username: id, role: "VIEWER", viewerName: assignments[i].name,
    assignment: assignments[i], createdAt: "2026-10-13T00:00:00Z", mustChangePassword: false,
  }));
  const slots = [];
  const effects = [];
  const requests = [];
  const notices = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!(index in slots)) { slots[index] = true; effects.push(effect); }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const source = fs.readFileSync(path.join(__dirname, "../app/Dashboard.jsx"), "utf8") + "\nexport { UsersSection };";
  const { code } = await transform(source, {
    filename: "Dashboard.jsx",
    jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" },
    module: { type: "commonjs" },
  });
  const exports = {};
  vm.runInNewContext(code, {
    exports, process: { env: {} },
    fetch(url, options = {}) {
      const request = { url, options };
      requests.push(request);
      if (!options.method) return Promise.resolve(Response.json(url.endsWith("assignments") ? assignments : users));
      return new Promise((resolve, reject) => { request.resolve = (body, status = 200) => resolve(Response.json(body, { status })); request.reject = reject; });
    },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (["next-auth/react", "xlsx", "recharts", "lucide-react"].includes(name)) return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  let tree;
  const render = () => { cursor = 0; tree = exports.UsersSection({ showToast: (...args) => notices.push(args), onWipeUsers: async () => {} }); };
  function find(label) {
    function visit(node) {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) return node.map(visit).find(Boolean);
      if (node.props?.["aria-label"] === label) return node;
      return visit(node.props?.children);
    }
    const node = visit(tree);
    assert.ok(node, `Missing control: ${label}`);
    return node.props;
  }
  render();
  effects.forEach((fn) => fn());
  await new Promise((resolve) => setImmediate(resolve));
  render();
  return { render, find, requests, notices };
}

test("saving one account preserves another draft and never reloads the list", async () => {
  const s = await screen();
  s.find("Assigned dealer/RM for alice").onChange({ target: { value: "PERSON C" } });
  s.find("Assigned dealer/RM for bob").onChange({ target: { value: "PERSON A" } });
  s.render();
  const save = s.find("Save assignment for alice").onClick();
  s.render();
  assert.equal(s.find("Save assignment for alice").disabled, true);
  assert.equal(s.find("Save assignment for bob").disabled, false);
  assert.equal(s.find("Assigned dealer/RM for bob").disabled, false);
  const put = s.requests.at(-1);
  assert.equal(put.url, "/api/users/alice");
  assert.deepEqual(JSON.parse(put.options.body), { viewerName: "PERSON C" });
  put.resolve({ ok: true, viewerName: "PERSON C" });
  await save;
  s.render();
  assert.equal(s.find("Assigned dealer/RM for alice").value, "PERSON C");
  assert.equal(s.find("Save assignment for alice").disabled, true, "saved assignment needs no further save");
  assert.equal(s.find("Assigned dealer/RM for bob").value, "PERSON A", "other unsaved selection survives");
  assert.equal(s.find("Save assignment for bob").disabled, false);
  assert.equal(s.requests.length, 3, "only two initial GETs and one person's PUT");
});

test("concurrent saves finish independently; failures preserve drafts and allow retry", async () => {
  const s = await screen();
  for (const user of ["alice", "bob"]) s.find(`Assigned dealer/RM for ${user}`).onChange({ target: { value: "PERSON C" } });
  s.render();
  const aliceClick = s.find("Save assignment for alice").onClick;
  const aliceSave = aliceClick();
  await aliceClick(); // Duplicate click before React has rendered the disabled button.
  const bobSave = s.find("Save assignment for bob").onClick();
  assert.equal(s.requests.length, 4);
  s.requests[3].resolve({ ok: true, viewerName: "PERSON C" });
  await bobSave;
  s.render();
  assert.equal(s.find("Assigned dealer/RM for alice").disabled, true);
  assert.equal(s.find("Assigned dealer/RM for bob").disabled, false);
  s.requests[2].resolve({ error: "Try again" }, 500);
  await aliceSave;
  s.render();
  assert.equal(s.find("Assigned dealer/RM for alice").value, "PERSON C");
  assert.equal(s.find("Save assignment for alice").disabled, false);
  assert.equal(s.find("Save assignment for bob").disabled, true);
  const retry = s.find("Save assignment for alice").onClick();
  s.requests.at(-1).resolve({ ok: true, viewerName: "PERSON C" });
  await retry;
  s.render();
  assert.equal(s.find("Save assignment for alice").disabled, true);
});
