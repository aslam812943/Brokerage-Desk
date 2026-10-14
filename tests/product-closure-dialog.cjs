const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { transform } = require("next/dist/build/swc");

async function screen(mode) {
  const slots = [], requests = [], saved = [];
  let cursor = 0, closed = 0, tree;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect() {},
  };
  const jsx = (type, props) => ({ type, props });
  const source = fs.readFileSync(path.join(__dirname, "../app/Dashboard.jsx"), "utf8") + "\nexport { ProductClosureDialog };";
  const { code } = await transform(source, {
    filename: "Dashboard.jsx", jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" },
  });
  const exports = {};
  vm.runInNewContext(code, {
    exports, process: { env: {} },
    fetch(url, options) {
      const request = { url, options };
      requests.push(request);
      return new Promise((resolve, reject) => { request.resolve = (body, status = 200) => resolve(Response.json(body, { status })); request.reject = reject; });
    },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (["next-auth/react", "xlsx", "recharts", "lucide-react"].includes(name)) return {};
      throw new Error(name);
    },
  });
  function render() {
    cursor = 0;
    tree = exports.ProductClosureDialog({ mode, entry: { id: "entry-1", product: "demat", notes: "original", month: "2026-10" }, onClose: () => closed++, onSaved: (...args) => saved.push(args) });
  }
  function find(predicate) {
    function visit(node) {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) return node.map(visit).find(Boolean);
      return predicate(node) ? node : visit(node.props?.children);
    }
    const node = visit(tree);
    assert.ok(node);
    return node.props;
  }
  render();
  return { render, find, requests, saved, closed: () => closed, submit: () => find((n) => n.type === "form").onSubmit({ preventDefault() {} }) };
}

test("delete requires confirmation; cancel sends no request and pending deletion cannot duplicate", async () => {
  const cancel = await screen("delete");
  cancel.find((n) => n.type === "button" && n.props.children === "Cancel").onClick();
  assert.equal(cancel.closed(), 1);
  assert.equal(cancel.requests.length, 0);
  const s = await screen("delete");
  const pending = s.submit();
  await s.submit();
  s.render();
  assert.equal(s.find((n) => n.props?.type === "submit").disabled, true);
  s.find((n) => n.type === "dialog").onCancel({ preventDefault() {} });
  assert.equal(s.closed(), 0);
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].options.method, "DELETE");
  s.requests[0].resolve({ ok: true, id: "entry-1" });
  await pending;
  assert.equal(s.saved[0][1], true);
  assert.equal(s.closed(), 1);
});

test("edit preserves drafts after server and network errors and supports retry", async () => {
  const s = await screen("edit");
  s.find((n) => n.type === "textarea").onChange({ target: { value: "corrected notes" } });
  s.find((n) => n.type === "select").onChange({ target: { value: "iepf" } });
  s.render();
  let pending = s.submit();
  assert.deepEqual(JSON.parse(s.requests[0].options.body), { product: "iepf", notes: "corrected notes" });
  s.requests[0].resolve({ error: "Please retry" }, 500);
  await pending;
  s.render();
  assert.equal(s.find((n) => n.props?.role === "alert").children, "Please retry");
  assert.equal(s.find((n) => n.type === "textarea").value, "corrected notes");
  assert.equal(s.closed(), 0);
  assert.equal(s.saved.length, 0);
  pending = s.submit();
  s.requests[1].reject(new Error("Network unavailable"));
  await pending;
  s.render();
  assert.equal(s.find((n) => n.props?.type === "submit").disabled, false);
  pending = s.submit();
  s.requests[2].resolve({ id: "entry-1", product: "iepf", notes: "corrected notes" });
  await pending;
  assert.equal(s.saved[0][1], false);
  assert.equal(s.closed(), 1);
});
