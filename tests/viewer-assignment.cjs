const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { transform } = require("next/dist/build/swc");

const root = path.join(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));
const compiled = new Map();
async function load(file, mocks) {
  if (!compiled.has(file)) {
    const result = await transform(fs.readFileSync(path.join(root, file), "utf8"), {
      filename: file,
      jsc: { parser: { syntax: "ecmascript", jsx: file.endsWith(".jsx") }, transform: { react: { runtime: "automatic" } }, target: "es2020" },
      module: { type: "commonjs" },
    });
    compiled.set(file, result.code);
  }
  const exports = {};
  vm.runInNewContext(compiled.get(file), {
    exports, process: { env: {} }, URL,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected import ${name} in ${file}`);
    },
  }, { filename: file });
  return exports;
}

async function fixture() {
  const accounts = [
    { id: "viewer", username: "thileepan", role: "VIEWER", viewerName: "THILEEPAN V" },
    { id: "admin", username: "admin", role: "ADMIN", viewerName: null },
  ];
  const dealers = [{ name: "THILEEPAN V" }, { name: "RASISH" }];
  const rms = [{ name: "RM ONLY" }];
  const clients = [
    { code: "A", dealer: "THILEEPAN V", rm: "OTHER" },
    { code: "B", dealer: "OTHER", rm: "THILEEPAN V" },
    { code: "C", dealer: "RASISH", rm: "OTHER" },
    { code: "D", dealer: "", rm: "" },
  ];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const db = {
    user: {
      findUnique: async ({ where }) => accounts.find((u) => where.id ? u.id === where.id : u.username === where.username) ?? null,
      findMany: async () => accounts,
      update: async ({ where, data }) => Object.assign(accounts.find((u) => u.id === where.id), data),
      create: async ({ data }) => { const u = { id: "created", ...data }; accounts.push(u); return u; },
    },
    dealer: { findFirst: async ({ where }) => dealers.find((d) => same(d.name, where.name.equals)) ?? null, findMany: async () => dealers },
    rm: { findFirst: async ({ where }) => rms.find((d) => same(d.name, where.name.equals)) ?? null, findMany: async () => rms },
    masterClient: {
      findFirst: async ({ where }) => {
        const field = Object.keys(where)[0];
        return clients.find((c) => same(c[field], where[field].equals)) ?? null;
      },
      groupBy: async ({ by: [field] }) => {
        const counts = new Map();
        clients.filter((c) => c[field]).forEach((c) => counts.set(c[field], (counts.get(c[field]) || 0) + 1));
        return [...counts].map(([name, count]) => ({ [field]: name, _count: { _all: count } }));
      },
    },
  };
  const scope = await load("lib/viewerScope.js", {});
  let actor = "viewer";
  const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
  const auth = await load("lib/apiAuth.js", {
    "next-auth": { getServerSession: async () => actor ? { user: { id: actor, name: actor === "admin" ? "admin" : "thileepan", role: actor === "admin" ? "ADMIN" : "VIEWER" } } : null },
    "next/server": next, "./authOptions": { authOptions: {} }, "./prisma": { prisma: db }, "./viewerScope": scope,
  });
  const audits = [];
  const routeMocks = (prefix) => ({
    "next/server": next, zod: require("zod"), bcryptjs: { hash: async () => "test-hash" },
    [`${prefix}/prisma`]: { prisma: db }, [`${prefix}/apiAuth`]: auth,
    [`${prefix}/viewerScope`]: scope,
    [`${prefix}/audit`]: { writeAudit: async (entry) => audits.push(entry) },
    [`${prefix}/generatePassword`]: { generateTempPassword: () => "test-only-temporary" },
  });
  return { db, accounts, clients, scope, auth, audits, routeMocks, setActor: (value) => { actor = value; } };
}

test("explicit assignment resolves a different login and scopes both dealer/RM clients", async () => {
  const f = await fixture();
  const { session, response } = await f.auth.requireSession();
  assert.equal(response, null);
  assert.equal(session.user.name, "thileepan", "audit/login identity stays unchanged");
  assert.equal(session.user.viewerName, "THILEEPAN V");
  const where = f.scope.viewerClientWhere(session.user.viewerName);
  const visible = f.clients.filter((c) => where.OR.some((part) => Object.entries(part).some(([key, rule]) => c[key].toLowerCase() === rule.equals.toLowerCase())));
  assert.deepEqual(visible.map((c) => c.code), ["A", "B"]);
  assert.deepEqual(plain(f.scope.viewerClientWhere(null)), { code: { in: [] } });
});

test("legacy exact names still work; substring names never auto-match", async () => {
  const f = await fixture();
  f.accounts[0].viewerName = null;
  assert.equal((await f.auth.requireSession()).response.status, 403);
  f.accounts[0].username = "rasish";
  assert.equal((await f.auth.requireSession()).session.user.viewerName, "RASISH");
  f.accounts[0].viewerName = "DELETED PERSON";
  assert.equal((await f.auth.requireSession()).response.status, 403, "stale explicit assignment must not fall back to username");
});

test("missing/deleted assignments deny data but permit account help and password change", async () => {
  const f = await fixture();
  f.accounts[0].viewerName = "missing";
  const denied = await f.auth.requireSession();
  assert.equal((await denied.response.json()).code, "VIEWER_ASSIGNMENT_REQUIRED");
  const help = await f.auth.requireSession({ allowUnmapped: true });
  assert.equal(help.response, null);
  assert.equal(help.session.user.viewerScope.matched, false);
  f.accounts.splice(0, 1);
  assert.equal((await f.auth.requireSession({ allowUnmapped: true })).response.status, 401);
  f.setActor(null);
  assert.equal((await f.auth.requireSession()).response.status, 401);
});

test("assignment updates are read immediately and admins need no assignment", async () => {
  const f = await fixture();
  assert.equal((await f.auth.requireSession()).session.user.viewerName, "THILEEPAN V");
  f.accounts[0].viewerName = "RM ONLY";
  const current = await f.auth.requireSession();
  assert.equal(current.session.user.viewerScope.kind, "rm");
  assert.equal(current.session.user.viewerName, "RM ONLY");
  f.setActor("admin");
  assert.equal((await f.auth.requireAdmin()).response, null);
});

test("admin catalogue includes imported names and identifies accounts needing repair", async () => {
  const f = await fixture();
  const entries = await f.scope.listViewerAssignments(f.db);
  const assigned = entries.find((e) => e.name === "THILEEPAN V");
  assert.equal(assigned.dealerClients, 1);
  assert.equal(assigned.rmClients, 1);
  assert.ok(entries.some((e) => e.name === "OTHER"));
  f.setActor("admin");
  f.accounts[0].viewerName = null;
  const route = await load("app/api/users/route.js", f.routeMocks("../../../lib"));
  const users = await (await route.GET()).json();
  assert.equal(users.find((u) => u.id === "viewer").assignment, null);
});

test("new viewers require a valid selection; admins can create differently named logins", async () => {
  const f = await fixture();
  f.setActor("admin");
  const route = await load("app/api/users/route.js", f.routeMocks("../../../lib"));
  const request = (body) => ({ json: async () => body });
  assert.equal((await route.POST(request({ username: "new.viewer", role: "VIEWER" }))).status, 400);
  assert.equal((await route.POST(request({ username: "new.viewer", role: "VIEWER", viewerName: "thileep" }))).status, 400);
  assert.equal(f.accounts.length, 2);
  assert.equal((await route.POST(request({ username: "new.viewer", role: "VIEWER", viewerName: "thileepan v" }))).status, 201);
  assert.equal(f.accounts.at(-1).viewerName, "THILEEPAN V");
  assert.equal(f.accounts.at(-1).mustChangePassword, true);
});

test("assignment editing rejects viewers/unknown names and logs successful admin changes", async () => {
  const f = await fixture();
  const route = await load("app/api/users/[id]/route.js", f.routeMocks("../../../../lib"));
  const req = (viewerName) => ({ json: async () => ({ viewerName }) });
  assert.equal((await route.PUT(req("RASISH"), { params: { id: "viewer" } })).status, 403);
  f.setActor("admin");
  assert.equal((await route.PUT(req("missing"), { params: { id: "viewer" } })).status, 400);
  assert.equal((await route.PUT(req("RASISH"), { params: { id: "admin" } })).status, 400);
  assert.equal((await route.PUT(req("RASISH"), { params: { id: "absent" } })).status, 404);
  assert.equal((await route.PUT(req("RM ONLY"), { params: { id: "viewer" } })).status, 200);
  assert.equal(f.accounts[0].viewerName, "RM ONLY");
  assert.equal(f.audits.at(-1).action, "ASSIGN_VIEWER");
});

test("targets expose only the assigned person's salary", async () => {
  const f = await fixture();
  f.db.targets = { findUnique: async () => ({ dealerSalary: { "THILEEPAN V": 100, RASISH: 999 }, incentiveMultiplier: 10 }) };
  const route = await load("app/api/targets/route.js", f.routeMocks("../../../lib"));
  const data = await (await route.GET()).json();
  assert.deepEqual(data.dealerSalary, { "THILEEPAN V": 100 });
});

test("client-history ownership uses the assignment and denies other clients", async () => {
  const f = await fixture();
  f.db.masterClient.findUnique = async ({ where }) => f.clients.find((c) => c.code === where.codeNorm);
  let reads = 0;
  f.db.dailyRecord = { findMany: async () => { reads++; return [{ netBrok: 123 }]; } };
  const route = await load("app/api/daily/client/[code]/route.js", f.routeMocks("../../../../../lib"));
  assert.deepEqual(await (await route.GET({}, { params: { code: "A" } })).json(), [{ netBrok: 123 }]);
  assert.deepEqual(await (await route.GET({}, { params: { code: "B" } })).json(), [{ netBrok: 123 }]);
  assert.deepEqual(await (await route.GET({}, { params: { code: "C" } })).json(), []);
  assert.equal(reads, 2, "unrelated client's history is never queried");
});

test("monthly tasks use the assigned dealer and reject RM-only accounts", async () => {
  const f = await fixture();
  const lookups = [];
  f.db.dealerTask = { findMany: async ({ where }) => { lookups.push(where.dealer); return []; } };
  f.db.dealerProductTask = { findMany: async ({ where }) => { assert.equal(where.dealer, "THILEEPAN V"); return []; } };
  const route = await load("app/api/tasks/route.js", f.routeMocks("../../../lib"));
  const request = { url: "https://example.test/api/tasks?month=2026-10" };
  const data = await (await route.GET(request)).json();
  assert.equal(data.dealer, "THILEEPAN V");
  assert.deepEqual(lookups, ["THILEEPAN V"]);
  f.accounts[0].viewerName = "RM ONLY";
  assert.equal((await route.GET(request)).status, 403);
});

test("product closures save under the assigned dealer, ignore forged ownership, and allow multiple entries", async () => {
  const f = await fixture();
  const saved = [];
  f.db.dealerProductTask = { create: async ({ data }) => {
    const row = { id: String(saved.length + 1), ...plain(data) };
    saved.push(row);
    return row;
  } };
  const route = await load("app/api/tasks/route.js", f.routeMocks("../../../lib"));
  const request = { json: async () => ({ month: "2026-10", product: "demat", notes: " Closure notes ", dealer: "RASISH" }) };
  for (let i = 0; i < 2; i++) {
    const response = await route.POST(request);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).dealer, "THILEEPAN V");
  }
  assert.equal(saved.length, 2);
  assert.equal(saved[0].notes, "Closure notes");
  assert.equal((await route.POST({ json: async () => ({ month: "2026-10", product: "unknown" }) })).status, 400);
  f.setActor("admin");
  assert.equal((await route.POST(request)).status, 403);
  f.setActor(null);
  assert.equal((await route.POST(request)).status, 401);
  f.setActor("viewer");
  f.accounts[0].viewerName = "RM ONLY";
  assert.equal((await route.POST(request)).status, 403);
  f.accounts[0].viewerName = "UNKNOWN";
  assert.equal((await route.POST(request)).status, 403);
  assert.equal(saved.length, 2, "unauthorized requests must not insert rows");
});

test("MIS selects the assigned person's aggregate instead of the login name", async () => {
  const f = await fixture();
  f.db.targets = { findUnique: async () => ({ dealerSalary: { "THILEEPAN V": 100 }, incentiveMultiplier: 10 }) };
  f.db.tradingHoliday = { findMany: async () => [] };
  f.db.$queryRaw = async (strings) => {
    const sql = strings.join("?");
    if (sql.includes("SELECT DISTINCT date")) return [{ date: "2026-10-09" }, { date: "2026-10-08" }];
    if (sql.includes("SELECT person, COUNT")) return [{ person: "THILEEPAN V", cnt: 2 }, { person: "RASISH", cnt: 99 }];
    if (sql.includes("WITH records")) return [{ person: "THILEEPAN V", mtd: 123, yesterday: 12 }, { person: "RASISH", mtd: 999 }];
    throw new Error("Unexpected MIS query");
  };
  const route = await load("app/api/mis/summary/route.js", f.routeMocks("../../../../lib"));
  const data = await (await route.GET()).json();
  assert.equal(data.dealer, "THILEEPAN V");
  assert.equal(data.clientsMapped, 2);
  assert.equal(data.mtdRevenue, 123);
  assert.equal(data.target, 1000);
});

test("password-change and account-loading branches preserve hook order", async () => {
  let session = null;
  let calls = [];
  const react = {
    useState: (value) => { calls.push("state"); return [value, () => {}]; },
    useEffect: () => { calls.push("effect"); },
    useMemo: (fn) => { calls.push("memo"); return fn(); },
    useCallback: (fn) => { calls.push("callback"); return fn; },
    useRef: (value) => { calls.push("ref"); return { current: value }; },
  };
  const jsx = (type, props) => ({ type, props });
  const app = await load("app/Dashboard.jsx", {
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "next-auth/react": { useSession: () => ({ data: session, update: async () => {} }) },
    xlsx: {}, recharts: {}, "lucide-react": {},
  });
  const traces = [];
  for (const mustChangePassword of [null, true, false]) {
    session = mustChangePassword === null ? null : { user: { name: "thileepan", role: "VIEWER", mustChangePassword } };
    calls = [];
    const view = app.default();
    assert.equal(mustChangePassword === true ? view.type.name : view.type, mustChangePassword === true ? "ForcedPasswordChange" : "div");
    traces.push([...calls]);
  }
  assert.deepEqual(traces[0], traces[1]);
  assert.deepEqual(traces[1], traces[2]);
});
