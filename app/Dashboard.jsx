"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import * as XLSX from "xlsx";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  LayoutDashboard, UploadCloud, Users, Target, TrendingUp,
  Calendar, Trash2, Plus, Search, AlertTriangle, CheckCircle2,
  FileSpreadsheet, Building2, IndianRupee, Pencil, X, Check,
  ShieldCheck, Eye, ChevronUp, ChevronDown, ReceiptText, Layers, ListChecks, KeyRound, UserCog,
  Download, FileSearch, FileBarChart2, Printer
} from "lucide-react";

/* ---------- design tokens ---------- */
const INK = "#0E1420";

const INK_SOFT = "#4B5566";
const BG = "#F4F5F7";
const SURFACE = "#FFFFFF";
const LINE = "#E4E7EC";
const NAVY = "#132038";

const EMERALD = "#059669", EMERALD_SOFT = "#D8F3E9";
const GOLD = "#D97706", GOLD_SOFT = "#FCECD1";
const RED = "#DC2626", RED_SOFT = "#FBDEDC";
const BLUE = "#2563EB", BLUE_SOFT = "#DCE8FD";
const VIOLET = "#7C3AED", VIOLET_SOFT = "#EDE3FD";
const ROSE = "#DB2777", ROSE_SOFT = "#FBDEEB";
const TEAL = "#0D9488", TEAL_SOFT = "#D7F1EE";

const TONE_MAP = {
  emerald: [EMERALD, EMERALD_SOFT], gold: [GOLD, GOLD_SOFT], red: [RED, RED_SOFT],
  blue: [BLUE, BLUE_SOFT], violet: [VIOLET, VIOLET_SOFT], rose: [ROSE, ROSE_SOFT],
  teal: [TEAL, TEAL_SOFT], ink: [INK, "#EEF0F3"],
};

const PALETTE = ["#2563EB", "#059669", "#D97706", "#7C3AED", "#DB2777", "#0D9488", "#C2410C", "#4338CA", "#B91C1C", "#0891B2"];
const dealerColor = (name) => {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) % PALETTE.length;
  return PALETTE[h];
};

const UNMAPPED = "Unmapped";

const fmtINR = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "₹0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
};
const fmtFull = (n) => `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const quarterOf = (d) => Math.floor(d.getMonth() / 3) + 1;
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISO(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const normCode = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "");
// Dealer names are matched case-insensitively against the known list so a
// re-upload with different casing (e.g. "RASISH" vs "Rasish") snaps onto the
// existing dealer instead of silently splitting their stats into a second row.
function canonicalDealer(dealerNames, raw) {
  const name = String(raw || "").trim();
  if (!name) return "";
  const match = dealerNames.find((d) => d.toLowerCase() === name.toLowerCase());
  return match || name;
}
// Same case-insensitive snap-to-registry matching as canonicalDealer, for RMs.
function canonicalRm(rmNames, raw) {
  const name = String(raw || "").trim();
  if (!name) return "";
  const match = rmNames.find((d) => d.toLowerCase() === name.toLowerCase());
  return match || name;
}

// Splits a client's brokerage between their Dealer and RM. When both are set
// and name the same person (case-insensitive — the same dealer often acts as
// their own RM), there's nothing to split: the dealer takes the full 100%.
// Otherwise the RM gets rmSharePct (Targets.rmSplitPct) and the dealer gets
// the remainder; if only one side is mapped, that side takes the full amount.
function splitShares(dealer, rm, rmSharePct) {
  const d = String(dealer || "").trim();
  const r = String(rm || "").trim();
  const hasDealer = !!d && d !== UNMAPPED;
  const hasRm = !!r;
  if (hasDealer && hasRm && d.toLowerCase() === r.toLowerCase()) return { dealerPct: 100, rmPct: 0, samePerson: true };
  if (hasDealer && hasRm) return { dealerPct: 100 - rmSharePct, rmPct: rmSharePct, samePerson: false };
  if (hasDealer) return { dealerPct: 100, rmPct: 0, samePerson: false };
  if (hasRm) return { dealerPct: 0, rmPct: 100, samePerson: false };
  return { dealerPct: 0, rmPct: 0, samePerson: false };
}

/*
 * Storage adapter: the dashboard below was written against a simple
 * key/value store (window.storage). It's now backed by real API routes
 * and a Postgres database, gated by session auth, but keeps the exact
 * same get/set/delete/list surface so none of the dashboard logic below
 * had to change.
 */
async function apiGet(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) return null;
  return res.json();
}
// Per-tab-switch aggregate reads (dashboard summary, brokerage-by-client,
// RM summary) are cheap in Postgres but every tab component fetches on
// mount, so unmounting/remounting on every nav click paid the network round
// trip again each time. Cached here by URL so a remount reads instantly;
// cleared by invalidateReadCache() whenever an action mutates the
// underlying DailyRecord/MasterClient/Targets data these reads are built
// from, so a stale figure is never shown after an edit.
const _readCache = new Map();
async function apiGetCached(url) {
  if (_readCache.has(url)) return _readCache.get(url);
  const data = await apiGet(url);
  if (data != null) _readCache.set(url, data);
  return data;
}
function invalidateReadCache() { _readCache.clear(); }
async function apiPut(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}
async function apiDelete(url) {
  const res = await fetch(url, { method: "DELETE", credentials: "same-origin" });
  return res.ok;
}

async function storageGet(key) {
  try {
    if (key === "master-clients") return (await apiGet("/api/master")) ?? [];
    if (key === "dealers-list") return (await apiGet("/api/dealers")) ?? [];
    if (key === "rms-list") return (await apiGet("/api/rms")) ?? [];
    if (key === "targets") return (await apiGet("/api/targets")) ?? { monthly: 0, dealerMonthly: {} };
    if (key.startsWith("daily:")) {
      const all = (await apiGet("/api/daily")) ?? {};
      return all[key.slice("daily:".length)] ?? null;
    }
    if (key.startsWith("debit:")) {
      const all = (await apiGet("/api/debit")) ?? {};
      return all[key.slice("debit:".length)] ?? null;
    }
    return null;
  } catch (e) { return null; }
}
async function storageSet(key, value) {
  try {
    if (key === "master-clients") return apiPut("/api/master", value);
    if (key === "dealers-list") return apiPut("/api/dealers", value);
    if (key === "rms-list") return apiPut("/api/rms", value);
    if (key === "targets") return apiPut("/api/targets", value);
    if (key.startsWith("daily:")) return apiPut(`/api/daily/${key.slice("daily:".length)}`, value);
    if (key.startsWith("debit:")) return apiPut(`/api/debit/${key.slice("debit:".length)}`, value);
    return false;
  } catch (e) { return false; }
}
// `source` scopes a daily delete to just that source's rows for the date (SW vs
// KOTAK), leaving the other source's report intact. Omit it to wipe the whole date.
async function storageDelete(key, source) {
  try {
    if (key.startsWith("daily:")) {
      const date = key.slice("daily:".length);
      const qs = source !== undefined ? `?source=${encodeURIComponent(source)}` : "";
      return apiDelete(`/api/daily/${date}${qs}`);
    }
    if (key.startsWith("debit:")) return apiDelete(`/api/debit/${key.slice("debit:".length)}`);
    return false;
  } catch (e) { return false; }
}
function normHeader(h) { return String(h || "").trim().toLowerCase(); }
function findCol(headers, ...needles) {
  for (const n of needles) { const i = headers.findIndex((h) => h.includes(n)); if (i >= 0) return i; }
  return -1;
}
function num(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}
async function readWorkbook(file) {
  const isCsv = /\.csv$/i.test(file.name);
  return isCsv ? XLSX.read(await file.text(), { type: "string" }) : XLSX.read(await file.arrayBuffer(), { type: "array" });
}

function parseDailySheet(rows) {
  if (!rows.length) return { records: [], error: "Empty sheet" };
  const headers = rows[0].map(normHeader);
  const codeI = findCol(headers, "client code", "code");
  const nameI = findCol(headers, "client name", "name");
  // "total brokerage" must be checked before the bare "brokerage" fallback —
  // Kotak's sheet has separate Cash/Derivative/CDS/Commodity brokerage columns
  // before Total Brokerage, and the generic needle would match Cash first.
  const netBrokI = findCol(headers, "net brok", "total brokerage", "brokerage");
  if (codeI < 0 || netBrokI < 0) return { records: [], error: "Couldn't find 'Client Code' and 'Net Brokerage' columns. The file needs: Client Code, Client Name, Net Brokerage." };
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row[codeI] === undefined || row[codeI] === null || String(row[codeI]).trim() === "") continue;
    records.push({ code: String(row[codeI]).trim(), name: nameI >= 0 ? String(row[nameI] || "").trim() : "", netBrok: num(row[netBrokI]) });
  }
  return { records, error: null };
}

function parseDebitSheet(rows) {
  if (!rows.length) return { records: [], error: "Empty sheet" };
  const headers = rows[0].map(normHeader);
  const codeI = findCol(headers, "client code", "code");
  const nameI = findCol(headers, "client name", "name");
  const debitI = findCol(headers, "debit", "outstanding", "balance");
  if (codeI < 0 || debitI < 0) return { records: [], error: "Couldn't find 'Client Code' and 'Debit' columns. The file needs: Client Code, Client Name, Debit." };
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row[codeI] === undefined || row[codeI] === null || String(row[codeI]).trim() === "") continue;
    records.push({ code: String(row[codeI]).trim(), name: nameI >= 0 ? String(row[nameI] || "").trim() : "", debit: num(row[debitI]) });
  }
  return { records, error: null };
}

function parseMasterSheet(rows) {
  if (!rows.length) return { records: [], error: "Empty sheet" };
  const headers = rows[0].map(normHeader);
  const codeI = findCol(headers, "client code", "code");
  const nameI = findCol(headers, "client name", "name");
  const rmI = findCol(headers, "rm");
  const dealerI = findCol(headers, "dealer");
  const branchI = findCol(headers, "branch");
  if (codeI < 0 || dealerI < 0) return { records: [], error: "Couldn't find 'Client Code' and 'Dealer' columns." };
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row[codeI] === undefined || row[codeI] === null || String(row[codeI]).trim() === "") continue;
    records.push({
      code: String(row[codeI]).trim(),
      name: nameI >= 0 ? String(row[nameI] || "").trim() : "",
      rm: rmI >= 0 ? String(row[rmI] || "").trim() : "",
      dealer: String(row[dealerI] || "").trim() || "",
      branch: branchI >= 0 ? String(row[branchI] || "").trim() : "",
    });
  }
  return { records, error: null };
}

function guessDateFromFilename(filename) {
  const m = filename.match(/(\d{2})(\d{2})(\d{4})/);
  if (m) { const [, dd, mm, yyyy] = m; const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd)); if (!isNaN(d.getTime())) return d; }
  return new Date();
}

function downloadCSV(filename, headerRow, sampleRows) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [headerRow, ...sampleRows].map((r) => r.map(esc).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Card({ children, style = {} }) {
  return <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(14,20,32,0.04)", ...style }}>{children}</div>;
}
function KPI({ label, value, sub, tone = "ink", icon: Icon }) {
  const [c, bg] = TONE_MAP[tone] || TONE_MAP.ink;
  return (
    <Card style={{ padding: "18px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: c }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: INK_SOFT, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}</span>
        {Icon && <div style={{ width: 30, height: 30, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={15} color={c} /></div>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 6 }}>{sub}</div>}
    </Card>
  );
}
function SectionTitle({ children }) { return <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 12 }}>{children}</div>; }
function EmptyState({ icon: Icon, title, text }) {
  return (
    <Card style={{ padding: 50, textAlign: "center" }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: BLUE_SOFT, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        <Icon size={24} color={BLUE} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: INK_SOFT, maxWidth: 380, margin: "0 auto" }}>{text}</div>
    </Card>
  );
}
// Shown for the first moment a Clients/Dealers/RMs/Upload/Missing Finder tab
// is opened, while its one-time full daily/debit history fetch is in flight.
function HistoryLoadingPane() {
  return (
    <Card style={{ padding: 50, textAlign: "center", color: INK_SOFT, fontSize: 13.5 }}>
      Loading upload history…
    </Card>
  );
}
function ProgressBar({ pct }) {
  const color = pct >= 100 ? EMERALD : pct >= 60 ? GOLD : RED;
  return <div style={{ height: 7, background: "#EDEFF2", borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, Math.max(2, pct))}%`, background: color, borderRadius: 99, transition: "width .4s ease" }} /></div>;
}
function Badge({ text, color }) {
  return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, color: "#fff", background: color }}>{text}</span>;
}
function DangerZone({ title, description, confirmWord, onConfirm }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const canConfirm = typed.trim().toUpperCase() === confirmWord;
  return (
    <Card style={{ padding: 18, border: `1px solid ${RED}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: RED, marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: INK_SOFT }}>{description}</div>
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: "none", background: RED, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
            <Trash2 size={14} /> {title}
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${RED_SOFT}`, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: INK_SOFT }}>Type <strong style={{ color: RED }}>{confirmWord}</strong> to confirm:</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} style={{ ...inputStyle, width: 160 }} autoFocus />
          <button
            disabled={!canConfirm}
            onClick={() => { onConfirm(); setOpen(false); setTyped(""); }}
            style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: canConfirm ? RED : "#E7B3AD", color: "#fff", fontWeight: 700, fontSize: 13, cursor: canConfirm ? "pointer" : "not-allowed" }}
          >
            Confirm — this cannot be undone
          </button>
          <button onClick={() => { setOpen(false); setTyped(""); }} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK_SOFT, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}
    </Card>
  );
}
const inputStyle = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 13, minWidth: 120 };
function SortHeader({ label, active, dir, onClick }) {
  return (
    <th onClick={onClick} style={{ cursor: "pointer", userSelect: "none" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {label} {active && (dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
    </th>
  );
}
function useSort(rows, defaultKey, defaultDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggle = (key) => { if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(key); setSortDir("desc"); } };
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);
  return { sorted, sortKey, sortDir, toggle };
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [master, setMaster] = useState([]);
  const [dealerRegistry, setDealerRegistry] = useState([]);
  const [rmRegistry, setRmRegistry] = useState([]);
  const [dailyDates, setDailyDates] = useState([]);
  const [dailyData, setDailyData] = useState({});
  const [debitDates, setDebitDates] = useState([]);
  const [debitData, setDebitData] = useState({});
  const [targets, setTargets] = useState({ monthly: 0, dealerMonthly: {}, kotakSharePct: 85, rmSplitPct: 50, dealerSalary: {}, incentiveMultiplier: 10 });
  const { data: session, update: updateSession } = useSession();
  const role = session?.user?.role === "ADMIN" ? "admin" : "user";
  const username = session?.user?.name || "";
  const mustChangePassword = !!session?.user?.mustChangePassword;
  const [toast, setToast] = useState(null);

  const showToast = (msg, tone = "emerald") => { setToast({ msg, tone }); setTimeout(() => setToast(null), 3200); };
  const isAdmin = role === "admin";

  // Only the small registries load unconditionally — master/dealers/rms/targets
  // are bounded by client count, not upload history, so there's no reason to
  // gate the whole app behind them being ready.
  useEffect(() => {
    (async () => {
      // /api/daily/dates and /api/debit/latest are both cheap — bounded by
      // dates/clients, not by transaction volume — so both load eagerly
      // instead of waiting on the lazy full-history fetch below.
      const [m, dr, rr, t, dates, latestDebit] = await Promise.all([
        storageGet("master-clients"),
        storageGet("dealers-list"),
        storageGet("rms-list"),
        storageGet("targets"),
        apiGet("/api/daily/dates"),
        apiGet("/api/debit/latest"),
      ]);
      if (m) setMaster(m);
      if (dr) setDealerRegistry(dr);
      if (rr) setRmRegistry(rr);
      if (t) setTargets(t);
      if (dates) setDailyDates([...dates].sort());
      if (latestDebit) setLatestDebitByCode(Object.fromEntries(latestDebit.map((r) => [normCode(r.code), r.debit])));
      setLoading(false);
    })();
  }, []);

  // Full daily/debit history (/api/daily + /api/debit, still whole-table reads)
  // is only needed by Clients/Dealers/RMs/Upload/Missing Finder, which reduce
  // over every record client-side — the Dashboard tab fetches its own
  // pre-aggregated summary instead (see the Dashboard component below) and
  // never needs this at all. Fetched once, lazily, the first time one of
  // those tabs is opened, instead of unconditionally on every login.
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const [dailyByDate, debitByDate] = await Promise.all([apiGet("/api/daily"), apiGet("/api/debit")]);
    const dData = dailyByDate ?? {};
    setDailyDates(Object.keys(dData).sort());
    setDailyData(dData);
    const bData = debitByDate ?? {};
    setDebitDates(Object.keys(bData).sort());
    setDebitData(bData);
    setHistoryLoaded(true);
    setHistoryLoading(false);
  }, []);
  const HISTORY_TABS = ["upload", "missingfinder"];
  useEffect(() => {
    if (HISTORY_TABS.includes(tab) && !historyLoaded && !historyLoading) loadHistory();
  }, [tab, historyLoaded, historyLoading, loadHistory]);

  const masterByCode = useMemo(() => { const map = {}; master.forEach((m) => (map[normCode(m.code)] = m)); return map; }, [master]);

  // netBrok is stored raw (as uploaded) for every source — the Kotak share is
  // applied here, at read time, so changing the setting in Targets instantly
  // recalculates every past record instead of needing a backfill each time.
  // (No more allRecords join here — every tab that needs brokerage now fetches
  // its own pre-aggregated view; only saveDaily's toast total and UploadTab's
  // preview still need this raw kotakShare/masterByCode pair.)
  const kotakShare = (targets.kotakSharePct ?? 85) / 100;

  // Fetched independently (see the initial-load effect above) via
  // /api/debit/latest — bounded by client count, so it doesn't need the full
  // debit history (debitData/debitDates) that only loads lazily.
  const [latestDebitByCode, setLatestDebitByCode] = useState({});

  const dealerNames = useMemo(() => {
    const s = new Set(dealerRegistry);
    master.forEach((m) => { if (m.dealer) s.add(m.dealer); });
    return Array.from(s).sort();
  }, [dealerRegistry, master]);

  const rmNames = useMemo(() => {
    const s = new Set(rmRegistry);
    master.forEach((m) => { if (m.rm) s.add(m.rm); });
    return Array.from(s).sort();
  }, [rmRegistry, master]);

  const latestDate = dailyDates.length ? dailyDates[dailyDates.length - 1] : null;

  // A save only replaces rows from the same source (SW or Kotak) for that date —
  // the other source's rows, if any, are kept so both reports coexist.
  const saveDaily = async (isoD, records) => {
    invalidateReadCache();
    const src = records[0]?.source || "";
    const total = records.reduce((s, r) => s + (r.source === "KOTAK" ? r.netBrok * kotakShare : r.netBrok), 0);
    setDailyData((p) => {
      const existing = p[isoD] || [];
      const kept = existing.filter((r) => (r.source || "") !== src);
      return { ...p, [isoD]: [...kept, ...records] };
    });
    setDailyDates((p) => (p.includes(isoD) ? p : [...p, isoD].sort()));
    const srcLabel = src === "KOTAK" ? " (Kotak)" : src === "SW" ? " (SW)" : "";
    showToast(`Saved ${isoD}${srcLabel} — ${records.length} clients, ${fmtFull(total)} net brokerage`);
    storageSet(`daily:${isoD}`, records);
  };
  // `source` scopes the delete to just that source's rows; omit it to remove the whole date.
  const deleteDaily = async (isoD, source) => {
    invalidateReadCache();
    const scoped = source !== undefined;
    const remaining = scoped ? (dailyData[isoD] || []).filter((r) => (r.source || "") !== source) : [];
    setDailyData((p) => {
      const next = { ...p };
      if (scoped && remaining.length) next[isoD] = remaining;
      else delete next[isoD];
      return next;
    });
    if (!scoped || remaining.length === 0) setDailyDates((p) => p.filter((d) => d !== isoD));
    const srcLabel = source === "KOTAK" ? " Kotak" : source === "SW" ? " SW" : "";
    showToast(`Removed${srcLabel} ${isoD}`, "gold");
    storageDelete(`daily:${isoD}`, source);
  };
  const saveDebit = async (isoD, records) => {
    setDebitData((p) => ({ ...p, [isoD]: records }));
    setDebitDates((p) => (p.includes(isoD) ? p : [...p, isoD].sort()));
    showToast(`Saved debit report for ${isoD} — ${records.length} clients`);
    storageSet(`debit:${isoD}`, records);
  };
  const deleteDebit = async (isoD) => {
    setDebitData((p) => { const c = { ...p }; delete c[isoD]; return c; });
    setDebitDates((p) => p.filter((d) => d !== isoD));
    showToast(`Removed debit report ${isoD}`, "gold");
    storageDelete(`debit:${isoD}`);
  };
  const saveMaster = async (records) => { invalidateReadCache(); setMaster(records); storageSet("master-clients", records); };
  const saveDealerRegistry = async (list) => { setDealerRegistry(list); storageSet("dealers-list", list); };
  const saveRmRegistry = async (list) => { setRmRegistry(list); storageSet("rms-list", list); };
  const saveTargets = async (t) => { invalidateReadCache(); setTargets(t); storageSet("targets", t); };

  const renameDealer = async (oldName, newName) => {
    newName = canonicalDealer(dealerNames.filter((d) => d !== oldName), newName);
    if (!newName || newName === oldName) return;
    const nextMaster = master.map((m) => (m.dealer === oldName ? { ...m, dealer: newName } : m));
    await saveMaster(nextMaster);
    const nextReg = dealerRegistry.filter((d) => d !== oldName);
    if (!nextReg.includes(newName)) nextReg.push(newName);
    await saveDealerRegistry(nextReg);
    const dm = { ...targets.dealerMonthly };
    if (dm[oldName] !== undefined) { dm[newName] = dm[oldName]; delete dm[oldName]; }
    await saveTargets({ ...targets, dealerMonthly: dm });
    showToast(`Renamed ${oldName} → ${newName}`);
  };
  const removeDealer = async (name) => {
    const affected = master.filter((m) => m.dealer === name).length;
    const nextMaster = master.map((m) => (m.dealer === name ? { ...m, dealer: "" } : m));
    await saveMaster(nextMaster);
    await saveDealerRegistry(dealerRegistry.filter((d) => d !== name));
    const dm = { ...targets.dealerMonthly }; delete dm[name];
    await saveTargets({ ...targets, dealerMonthly: dm });
    showToast(affected ? `Removed ${name} — ${affected} client(s) now unmapped` : `Removed ${name}`, "gold");
  };
  const addDealer = async (name) => {
    if (!name) { showToast("Enter a dealer name first", "red"); return; }
    if (dealerNames.some((d) => d.toLowerCase() === name.toLowerCase())) { showToast(`${name} already exists`, "red"); return; }
    await saveDealerRegistry([...dealerRegistry, name]);
    showToast(`Added dealer ${name}`);
  };
  const addDealersBulk = async (names) => {
    const existing = new Set(dealerNames.map((d) => d.toLowerCase()));
    const added = [];
    for (const n of names) {
      const key = n.toLowerCase();
      if (!n || existing.has(key)) continue;
      existing.add(key);
      added.push(n);
    }
    if (!added.length) { showToast("No new dealers to add — all names were empty or already exist", "gold"); return; }
    await saveDealerRegistry([...dealerRegistry, ...added]);
    showToast(`Added ${added.length} dealer(s)`);
  };

  const renameRm = async (oldName, newName) => {
    newName = canonicalRm(rmNames.filter((r) => r !== oldName), newName);
    if (!newName || newName === oldName) return;
    const nextMaster = master.map((m) => (m.rm === oldName ? { ...m, rm: newName } : m));
    await saveMaster(nextMaster);
    const nextReg = rmRegistry.filter((r) => r !== oldName);
    if (!nextReg.includes(newName)) nextReg.push(newName);
    await saveRmRegistry(nextReg);
    showToast(`Renamed ${oldName} → ${newName}`);
  };
  const removeRm = async (name) => {
    const affected = master.filter((m) => m.rm === name).length;
    const nextMaster = master.map((m) => (m.rm === name ? { ...m, rm: "" } : m));
    await saveMaster(nextMaster);
    await saveRmRegistry(rmRegistry.filter((r) => r !== name));
    showToast(affected ? `Removed ${name} — ${affected} client(s) now unmapped` : `Removed ${name}`, "gold");
  };
  const addRm = async (name) => {
    if (!name) { showToast("Enter an RM name first", "red"); return; }
    if (rmNames.some((r) => r.toLowerCase() === name.toLowerCase())) { showToast(`${name} already exists`, "red"); return; }
    await saveRmRegistry([...rmRegistry, name]);
    showToast(`Added RM ${name}`);
  };
  const addRmsBulk = async (names) => {
    const existing = new Set(rmNames.map((r) => r.toLowerCase()));
    const added = [];
    for (const n of names) {
      const key = n.toLowerCase();
      if (!n || existing.has(key)) continue;
      existing.add(key);
      added.push(n);
    }
    if (!added.length) { showToast("No new RMs to add — all names were empty or already exist", "gold"); return; }
    await saveRmRegistry([...rmRegistry, ...added]);
    showToast(`Added ${added.length} RM(s)`);
  };

  const wipeClients = async () => {
    await saveMaster([]);
    showToast("All clients removed", "gold");
  };
  const wipeDealers = async () => {
    const affected = master.filter((m) => m.dealer).length;
    await saveMaster(master.map((m) => ({ ...m, dealer: "" })));
    await saveDealerRegistry([]);
    await saveTargets({ ...targets, dealerMonthly: {} });
    showToast(affected ? `All dealers removed — ${affected} client(s) now unmapped` : "All dealers removed", "gold");
  };
  const wipeRms = async () => {
    const affected = master.filter((m) => m.rm).length;
    await saveMaster(master.map((m) => ({ ...m, rm: "" })));
    await saveRmRegistry([]);
    showToast(affected ? `All RMs removed — ${affected} client(s) now unmapped` : "All RMs removed", "gold");
  };
  const wipeUsers = async () => {
    const res = await fetch("/api/users", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE_ALL_USERS" }),
    });
    if (!res.ok) { showToast("Failed to remove other users", "red"); return; }
    const data = await res.json();
    showToast(data.count ? `Removed ${data.count} other user account(s)` : "No other user accounts to remove", "gold");
  };

  if (loading) {
    return <div style={{ minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "var(--font-inter), sans-serif", color: INK_SOFT }}>Loading brokerage data…</div>;
  }

  if (mustChangePassword) {
    return (
      <ForcedPasswordChange
        username={username}
        onDone={async () => {
          await updateSession();
          showToast("Password updated");
        }}
      />
    );
  }

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, color: BLUE, adminOnly: false },
    { id: "clients", label: "Clients", icon: Users, color: TEAL, adminOnly: false },
    { id: "dealers", label: "Dealers", icon: Building2, color: VIOLET, adminOnly: false },
    { id: "rms", label: "RMs", icon: UserCog, color: ROSE, adminOnly: false },
    { id: "tasks", label: "Monthly Tasks", icon: ListChecks, color: GOLD, adminOnly: false },
    { id: "upload", label: "Upload", icon: UploadCloud, color: GOLD, adminOnly: true },
    { id: "missingfinder", label: "Missing Finder", icon: FileSearch, color: RED, adminOnly: true },
    { id: "reports", label: "Reports", icon: FileBarChart2, color: TEAL, adminOnly: true },
    { id: "targets", label: "Targets", icon: Target, color: ROSE, adminOnly: true },
  ];
  const visibleNav = NAV.filter((n) => !n.adminOnly || isAdmin);

  return (
    <div className="dt-root" style={{ background: BG, minHeight: 600, fontFamily: "var(--font-inter), sans-serif", color: INK, borderRadius: 16 }}>
      <style>{`
        * { box-sizing: border-box; font-family: var(--font-inter), sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 9px 12px; font-size: 13px; }
        thead th { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.4px; color: ${INK_SOFT}; border-bottom: 1px solid ${LINE}; font-weight: 600; }
        tbody tr { border-bottom: 1px solid ${LINE}; }
        tbody tr:hover { background: #FAFBFC; }
        input, select, button { font-family: var(--font-inter), sans-serif; font-size: 13.5px; }
        input:focus, select:focus, button:focus-visible { outline: 2px solid ${BLUE}; outline-offset: 1px; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: #D6D9DE; border-radius: 8px; }

        /* ---------- mobile-first responsive overrides ---------- */
        .dt-nav::-webkit-scrollbar { display: none; }
        @media (max-width: 760px) {
          .dt-root { border-radius: 0 !important; }
          .dt-header { flex-direction: column !important; align-items: stretch !important; padding: 14px 16px !important; border-radius: 0 !important; gap: 10px !important; }
          .dt-header-right { width: 100% !important; justify-content: space-between !important; gap: 10px !important; }
          .dt-nav { flex-wrap: nowrap !important; overflow-x: auto !important; -webkit-overflow-scrolling: touch; scrollbar-width: none; flex: 1 1 auto !important; }
          .dt-nav button { flex: 0 0 auto; }
          .dt-content { padding: 14px !important; }
        }
        @media (max-width: 900px) {
          .dt-chart-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 560px) {
          .dt-search-wrap { width: 100% !important; }
          .dt-search { width: 100% !important; }
        }
        @media (max-width: 480px) {
          .dt-tc-name { width: 92px !important; flex-basis: 92px !important; }
        }
      `}</style>

      <div className="dt-header" style={{ background: NAVY, borderRadius: "16px 16px 0 0", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${BLUE}, ${VIOLET})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <IndianRupee size={19} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>Sharewealth</div>
            <div style={{ fontSize: 12, color: "#A6B0C3" }}>{latestDate ? `Data through ${parseISO(latestDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : "No data uploaded yet"}</div>
          </div>
        </div>
        <div className="dt-header-right" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div className="dt-nav" style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.06)", padding: 5, borderRadius: 12, flexWrap: "wrap" }}>
            {visibleNav.map((n) => (
              <button key={n.id} onClick={() => setTab(n.id)} style={{
                display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", transition: "all .15s",
                background: tab === n.id ? n.color : "transparent", color: tab === n.id ? "#fff" : "#C4CCDB",
              }}>
                <n.icon size={14} /> {n.label}
              </button>
            ))}
          </div>
          <RoleSwitch role={role} username={username} />
        </div>
      </div>

      <div className="dt-content" style={{ padding: 22 }}>
        {tab === "dashboard" && <Dashboard master={master} targets={targets} isAdmin={isAdmin} />}
        {tab === "clients" && (
          <ClientsTab
            master={master} targets={targets} latestDebitByCode={latestDebitByCode} dealerNames={dealerNames} rmNames={rmNames}
            isAdmin={isAdmin} onSave={saveMaster} showToast={showToast} onWipe={wipeClients}
          />
        )}
        {tab === "dealers" && (
          <DealersTab
            master={master} dealerNames={dealerNames} targets={targets} latestDebitByCode={latestDebitByCode}
            isAdmin={isAdmin} onRename={renameDealer} onRemove={removeDealer} onAdd={addDealer} onAddBulk={addDealersBulk} onSaveTargets={saveTargets}
            onWipe={wipeDealers} showToast={showToast}
          />
        )}
        {tab === "rms" && (
          <RmsTab
            master={master} rmNames={rmNames}
            isAdmin={isAdmin} onRename={renameRm} onRemove={removeRm} onAdd={addRm} onAddBulk={addRmsBulk}
            onWipe={wipeRms} showToast={showToast}
          />
        )}
        {tab === "upload" && isAdmin && (historyLoaded ? (
          <UploadTab
            dailyDates={dailyDates} dailyData={dailyData} debitDates={debitDates} debitData={debitData} masterByCode={masterByCode}
            onSaveDaily={saveDaily} onDeleteDaily={deleteDaily} onSaveDebit={saveDebit} onDeleteDebit={deleteDebit} showToast={showToast}
            kotakSharePct={targets.kotakSharePct ?? 85}
          />
        ) : <HistoryLoadingPane />)}
        {tab === "missingfinder" && isAdmin && (historyLoaded ? (
          <MissingFinderTab
            master={master} dailyDates={dailyDates} dailyData={dailyData}
            onSaveDaily={saveDaily} onSaveMaster={saveMaster} showToast={showToast}
          />
        ) : <HistoryLoadingPane />)}
        {tab === "reports" && isAdmin && <ReportsTab targets={targets} showToast={showToast} />}
        {tab === "targets" && isAdmin && <TargetsTab targets={targets} dealerNames={dealerNames} onSave={saveTargets} onWipeUsers={wipeUsers} showToast={showToast} />}
        {tab === "tasks" && <TasksTab isAdmin={isAdmin} showToast={showToast} />}
      </div>

      <div style={{ textAlign: "center", padding: "6px 0 14px", fontSize: 11, color: "#B7BCC5" }}>
        v{process.env.NEXT_PUBLIC_APP_VERSION || "dev"}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: toast.tone === "red" ? RED : toast.tone === "gold" ? GOLD : NAVY, color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13.5, fontWeight: 500, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", zIndex: 50, display: "flex", alignItems: "center", gap: 8 }}>
          {toast.tone === "red" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />} {toast.msg}
        </div>
      )}
    </div>
  );
}

function RoleSwitch({ role, username }) {
  const [open, setOpen] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
        {role === "admin" ? <ShieldCheck size={14} /> : <Eye size={14} />} {username ? `${username} (${role === "admin" ? "Admin" : "Viewer"})` : (role === "admin" ? "Admin" : "Viewer")}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "#fff", borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,0.18)", padding: 6, width: 210, zIndex: 40 }}>
          <div style={{ padding: "8px 10px", fontSize: 12.5, color: INK_SOFT }}>
            Signed in as <strong style={{ color: INK }}>{username}</strong> — {role === "admin" ? "full edit access" : "read-only dashboard"}
          </div>
          <button onClick={() => { setChangingPw(true); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 600, color: INK, textAlign: "left" }}>
            <KeyRound size={14} /> Change password
          </button>
          <button onClick={() => signOut({ callbackUrl: "/login" })} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 600, color: RED, textAlign: "left" }}>
            <X size={14} /> Sign out
          </button>
        </div>
      )}
      {changingPw && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(14,20,32,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setChangingPw(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360 }}>
            <ChangePasswordForm onCancel={() => setChangingPw(false)} onSuccess={() => setChangingPw(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function ChangePasswordForm({ onSuccess, onCancel }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("New passwords don't match."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/users/password", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Couldn't change password"); return; }
      onSuccess?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, padding: 24, boxShadow: "0 12px 40px rgba(14,20,32,0.18)" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 4 }}>Change password</div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 18 }}>At least 8 characters.</div>

      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: INK_SOFT, marginBottom: 6 }}>Current password</label>
      <input type="password" autoFocus value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} autoComplete="current-password" />

      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: INK_SOFT, margin: "14px 0 6px" }}>New password</label>
      <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} autoComplete="new-password" />

      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: INK_SOFT, margin: "14px 0 6px" }}>Confirm new password</label>
      <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} autoComplete="new-password" />

      {error && <div style={{ marginTop: 12, fontSize: 12.5, color: RED }}>{error}</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button type="submit" disabled={submitting} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: NAVY, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Saving…" : "Save password"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK_SOFT, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ForcedPasswordChange({ username, onDone }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "var(--font-inter), sans-serif", padding: 16, boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>Set your password</div>
          <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 4 }}>
            {username ? <>Welcome, <strong>{username}</strong>. </> : null}
            You're signing in with a temporary password — set your own before continuing.
          </div>
        </div>
        <ChangePasswordForm onSuccess={onDone} />
      </div>
    </div>
  );
}

// Fetches its own pre-aggregated KPI/trend/dealer/top-client data from
// /api/dashboard/summary instead of reducing over every DailyRecord the app
// has ever seen — see the Phase 2 architecture review for why. Only the
// "Today's upload" detail table needs row-level data, and that's scoped to
// one date via /api/daily/[date] (Phase 1), joined against the already-loaded
// (small) client registry.
function Dashboard({ master, targets, isAdmin }) {
  const [period, setPeriod] = useState("month");
  const [todaySearch, setTodaySearch] = useState("");
  const [summary, setSummary] = useState(null);
  const [todayRows, setTodayRows] = useState(null);
  const [todayRowsDate, setTodayRowsDate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await apiGetCached(`/api/dashboard/summary?period=${period}`);
      if (!cancelled) setSummary(s);
    })();
    return () => { cancelled = true; };
  }, [period]);

  const masterByCode = useMemo(() => { const map = {}; master.forEach((mm) => (map[normCode(mm.code)] = mm)); return map; }, [master]);
  const kotakShare = (targets.kotakSharePct ?? 85) / 100;

  useEffect(() => {
    if (!summary?.hasData || todayRowsDate === summary.latestDate) return;
    let cancelled = false;
    (async () => {
      const rows = await apiGetCached(`/api/daily/${summary.latestDate}`);
      if (cancelled || !rows) return;
      setTodayRows(rows.map((r) => {
        const mm = masterByCode[normCode(r.code)];
        const netBrok = r.source === "KOTAK" ? r.netBrok * kotakShare : r.netBrok;
        return { ...r, netBrok, dealer: mm && mm.dealer ? mm.dealer : UNMAPPED, rm: mm ? mm.rm : "" };
      }));
      setTodayRowsDate(summary.latestDate);
    })();
    return () => { cancelled = true; };
  }, [summary, masterByCode, kotakShare, todayRowsDate]);

  // useSort (and everything it depends on) must run on every render, so it's
  // computed before the early returns below — conditionally skipping a hook
  // call between renders breaks React's Rules of Hooks.
  const todayRecs = todayRows || [];
  const todayFiltered = todayRecs.filter((r) => {
    if (!todaySearch) return true;
    const s = todaySearch.toLowerCase();
    return r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || (r.dealer || "").toLowerCase().includes(s) || (r.rm || "").toLowerCase().includes(s);
  });
  const { sorted: todaySorted, sortKey: todaySortKey, sortDir: todaySortDir, toggle: todayToggle } = useSort(todayFiltered, "netBrok", "desc");
  const todayGrandTotal = todayRecs.reduce((s, r) => s + r.netBrok, 0);

  if (summary === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <TasksSummaryCard isAdmin={isAdmin} />
        <Card style={{ padding: 50, textAlign: "center", color: INK_SOFT, fontSize: 13.5 }}>Loading dashboard…</Card>
      </div>
    );
  }
  if (!summary.hasData) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <TasksSummaryCard isAdmin={isAdmin} />
        <EmptyState icon={UploadCloud} title="No data uploaded yet" text="Head to Upload to add your first day's brokerage report — the dashboard fills in automatically." />
      </div>
    );
  }

  const { latestDate, prevDate, kpi, dealerRows, topClients, trend } = summary;
  const latestD = parseISO(latestDate);
  const y = latestD.getFullYear(), m = latestD.getMonth(), q = quarterOf(latestD);

  const monthlyTarget = kpi.monthlyTarget || 0;
  const monthPct = monthlyTarget > 0 ? (kpi.mtd / monthlyTarget) * 100 : null;
  const quarterPct = monthlyTarget > 0 ? (kpi.qtd / (monthlyTarget * 3)) * 100 : null;
  const yearPct = monthlyTarget > 0 ? (kpi.ytd / (monthlyTarget * 12)) * 100 : null;

  const unmapped = dealerRows.find((d) => d.dealer === UNMAPPED);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        <KPI label="Today" value={fmtINR(kpi.today)} sub={latestD.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} tone="blue" icon={Calendar} />
        <KPI
          label="Yesterday (T-1)"
          value={prevDate ? fmtINR(kpi.yesterday) : "—"}
          sub={prevDate ? parseISO(prevDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "No prior upload yet"}
          tone="ink"
          icon={Calendar}
        />
        <KPI label={`${MONTH_NAMES[m]} MTD`} value={fmtINR(kpi.mtd)} sub={monthPct !== null ? `${monthPct.toFixed(0)}% of ${fmtINR(monthlyTarget)} target` : "Set a target in the Targets tab"} tone={monthPct === null ? "violet" : monthPct >= 100 ? "emerald" : monthPct >= 60 ? "gold" : "red"} icon={TrendingUp} />
        <KPI label={`Q${q} QTD`} value={fmtINR(kpi.qtd)} sub={quarterPct !== null ? `${quarterPct.toFixed(0)}% of implied target` : "—"} tone={quarterPct === null ? "violet" : quarterPct >= 100 ? "emerald" : quarterPct >= 60 ? "gold" : "red"} icon={TrendingUp} />
        <KPI label={`${y} YTD`} value={fmtINR(kpi.ytd)} sub={yearPct !== null ? `${yearPct.toFixed(0)}% of implied target` : "—"} tone={yearPct === null ? "violet" : yearPct >= 100 ? "emerald" : yearPct >= 60 ? "gold" : "red"} icon={Building2} />
      </div>

      <TasksSummaryCard isAdmin={isAdmin} />

      {unmapped && unmapped.value !== 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: GOLD_SOFT, border: `1px dashed ${GOLD}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#7A5A14" }}>
          <AlertTriangle size={15} /> {fmtINR(unmapped.value)} of brokerage in this period belongs to clients with no dealer mapped yet — not a real dealer, just clients waiting to be assigned in Clients.
        </div>
      )}

      <Card style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <SectionTitle>Today's upload — client-wise breakdown ({latestD.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })})</SectionTitle>
          <div className="dt-search-wrap" style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input className="dt-search" placeholder="Search code, name, dealer, RM" value={todaySearch} onChange={(e) => setTodaySearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 240 }} />
          </div>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <SortHeader label="Code" active={todaySortKey === "code"} dir={todaySortDir} onClick={() => todayToggle("code")} />
                <SortHeader label="Name" active={todaySortKey === "name"} dir={todaySortDir} onClick={() => todayToggle("name")} />
                <SortHeader label="Dealer" active={todaySortKey === "dealer"} dir={todaySortDir} onClick={() => todayToggle("dealer")} />
                <SortHeader label="RM" active={todaySortKey === "rm"} dir={todaySortDir} onClick={() => todayToggle("rm")} />
                <SortHeader label="Net Brokerage" active={todaySortKey === "netBrok"} dir={todaySortDir} onClick={() => todayToggle("netBrok")} />
              </tr>
            </thead>
            <tbody>
              {todaySorted.map((r) => (
                <tr key={r.code}>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.code}</td>
                  <td>{r.name}</td>
                  <td>{r.dealer && r.dealer !== UNMAPPED ? <Badge text={r.dealer} color={dealerColor(r.dealer)} /> : <Badge text={UNMAPPED} color="#9AA1AC" />}</td>
                  <td style={{ color: INK_SOFT }}>{r.rm}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtFull(r.netBrok)}</td>
                </tr>
              ))}
              {todayRows === null && <tr><td colSpan={5} style={{ color: INK_SOFT, textAlign: "center", padding: 16 }}>Loading…</td></tr>}
              {todayRows !== null && todaySorted.length === 0 && <tr><td colSpan={5} style={{ color: INK_SOFT, textAlign: "center", padding: 16 }}>No matching rows.</td></tr>}
            </tbody>
            {todaySorted.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${LINE}` }}>
                  <td colSpan={4} style={{ fontWeight: 700, textAlign: "right", padding: "10px 12px" }}>Total ({todayRecs.length} clients)</td>
                  <td style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtFull(todayGrandTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 6 }}>
        {["day", "month", "quarter", "year"].map((p) => (
          <button key={p} onClick={() => setPeriod(p)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${period === p ? BLUE : LINE}`, background: period === p ? BLUE_SOFT : "#fff", color: period === p ? BLUE : INK_SOFT, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>
            {p === "day" ? "Today" : p}
          </button>
        ))}
      </div>

      <Card style={{ padding: 18 }}>
        <SectionTitle>Daily net brokerage — last 30 uploaded days</SectionTitle>
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={trend.map((t) => ({ date: parseISO(t.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), value: t.value }))} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
            <CartesianGrid stroke={LINE} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: INK_SOFT }} axisLine={{ stroke: LINE }} tickLine={false} />
            <YAxis tickFormatter={fmtINR} tick={{ fontSize: 11, fill: INK_SOFT }} axisLine={false} tickLine={false} width={60} />
            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12.5 }} />
            <Line type="monotone" dataKey="value" stroke={BLUE} strokeWidth={2.6} dot={{ r: 2.5 }} name="Net Brokerage" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="dt-chart-grid" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <Card style={{ padding: 18 }}>
          <SectionTitle>Dealer-wise net brokerage — after RM split ({period})</SectionTitle>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dealerRows} margin={{ top: 8, right: 12, left: -14, bottom: 20 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis dataKey="dealer" tick={{ fontSize: 11, fill: INK_SOFT }} angle={-25} textAnchor="end" interval={0} axisLine={{ stroke: LINE }} tickLine={false} />
              <YAxis tickFormatter={fmtINR} tick={{ fontSize: 11, fill: INK_SOFT }} axisLine={false} tickLine={false} width={60} />
              <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12.5 }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Net Brokerage">
                {dealerRows.map((d) => <Cell key={d.dealer} fill={d.dealer === UNMAPPED ? "#C9CDD4" : dealerColor(d.dealer)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card style={{ padding: 18 }}>
          <SectionTitle>Dealer share — after RM split ({period})</SectionTitle>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={dealerRows} dataKey="value" nameKey="dealer" innerRadius={55} outerRadius={95} paddingAngle={2}>
                {dealerRows.map((d) => <Cell key={d.dealer} fill={d.dealer === UNMAPPED ? "#C9CDD4" : dealerColor(d.dealer)} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12.5 }} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card style={{ padding: 18 }}>
        <SectionTitle>Top 10 clients by net brokerage ({period})</SectionTitle>
        {topClients.length === 0 ? (
          <div style={{ fontSize: 13.5, color: INK_SOFT, padding: "12px 4px" }}>No brokerage data for this period yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {topClients.map((c, i) => {
              const maxVal = topClients[0].value || 1;
              const pct = Math.max((c.value / maxVal) * 100, 2);
              return (
                <div key={c.code} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 2px", borderBottom: i < topClients.length - 1 ? `1px solid ${LINE}` : "none" }}>
                  <div style={{ width: 18, flex: "0 0 auto", fontSize: 12, fontWeight: 700, color: INK_SOFT, textAlign: "right" }}>{i + 1}</div>
                  <div
                    className="dt-tc-name"
                    title={c.name || c.code}
                    style={{ width: 150, flex: "0 0 150px", fontSize: 12.5, fontWeight: 600, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {c.name || c.code}
                  </div>
                  <div style={{ flex: "1 1 auto", minWidth: 0, height: 8, borderRadius: 999, background: TEAL_SOFT, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: TEAL }} />
                  </div>
                  <div style={{ flex: "0 0 auto", minWidth: 88, fontSize: 12.5, fontWeight: 700, color: INK, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtFull(c.value)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// Lists one client's underlying daily records (date, source, brokerage) —
// opened from a click on the client's name in the Clients tab or the Dealers
// tab's RM/Dealer split table.
function ClientTransactionsModal({ code, name, records, onClose }) {
  const sorted = [...records].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const total = sorted.reduce((s, r) => s + r.netBrok, 0);
  const sourceLabel = (s) => (s === "KOTAK" ? "Kotak" : s === "SW" ? "SW" : "—");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(14,20,32,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520 }}>
        <Card style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{name || code}</div>
              <div style={{ fontSize: 12, color: INK_SOFT }}>{code}</div>
            </div>
            <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: INK_SOFT }}><X size={18} /></button>
          </div>
          <div style={{ fontSize: 12.5, color: INK_SOFT, margin: "8px 0 12px" }}>{sorted.length} transaction{sorted.length === 1 ? "" : "s"}</div>
          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Date</th><th>Source</th><th>Brokerage</th></tr></thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={`${r.date}-${r.source}-${i}`}>
                    <td>{parseISO(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td>{sourceLabel(r.source)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtFull(r.netBrok)}</td>
                  </tr>
                ))}
                {sorted.length === 0 && <tr><td colSpan={3} style={{ color: INK_SOFT, textAlign: "center", padding: 16 }}>No transactions found for this client.</td></tr>}
              </tbody>
              {sorted.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${LINE}` }}>
                    <td colSpan={2} style={{ fontWeight: 700, textAlign: "right" }}>Total</td>
                    <td style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtFull(total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ClientsTab({ master, targets, latestDebitByCode, dealerNames, rmNames, isAdmin, onSave, showToast, onWipe }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("all");
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedClientRecords, setSelectedClientRecords] = useState([]);
  const [editingCode, setEditingCode] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ code: "", name: "", dealer: "", rm: "", branch: "" });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(null);
  const [brokerageByCode, setBrokerageByCode] = useState({});
  const bulkFileRef = useRef(null);
  const kotakShare = (targets.kotakSharePct ?? 85) / 100;

  // Same per-client aggregate the Dealers tab uses (bounded by client count,
  // not by transaction volume) — fetched here instead of reducing over every
  // DailyRecord the app has ever seen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGetCached(`/api/brokerage/by-client?period=${period}`);
      if (cancelled || !res) return;
      setBrokerageByCode(Object.fromEntries((res.rows || []).map((r) => [r.code, r.value])));
    })();
    return () => { cancelled = true; };
  }, [period]);

  useEffect(() => {
    if (!selectedClient) { setSelectedClientRecords([]); return; }
    let cancelled = false;
    (async () => {
      const rows = await apiGet(`/api/daily/client/${encodeURIComponent(selectedClient.code)}`);
      if (cancelled || !rows) return;
      setSelectedClientRecords(rows.map((r) => ({ ...r, netBrok: r.source === "KOTAK" ? r.netBrok * kotakShare : r.netBrok })));
    })();
    return () => { cancelled = true; };
  }, [selectedClient, kotakShare]);

  const rows = useMemo(() => master.map((m) => ({
    ...m,
    brokerage: brokerageByCode[normCode(m.code)] || 0,
    debit: latestDebitByCode[normCode(m.code)] || 0,
  })), [master, brokerageByCode, latestDebitByCode]);

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || (r.dealer || "").toLowerCase().includes(s) || (r.rm || "").toLowerCase().includes(s) || (r.branch || "").toLowerCase().includes(s);
  });

  const { sorted, sortKey, sortDir, toggle } = useSort(filtered, "brokerage", "desc");

  const startEdit = (r) => { setEditingCode(r.code); setEditDraft({ ...r }); };
  const saveEdit = () => {
    const next = master.map((m) => (m.code === editingCode ? { ...m, name: editDraft.name, dealer: editDraft.dealer, rm: editDraft.rm, branch: editDraft.branch } : m));
    onSave(next);
    setEditingCode(null);
  };
  const removeClient = (code) => onSave(master.filter((m) => m.code !== code));
  const addClient = () => {
    if (!draft.code) return;
    onSave(master.filter((m) => m.code !== draft.code).concat([draft]));
    setDraft({ code: "", name: "", dealer: "", rm: "", branch: "" });
    setAdding(false);
  };

  const onBulkFile = async (file) => {
    if (!file) return;
    const wb = await readWorkbook(file);
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
    const { records, error } = parseMasterSheet(rows);
    if (error) { showToast(error, "red"); return; }
    if (!records.length) { showToast("No client rows found in file", "red"); return; }
    setBulkPending({ records, fileName: file.name });
  };
  const confirmBulk = () => {
    if (!bulkPending) return;
    const byCode = {};
    master.forEach((m) => { byCode[normCode(m.code)] = m; });
    let updated = 0, created = 0;
    bulkPending.records.forEach((r) => {
      const key = normCode(r.code);
      if (byCode[key]) updated++; else created++;
      byCode[key] = { code: r.code, name: r.name, dealer: canonicalDealer(dealerNames, r.dealer), rm: canonicalRm(rmNames, r.rm), branch: r.branch };
    });
    onSave(Object.values(byCode));
    showToast(`Bulk upload: ${created} added, ${updated} updated`);
    setBulkPending(null);
    setBulkOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["month", "quarter", "year", "all"].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${period === p ? TEAL : LINE}`, background: period === p ? TEAL_SOFT : "#fff", color: period === p ? TEAL : INK_SOFT, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>
              {p === "all" ? "All time" : p}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="dt-search-wrap" style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input className="dt-search" placeholder="Search code, name, dealer, RM, branch" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 260 }} />
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setAdding((a) => !a)} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: "none", background: TEAL, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                <Plus size={15} /> Add client
              </button>
              <button onClick={() => { setBulkOpen((o) => !o); setBulkPending(null); }} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: `1px solid ${TEAL}`, background: bulkOpen ? TEAL_SOFT : "#fff", color: TEAL, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                <UploadCloud size={15} /> Bulk upload
              </button>
            </div>
          )}
        </div>
      </div>

      {adding && isAdmin && (
        <Card style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Client code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} style={inputStyle} />
            <input placeholder="Client name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} />
            <select value={draft.dealer} onChange={(e) => setDraft({ ...draft, dealer: e.target.value })} style={inputStyle}>
              <option value="">Select dealer</option>
              {dealerNames.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={draft.rm} onChange={(e) => setDraft({ ...draft, rm: e.target.value })} style={inputStyle}>
              <option value="">Select RM</option>
              {rmNames.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input placeholder="Branch" value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} style={inputStyle} />
            <button onClick={addClient} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: EMERALD, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save</button>
          </div>
        </Card>
      )}

      {bulkOpen && isAdmin && (
        <Card style={{ padding: 18 }}>
          <SectionTitle>Bulk upload clients</SectionTitle>
          <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
            Upload a .xlsx or .csv file with columns Client Code, Client Name, Dealer, RM, Branch. Existing codes are updated; new codes are added.
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onBulkFile(e.dataTransfer.files[0]); }}
            onClick={() => bulkFileRef.current?.click()}
            style={{ border: `2px dashed ${LINE}`, borderRadius: 12, padding: "24px 20px", textAlign: "center", cursor: "pointer", background: "#FAFBFC" }}
          >
            <FileSpreadsheet size={24} color={INK_SOFT} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Drop the .xlsx or .csv file here, or click to browse</div>
            <input ref={bulkFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => onBulkFile(e.target.files[0])} />
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => downloadCSV("clients_sample.csv", ["Client Code", "Client Name", "Dealer", "RM", "Branch"], [["100054", "Anto P.O", "Ravi Kumar", "Meera", "Kochi"], ["380026", "Abdu N", "Sana Patel", "Meera", "Kochi"]])}
              style={{ border: "none", background: "none", color: TEAL, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}
            >
              Download sample CSV template
            </button>
          </div>

          {bulkPending && (
            <div style={{ marginTop: 16, padding: 16, background: TEAL_SOFT, borderRadius: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13.5 }}>
                Parsed <strong>{bulkPending.fileName}</strong> — {bulkPending.records.length} client rows found.
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={confirmBulk} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: EMERALD, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save to client list</button>
                <button onClick={() => setBulkPending(null)} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK_SOFT, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card style={{ padding: 18 }}>
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <SortHeader label="Code" active={sortKey === "code"} dir={sortDir} onClick={() => toggle("code")} />
                <SortHeader label="Name" active={sortKey === "name"} dir={sortDir} onClick={() => toggle("name")} />
                <SortHeader label="Dealer" active={sortKey === "dealer"} dir={sortDir} onClick={() => toggle("dealer")} />
                <SortHeader label="RM" active={sortKey === "rm"} dir={sortDir} onClick={() => toggle("rm")} />
                <SortHeader label="Branch" active={sortKey === "branch"} dir={sortDir} onClick={() => toggle("branch")} />
                <SortHeader label="Brokerage" active={sortKey === "brokerage"} dir={sortDir} onClick={() => toggle("brokerage")} />
                <SortHeader label="Debit" active={sortKey === "debit"} dir={sortDir} onClick={() => toggle("debit")} />
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 500).map((r) => {
                const editing = editingCode === r.code;
                return (
                  <tr key={r.code}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.code}</td>
                    <td>
                      {editing ? (
                        <input value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} style={{ ...inputStyle, width: 140 }} />
                      ) : (
                        <button onClick={() => setSelectedClient({ code: r.code, name: r.name })} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: BLUE, fontWeight: 600, fontSize: 13, textAlign: "left" }}>
                          {r.name || r.code}
                        </button>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select value={editDraft.dealer} onChange={(e) => setEditDraft({ ...editDraft, dealer: e.target.value })} style={{ ...inputStyle, width: 130 }}>
                          <option value="">—</option>
                          {dealerNames.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      ) : r.dealer ? <Badge text={r.dealer} color={dealerColor(r.dealer)} /> : <Badge text={UNMAPPED} color="#9AA1AC" />}
                    </td>
                    <td>
                      {editing ? (
                        <select value={editDraft.rm} onChange={(e) => setEditDraft({ ...editDraft, rm: e.target.value })} style={{ ...inputStyle, width: 110 }}>
                          <option value="">—</option>
                          {rmNames.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : <span style={{ color: INK_SOFT }}>{r.rm}</span>}
                    </td>
                    <td>{editing ? <input value={editDraft.branch} onChange={(e) => setEditDraft({ ...editDraft, branch: e.target.value })} style={{ ...inputStyle, width: 110 }} /> : <span style={{ color: INK_SOFT }}>{r.branch}</span>}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtFull(r.brokerage)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: r.debit > 0 ? RED : INK_SOFT }}>{r.debit ? fmtFull(r.debit) : "—"}</td>
                    {isAdmin && (
                      <td>
                        {editing ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={saveEdit} style={{ border: "none", background: "none", cursor: "pointer", color: EMERALD }}><Check size={15} /></button>
                            <button onClick={() => setEditingCode(null)} style={{ border: "none", background: "none", cursor: "pointer", color: INK_SOFT }}><X size={15} /></button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => startEdit(r)} style={{ border: "none", background: "none", cursor: "pointer", color: BLUE }}><Pencil size={14} /></button>
                            <button onClick={() => removeClient(r.code)} style={{ border: "none", background: "none", cursor: "pointer", color: RED }}><Trash2 size={14} /></button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.length > 500 && <div style={{ fontSize: 12, color: INK_SOFT, padding: 8 }}>Showing first 500 of {sorted.length} — refine your search.</div>}
          {master.length === 0 && <div style={{ fontSize: 13.5, color: INK_SOFT, padding: 12 }}>No clients yet — add one above.</div>}
        </div>
      </Card>

      {isAdmin && master.length > 0 && (
        <DangerZone
          title="Remove all clients"
          description={`Permanently deletes all ${master.length} client(s) from the client list. Daily brokerage and debit uploads are kept but will show as Unmapped.`}
          confirmWord="DELETE"
          onConfirm={onWipe}
        />
      )}

      {selectedClient && (
        <ClientTransactionsModal
          code={selectedClient.code}
          name={selectedClient.name}
          records={selectedClientRecords}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  );
}

function DealersTab({ master, dealerNames, targets, latestDebitByCode, isAdmin, onRename, onRemove, onAdd, onAddBulk, onSaveTargets, onWipe, showToast }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("all");
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedClientRecords, setSelectedClientRecords] = useState([]);
  const [newDealer, setNewDealer] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [targetDrafts, setTargetDrafts] = useState({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [brokerageByClient, setBrokerageByClient] = useState({});
  const inputRef = useRef(null);
  const bulkFileRef = useRef(null);
  const kotakShare = (targets.kotakSharePct ?? 85) / 100;

  // The one aggregate everything below (dealer totals, the split table, the
  // per-dealer export) reduces through — fetched per period instead of
  // reducing over every DailyRecord the app has ever seen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGetCached(`/api/brokerage/by-client?period=${period}`);
      if (cancelled || !res) return;
      setBrokerageByClient(Object.fromEntries((res.rows || []).map((r) => [r.code, r.value])));
    })();
    return () => { cancelled = true; };
  }, [period]);

  useEffect(() => {
    if (!selectedClient) { setSelectedClientRecords([]); return; }
    let cancelled = false;
    (async () => {
      const rows = await apiGet(`/api/daily/client/${encodeURIComponent(selectedClient.code)}`);
      if (cancelled || !rows) return;
      setSelectedClientRecords(rows.map((r) => ({ ...r, netBrok: r.source === "KOTAK" ? r.netBrok * kotakShare : r.netBrok })));
    })();
    return () => { cancelled = true; };
  }, [selectedClient, kotakShare]);

  const submitNewDealer = () => { onAdd(newDealer.trim()); setNewDealer(""); };

  const onBulkFile = async (file) => {
    if (!file) return;
    const wb = await readWorkbook(file);
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
    const dataRows = rows.length && normHeader(rows[0]?.[0]).includes("dealer") ? rows.slice(1) : rows;
    const names = dataRows
      .map((row) => String((row && row[0]) ?? "").trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (!names.length) { showToast("No dealer names found in file", "red"); return; }
    await onAddBulk(names);
    setBulkOpen(false);
  };

  const rmSplitPct = targets.rmSplitPct ?? 50;
  // Total = undivided brokerage attributed to the dealer (unchanged, drives the
  // monthly target progress bar). Net = the dealer's own share after subtracting
  // whatever the mapped RM takes per splitShares() — the same split used in the
  // RM/Dealer split table below. Both are grouped from brokerageByClient (fetched
  // above, already period-filtered) via master — sum is associative, so grouping
  // per-client totals by dealer gives the identical result to summing every raw
  // record by dealer, at a fraction of the data volume.
  const brokerageByDealer = useMemo(() => {
    const map = {};
    master.forEach((mm) => {
      if (!mm.dealer) return;
      map[mm.dealer] = (map[mm.dealer] || 0) + (brokerageByClient[normCode(mm.code)] || 0);
    });
    return map;
  }, [master, brokerageByClient]);

  const netBrokerageByDealer = useMemo(() => {
    const map = {};
    master.forEach((mm) => {
      if (!mm.dealer) return;
      const brokerage = brokerageByClient[normCode(mm.code)] || 0;
      const { dealerPct } = splitShares(mm.dealer, mm.rm, rmSplitPct);
      map[mm.dealer] = (map[mm.dealer] || 0) + (brokerage * dealerPct) / 100;
    });
    return map;
  }, [master, brokerageByClient, rmSplitPct]);

  const clientCount = useMemo(() => {
    const c = {};
    master.forEach((m) => { if (m.dealer) c[m.dealer] = (c[m.dealer] || 0) + 1; });
    return c;
  }, [master]);

  const rows = dealerNames.filter((d) => !search || d.toLowerCase().includes(search.toLowerCase())).map((d) => ({
    dealer: d, clients: clientCount[d] || 0, brokerage: brokerageByDealer[d] || 0, netBrokerage: netBrokerageByDealer[d] || 0, target: targets.dealerMonthly?.[d] || 0,
  })).sort((a, b) => b.brokerage - a.brokerage);

  const saveTarget = (dealer) => {
    const v = Number(targetDrafts[dealer]);
    onSaveTargets({ ...targets, dealerMonthly: { ...targets.dealerMonthly, [dealer]: isNaN(v) ? 0 : v } });
  };

  const [splitSearch, setSplitSearch] = useState("");

  // Exports every client mapped to one dealer as an .xlsx, honoring the
  // currently selected period so the file matches what's on screen.
  const exportDealerClients = (dealerName) => {
    const rows = master
      .filter((mm) => mm.dealer === dealerName)
      .map((mm) => {
        const brokerage = brokerageByClient[normCode(mm.code)] || 0;
        const { dealerPct, rmPct } = splitShares(mm.dealer, mm.rm, rmSplitPct);
        return {
          "Client Code": mm.code,
          "Client Name": mm.name,
          "RM": mm.rm || "",
          "Branch": mm.branch || "",
          "Debit Balance": latestDebitByCode?.[normCode(mm.code)] || 0,
          "Total Brokerage": Math.round(brokerage * 100) / 100,
          "Dealer Share": Math.round(((brokerage * dealerPct) / 100) * 100) / 100,
          "RM Share": Math.round(((brokerage * rmPct) / 100) * 100) / 100,
        };
      })
      .sort((a, b) => b["Total Brokerage"] - a["Total Brokerage"]);
    if (!rows.length) { showToast(`No clients found for ${dealerName}`, "gold"); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, dealerName.slice(0, 31) || "Clients");
    const safeName = dealerName.replace(/[^a-z0-9]+/gi, "_");
    XLSX.writeFile(wb, `${safeName}_clients_${period}.xlsx`);
    showToast(`Exported ${rows.length} client(s) for ${dealerName}`);
  };

  // Split table: one row per client mapped to a dealer and/or RM, showing how
  // their period brokerage divides between the two per splitShares().
  const splitRows = useMemo(() => {
    return master
      .filter((mm) => mm.dealer || mm.rm)
      .map((mm) => {
        const brokerage = brokerageByClient[normCode(mm.code)] || 0;
        const { dealerPct, rmPct, samePerson } = splitShares(mm.dealer, mm.rm, rmSplitPct);
        return {
          code: mm.code, name: mm.name, dealer: mm.dealer || UNMAPPED, rm: mm.rm || "",
          brokerage, dealerShare: (brokerage * dealerPct) / 100, rmShare: (brokerage * rmPct) / 100,
          dealerPct, rmPct, samePerson,
        };
      })
      .filter((r) => {
        if (!splitSearch) return true;
        const s = splitSearch.toLowerCase();
        return r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || r.dealer.toLowerCase().includes(s) || r.rm.toLowerCase().includes(s);
      })
      .sort((a, b) => b.brokerage - a.brokerage);
  }, [master, brokerageByClient, rmSplitPct, splitSearch]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["month", "quarter", "year", "all"].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${period === p ? VIOLET : LINE}`, background: period === p ? VIOLET_SOFT : "#fff", color: period === p ? VIOLET : INK_SOFT, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>
              {p === "all" ? "All time" : p}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="dt-search-wrap" style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input className="dt-search" placeholder="Search dealer" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 200 }} />
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input
                ref={inputRef}
                placeholder="New dealer name"
                value={newDealer}
                onChange={(e) => setNewDealer(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitNewDealer(); }}
                style={inputStyle}
              />
              <button onClick={submitNewDealer} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: "none", background: VIOLET, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                <Plus size={15} /> Add dealer
              </button>
              <button onClick={() => setBulkOpen((o) => !o)} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: `1px solid ${VIOLET}`, background: bulkOpen ? VIOLET_SOFT : "#fff", color: VIOLET, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                <UploadCloud size={15} /> Bulk upload
              </button>
            </div>
          )}
        </div>
      </div>

      {isAdmin && bulkOpen && (
        <Card style={{ padding: 18 }}>
          <SectionTitle>Bulk upload dealers</SectionTitle>
          <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
            Upload a .xlsx or .csv file with one dealer name per row in the first column. Duplicates and blank rows are skipped automatically.
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onBulkFile(e.dataTransfer.files[0]); }}
            onClick={() => bulkFileRef.current?.click()}
            style={{ border: `2px dashed ${LINE}`, borderRadius: 12, padding: "24px 20px", textAlign: "center", cursor: "pointer", background: "#FAFBFC" }}
          >
            <FileSpreadsheet size={24} color={INK_SOFT} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Drop the .xlsx or .csv file here, or click to browse</div>
            <input ref={bulkFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => onBulkFile(e.target.files[0])} />
          </div>
          <div style={{ marginTop: 10 }}>
            <button onClick={() => downloadCSV("dealers_sample.csv", ["Dealer Name"], [["Ravi Kumar"], ["Sana Patel"]])} style={{ border: "none", background: "none", color: VIOLET, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              Download sample CSV template
            </button>
          </div>
        </Card>
      )}

      <Card style={{ padding: 18 }}>
        <SectionTitle>Dealer performance ({period})</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Dealer</th><th>Clients</th><th>Total Brokerage</th><th>Net Brokerage</th><th>Monthly Target</th><th style={{ width: 150 }}>Progress</th><th></th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const monthPct = targets.dealerMonthly?.[r.dealer] > 0 && period === "month" ? ((brokerageByDealer[r.dealer] || 0) / targets.dealerMonthly[r.dealer]) * 100 : null;
                return (
                  <tr key={r.dealer}>
                    <td>
                      {editing === r.dealer ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, width: 140 }} />
                          <button onClick={() => { onRename(r.dealer, editName.trim()); setEditing(null); }} style={{ border: "none", background: "none", cursor: "pointer", color: EMERALD }}><Check size={15} /></button>
                          <button onClick={() => setEditing(null)} style={{ border: "none", background: "none", cursor: "pointer", color: INK_SOFT }}><X size={15} /></button>
                        </div>
                      ) : <Badge text={r.dealer} color={dealerColor(r.dealer)} />}
                    </td>
                    <td>{r.clients}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtFull(r.brokerage)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtFull(r.netBrokerage)}</td>
                    <td>
                      {isAdmin ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="number" placeholder="0" defaultValue={r.target || ""} onChange={(e) => setTargetDrafts({ ...targetDrafts, [r.dealer]: e.target.value })} style={{ ...inputStyle, width: 100 }} />
                          <button onClick={() => saveTarget(r.dealer)} style={{ border: "none", background: "none", cursor: "pointer", color: BLUE, fontSize: 11.5, fontWeight: 700 }}>Save</button>
                        </div>
                      ) : (r.target ? fmtFull(r.target) : "—")}
                    </td>
                    <td>{monthPct !== null ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1 }}><ProgressBar pct={monthPct} /></div><span style={{ fontSize: 11.5, color: INK_SOFT, width: 34 }}>{monthPct.toFixed(0)}%</span></div> : <span style={{ color: "#B7BCC5", fontSize: 12 }}>{period === "month" ? "no target" : "monthly only"}</span>}</td>
                    <td>
                      <button onClick={() => exportDealerClients(r.dealer)} title={`Export ${r.dealer}'s clients`} style={{ display: "flex", gap: 5, alignItems: "center", border: `1px solid ${VIOLET}`, background: "#fff", color: VIOLET, borderRadius: 7, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                        <Download size={13} /> Export
                      </button>
                    </td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => { setEditing(r.dealer); setEditName(r.dealer); }} style={{ border: "none", background: "none", cursor: "pointer", color: BLUE }}><Pencil size={14} /></button>
                          <button onClick={() => onRemove(r.dealer)} style={{ border: "none", background: "none", cursor: "pointer", color: RED }}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={isAdmin ? 8 : 7} style={{ color: INK_SOFT, textAlign: "center", padding: 20 }}>No dealers yet — add one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <SectionTitle>RM / Dealer split ({period})</SectionTitle>
          <div className="dt-search-wrap" style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input className="dt-search" placeholder="Search client, dealer, RM" value={splitSearch} onChange={(e) => setSplitSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 220 }} />
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
          Clients mapped to both a dealer and an RM split {100 - rmSplitPct}/{rmSplitPct} (dealer/RM). If the RM and dealer are the same person, the dealer keeps 100%. Adjust the split in the Targets tab.
        </div>
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table>
            <thead><tr><th>Client</th><th>Dealer</th><th>RM</th><th>Net Brokerage</th><th>Split</th><th>Dealer Share</th><th>RM Share</th></tr></thead>
            <tbody>
              {splitRows.slice(0, 500).map((r) => (
                <tr key={r.code}>
                  <td>
                    <button onClick={() => setSelectedClient({ code: r.code, name: r.name })} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                      <div style={{ fontWeight: 600, color: BLUE }}>{r.name || r.code}</div>
                      <div style={{ fontSize: 11, color: INK_SOFT }}>{r.code}</div>
                    </button>
                  </td>
                  <td>{r.dealer && r.dealer !== UNMAPPED ? <Badge text={r.dealer} color={dealerColor(r.dealer)} /> : <Badge text={UNMAPPED} color="#9AA1AC" />}</td>
                  <td style={{ color: INK_SOFT }}>{r.rm || "—"}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtFull(r.brokerage)}</td>
                  <td style={{ fontSize: 12, color: INK_SOFT }}>
                    {r.samePerson ? "100% (same person)" : `${r.dealerPct}% / ${r.rmPct}%`}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.dealerShare)}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.rmShare)}</td>
                </tr>
              ))}
              {splitRows.length === 0 && <tr><td colSpan={7} style={{ color: INK_SOFT, textAlign: "center", padding: 20 }}>No clients mapped to a dealer or RM yet.</td></tr>}
            </tbody>
          </table>
          {splitRows.length > 500 && <div style={{ fontSize: 12, color: INK_SOFT, padding: 8 }}>Showing first 500 of {splitRows.length} — refine your search.</div>}
        </div>
      </Card>

      {isAdmin && dealerNames.length > 0 && (
        <DangerZone
          title="Remove all dealers"
          description={`Permanently deletes all ${dealerNames.length} dealer(s) and their monthly targets. Clients currently assigned to a dealer become Unmapped instead of being deleted.`}
          confirmWord="DELETE"
          onConfirm={onWipe}
        />
      )}

      {selectedClient && (
        <ClientTransactionsModal
          code={selectedClient.code}
          name={selectedClient.name}
          records={selectedClientRecords}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  );
}

function RmsTab({ master, rmNames, isAdmin, onRename, onRemove, onAdd, onAddBulk, onWipe, showToast }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("all");
  const [netBrokerageByRm, setNetBrokerageByRm] = useState({});
  const [newRm, setNewRm] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const inputRef = useRef(null);
  const bulkFileRef = useRef(null);

  const submitNewRm = () => { onAdd(newRm.trim()); setNewRm(""); };

  const onBulkFile = async (file) => {
    if (!file) return;
    const wb = await readWorkbook(file);
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
    const dataRows = rows.length && normHeader(rows[0]?.[0]).includes("rm") ? rows.slice(1) : rows;
    const names = dataRows
      .map((row) => String((row && row[0]) ?? "").trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (!names.length) { showToast("No RM names found in file", "red"); return; }
    await onAddBulk(names);
    setBulkOpen(false);
  };

  // Each RM's Net Brokerage is their share of every client mapped to them,
  // via the same splitShares() math as the Dealers tab's split table —
  // computed server-side in Postgres instead of reducing over every
  // DailyRecord the app has ever seen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGetCached(`/api/rms/summary?period=${period}`);
      if (cancelled || !res) return;
      setNetBrokerageByRm(Object.fromEntries((res.rows || []).map((r) => [r.rm, r.netBrokerage])));
    })();
    return () => { cancelled = true; };
  }, [period]);

  const clientCount = useMemo(() => {
    const c = {};
    master.forEach((mm) => { if (mm.rm) c[mm.rm] = (c[mm.rm] || 0) + 1; });
    return c;
  }, [master]);

  const rows = rmNames.filter((r) => !search || r.toLowerCase().includes(search.toLowerCase())).map((r) => ({
    rm: r, clients: clientCount[r] || 0, netBrokerage: netBrokerageByRm[r] || 0,
  })).sort((a, b) => b.netBrokerage - a.netBrokerage);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["month", "quarter", "year", "all"].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${period === p ? ROSE : LINE}`, background: period === p ? ROSE_SOFT : "#fff", color: period === p ? ROSE : INK_SOFT, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>
              {p === "all" ? "All time" : p}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="dt-search-wrap" style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input className="dt-search" placeholder="Search RM" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 200 }} />
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input
                ref={inputRef}
                placeholder="New RM name"
                value={newRm}
                onChange={(e) => setNewRm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitNewRm(); }}
                style={inputStyle}
              />
              <button onClick={submitNewRm} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: "none", background: ROSE, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                <Plus size={15} /> Add RM
              </button>
              <button onClick={() => setBulkOpen((o) => !o)} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: `1px solid ${ROSE}`, background: bulkOpen ? ROSE_SOFT : "#fff", color: ROSE, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                <UploadCloud size={15} /> Bulk upload
              </button>
            </div>
          )}
        </div>
      </div>

      {isAdmin && bulkOpen && (
        <Card style={{ padding: 18 }}>
          <SectionTitle>Bulk upload RMs</SectionTitle>
          <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
            Upload a .xlsx or .csv file with one RM name per row in the first column. Duplicates and blank rows are skipped automatically.
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onBulkFile(e.dataTransfer.files[0]); }}
            onClick={() => bulkFileRef.current?.click()}
            style={{ border: `2px dashed ${LINE}`, borderRadius: 12, padding: "24px 20px", textAlign: "center", cursor: "pointer", background: "#FAFBFC" }}
          >
            <FileSpreadsheet size={24} color={INK_SOFT} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Drop the .xlsx or .csv file here, or click to browse</div>
            <input ref={bulkFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => onBulkFile(e.target.files[0])} />
          </div>
          <div style={{ marginTop: 10 }}>
            <button onClick={() => downloadCSV("rms_sample.csv", ["RM Name"], [["Meera"], ["Sana Patel"]])} style={{ border: "none", background: "none", color: ROSE, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              Download sample CSV template
            </button>
          </div>
        </Card>
      )}

      <Card style={{ padding: 18 }}>
        <SectionTitle>RM performance ({period})</SectionTitle>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
          Net Brokerage is each RM's share of their mapped clients' brokerage, per the RM/Dealer split configured in the Targets tab.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>RM</th><th>Clients</th><th>Net Brokerage</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rm}>
                  <td>
                    {editing === r.rm ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, width: 140 }} />
                        <button onClick={() => { onRename(r.rm, editName.trim()); setEditing(null); }} style={{ border: "none", background: "none", cursor: "pointer", color: EMERALD }}><Check size={15} /></button>
                        <button onClick={() => setEditing(null)} style={{ border: "none", background: "none", cursor: "pointer", color: INK_SOFT }}><X size={15} /></button>
                      </div>
                    ) : <Badge text={r.rm} color={dealerColor(r.rm)} />}
                  </td>
                  <td>{r.clients}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtFull(r.netBrokerage)}</td>
                  {isAdmin && (
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => { setEditing(r.rm); setEditName(r.rm); }} style={{ border: "none", background: "none", cursor: "pointer", color: BLUE }}><Pencil size={14} /></button>
                        <button onClick={() => onRemove(r.rm)} style={{ border: "none", background: "none", cursor: "pointer", color: RED }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} style={{ color: INK_SOFT, textAlign: "center", padding: 20 }}>No RMs yet — add one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {isAdmin && rmNames.length > 0 && (
        <DangerZone
          title="Remove all RMs"
          description={`Permanently deletes all ${rmNames.length} RM(s). Clients currently assigned to an RM become unmapped instead of being deleted.`}
          confirmWord="DELETE"
          onConfirm={onWipe}
        />
      )}
    </div>
  );
}

function UploadTab({ dailyDates, dailyData, debitDates, debitData, masterByCode, onSaveDaily, onDeleteDaily, onSaveDebit, onDeleteDebit, showToast, kotakSharePct }) {
  const [sub, setSub] = useState("brokerage");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => setSub("brokerage")} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${sub === "brokerage" ? GOLD : LINE}`, background: sub === "brokerage" ? GOLD_SOFT : "#fff", color: sub === "brokerage" ? GOLD : INK_SOFT, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", gap: 7, alignItems: "center" }}>
          <IndianRupee size={14} /> Daily Brokerage
        </button>
        <button onClick={() => setSub("debit")} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${sub === "debit" ? RED : LINE}`, background: sub === "debit" ? RED_SOFT : "#fff", color: sub === "debit" ? RED : INK_SOFT, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", gap: 7, alignItems: "center" }}>
          <ReceiptText size={14} /> Debit Report
        </button>
      </div>
      {sub === "brokerage" ? (
        <UploadPane
          title="Upload today's brokerage report" accent={GOLD} accentSoft={GOLD_SOFT}
          helperText="Needs just three columns: Client Code, Client Name, Net Brokerage — dealer is matched automatically."
          sampleName="daily_brokerage_sample.csv" sampleHeader={["Client Code", "Client Name", "Net Brokerage"]}
          sampleRows={[["100054", "Anto P.O", "478.21"], ["380026", "Abdu N", "86.70"]]}
          parseFn={parseDailySheet} dates={dailyDates} data={dailyData} onSave={onSaveDaily} onDelete={onDeleteDaily}
          valueKey="netBrok" valueLabel="Net Brokerage" masterByCode={masterByCode} showToast={showToast}
          hasSource kotakSharePct={kotakSharePct}
        />
      ) : (
        <UploadPane
          title="Upload client debit / outstanding report" accent={RED} accentSoft={RED_SOFT}
          helperText="Needs: Client Code, Client Name, Debit (outstanding balance) — shown against each client in the Clients tab."
          sampleName="debit_report_sample.csv" sampleHeader={["Client Code", "Client Name", "Debit"]}
          sampleRows={[["100054", "Anto P.O", "12500"], ["380026", "Abdu N", "0"]]}
          parseFn={parseDebitSheet} dates={debitDates} data={debitData} onSave={onSaveDebit} onDelete={onDeleteDebit}
          valueKey="debit" valueLabel="Total Debit" masterByCode={masterByCode} showToast={showToast}
        />
      )}
    </div>
  );
}

// Detects "SW" / "KOTAK" from a filename, requiring a non-letter boundary so short
// tokens like "sw" don't false-positive inside unrelated words (e.g. "answers.xlsx").
function detectSourceFromFilename(filename) {
  const base = String(filename || "").toLowerCase();
  if (/(^|[^a-z0-9])kotak([^a-z0-9]|$)/.test(base)) return "KOTAK";
  if (/(^|[^a-z0-9])sw([^a-z0-9]|$)/.test(base)) return "SW";
  return null;
}

function UploadPane({ title, accent, accentSoft, helperText, sampleName, sampleHeader, sampleRows, parseFn, dates, data, onSave, onDelete, valueKey, valueLabel, masterByCode, showToast, hasSource, kotakSharePct = 85 }) {
  const [pending, setPending] = useState(null);
  const [dateInput, setDateInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [source, setSource] = useState("SW");
  const inputRef = useRef(null);
  const kotakShare = kotakSharePct / 100;

  // Records are always stored raw (as uploaded) — the Kotak share is applied
  // at read time everywhere, so this total is for display/preview only.
  const shareAdjusted = (r) => (r.source === "KOTAK" ? r[valueKey] * kotakShare : r[valueKey]);

  const onFile = async (file) => {
    if (!file) return;
    const wb = await readWorkbook(file);
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
    const { records: rawRecords, error } = parseFn(rows);
    if (error) { showToast(error, "red"); return; }

    const detected = hasSource ? detectSourceFromFilename(file.name) : null;
    const effectiveSource = hasSource ? (detected || source) : null;
    if (hasSource && detected && detected !== source) setSource(detected);

    const records = hasSource ? rawRecords.map((r) => ({ ...r, source: effectiveSource })) : rawRecords;
    const guessDate = guessDateFromFilename(sheetName.match(/\d{6,8}/) ? sheetName : file.name);
    setPending({ records, count: records.length, total: records.reduce((s, r) => s + shareAdjusted(r), 0), fileName: file.name, source: effectiveSource });
    setDateInput(isoDate(guessDate));
  };

  // SW and Kotak reports for the same date coexist (a save only replaces its own
  // source's rows) — so block only a same-source re-import, which would silently
  // replace that source's rows a second time.
  const existingForDate = dateInput ? data[dateInput] : null;
  const existingSources = new Set((existingForDate || []).map((r) => r.source || ""));
  const isDuplicateSource = hasSource && !!pending && !!pending.source && existingSources.has(pending.source);
  const otherExistingSource = hasSource && pending
    ? [...existingSources].find((s) => s && s !== pending.source)
    : null;

  const confirmSave = async () => {
    if (!pending || !dateInput || isDuplicateSource) return;
    await onSave(dateInput, pending.records);
    setPending(null);
  };

  // One row per date when there's no source concept (Debit); one row per
  // date+source when there is (Daily Brokerage), so SW and Kotak show separately.
  const sortedDates = [...dates].sort().reverse();
  const reportRows = hasSource
    ? sortedDates.flatMap((d) => {
        const bySource = new Map();
        for (const r of data[d] || []) {
          const key = r.source || "—";
          if (!bySource.has(key)) bySource.set(key, []);
          bySource.get(key).push(r);
        }
        const order = ["SW", "KOTAK", "—"];
        return [...bySource.keys()]
          .sort((a, b) => order.indexOf(a) - order.indexOf(b))
          .map((src) => ({ date: d, source: src, records: bySource.get(src) }));
      })
    : sortedDates.map((d) => ({ date: d, source: undefined, records: data[d] || [] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card style={{ padding: 22 }}>
        <SectionTitle>{title}</SectionTitle>
        {hasSource && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 600 }}>Source:</span>
            <div style={{ display: "flex", gap: 6 }}>
              {["SW", "KOTAK"].map((s) => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  style={{
                    padding: "6px 14px", borderRadius: 8, border: `1px solid ${source === s ? accent : LINE}`,
                    background: source === s ? accentSoft : "#fff", color: source === s ? accent : INK_SOFT,
                    fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {s === "KOTAK" ? "Kotak" : "SW"}
                </button>
              ))}
            </div>
            {source === "KOTAK" && (
              <span style={{ fontSize: 12, color: GOLD }}>Shown at the {kotakSharePct}% Kotak share (set in Targets) — the raw figure is what's saved.</span>
            )}
          </div>
        )}
        <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files[0]); }}
          onClick={() => inputRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? accent : LINE}`, borderRadius: 12, padding: "34px 20px", textAlign: "center", cursor: "pointer", background: dragOver ? accentSoft : "#FAFBFC" }}>
          <FileSpreadsheet size={28} color={INK_SOFT} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Drop the .xlsx or .csv file here, or click to browse</div>
          <div style={{ fontSize: 12.5, color: INK_SOFT }}>{helperText}</div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
        </div>
        <div style={{ marginTop: 10 }}>
          <button onClick={() => downloadCSV(sampleName, sampleHeader, sampleRows)} style={{ border: "none", background: "none", color: accent, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            Download sample CSV template
          </button>
        </div>

        {pending && (
          <div style={{ marginTop: 16, padding: 16, background: accentSoft, borderRadius: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13.5 }}>
              Parsed <strong>{pending.fileName}</strong> — {pending.count} clients, total {valueLabel.toLowerCase()} <strong>{fmtFull(pending.total)}</strong>
              {hasSource && source === "KOTAK" && <span style={{ color: GOLD }}> (shown at {kotakSharePct}% Kotak share)</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12.5, color: INK_SOFT }}>Report date:</label>
              <input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${LINE}` }} />
              <button onClick={confirmSave} disabled={isDuplicateSource} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: isDuplicateSource ? "#C9CDD4" : EMERALD, color: "#fff", fontWeight: 700, fontSize: 13, cursor: isDuplicateSource ? "not-allowed" : "pointer" }}>Save to dashboard</button>
              <button onClick={() => setPending(null)} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK_SOFT, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              {isDuplicateSource ? (
                <span style={{ fontSize: 12, color: RED, fontWeight: 700 }}>
                  A {pending.source === "KOTAK" ? "Kotak" : "SW"} report for this date is already saved — re-importing the same source is blocked. Delete the existing report first if you need to replace it.
                </span>
              ) : otherExistingSource && (
                <span style={{ fontSize: 12, color: INK_SOFT }}>
                  This date already has a {otherExistingSource === "KOTAK" ? "Kotak" : otherExistingSource === "SW" ? "SW" : "previously saved"} report — it will be kept, and this {pending.source === "KOTAK" ? "Kotak" : "SW"} report will be saved alongside it.
                </span>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card style={{ padding: 18 }}>
        <SectionTitle>Uploaded reports ({reportRows.length})</SectionTitle>
        {reportRows.length === 0 ? <div style={{ fontSize: 13.5, color: INK_SOFT }}>Nothing uploaded yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Date</th>{hasSource && <th>Source</th>}<th>Clients</th><th>{valueLabel}</th><th>Unmapped</th><th></th></tr></thead>
              <tbody>
                {reportRows.map((row) => {
                  const total = row.records.reduce((s, r) => s + shareAdjusted(r), 0);
                  const unmapped = row.records.filter((r) => !masterByCode[normCode(r.code)]).length;
                  const srcLabel = row.source === "KOTAK" ? "Kotak" : row.source === "SW" ? "SW" : "Unknown";
                  return (
                    <tr key={`${row.date}-${row.source ?? ""}`}>
                      <td style={{ fontWeight: 600 }}>{parseISO(row.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      {hasSource && (
                        <td>
                          <span style={{
                            fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                            background: row.source === "KOTAK" ? GOLD_SOFT : row.source === "SW" ? accentSoft : "#EEE",
                            color: row.source === "KOTAK" ? GOLD : row.source === "SW" ? accent : INK_SOFT,
                          }}>
                            {srcLabel}
                          </span>
                        </td>
                      )}
                      <td>{row.records.length}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(total)}</td>
                      <td>{unmapped > 0 ? <span style={{ color: GOLD, fontWeight: 700 }}>{unmapped}</span> : <span style={{ color: EMERALD }}>0</span>}</td>
                      <td><button onClick={() => onDelete(row.date, hasSource ? (row.source === "—" ? "" : row.source) : undefined)} title="Remove this report" style={{ border: "none", background: "none", cursor: "pointer", color: RED, display: "flex", alignItems: "center" }}><Trash2 size={15} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function UsersSection({ onWipeUsers, showToast }) {
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newRole, setNewRole] = useState("VIEWER");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [reveal, setReveal] = useState(null); // { username, tempPassword }

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users", { credentials: "same-origin" });
      setUsers(res.ok ? await res.json() : []);
    } catch (e) {
      setUsers([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleWipe = async () => {
    await onWipeUsers();
    load();
  };

  const submitNewUser = async () => {
    setCreateError("");
    if (!newUsername.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), role: newRole }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCreateError(data?.error || "Couldn't create user");
        return;
      }
      setReveal({ username: data.username, tempPassword: data.tempPassword });
      setNewUsername("");
      setNewRole("VIEWER");
      setAdding(false);
      load();
    } catch (e) {
      setCreateError("Couldn't create user");
    } finally {
      setCreating(false);
    }
  };

  const copyTempPassword = async () => {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.tempPassword);
      showToast("Password copied to clipboard");
    } catch (e) {
      // clipboard API unavailable — password is still visible to copy manually
    }
  };

  const [resettingId, setResettingId] = useState(null);
  const resetPassword = async (u) => {
    setResettingId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "PATCH", credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) { showToast(data?.error || "Couldn't reset password", "red"); return; }
      setReveal({ username: data.username, tempPassword: data.tempPassword, reset: true });
      load();
    } finally {
      setResettingId(null);
    }
  };

  const otherUserCount = (users || []).length > 0 ? users.length - 1 : 0;

  return (
    <>
      {reveal && (
        <Card style={{ padding: 18, border: `1px solid ${GOLD}`, background: GOLD_SOFT }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#7A5A14", marginBottom: 4 }}>
                {reveal.reset ? "Password reset for " : "Account created for "}<strong>{reveal.username}</strong>
              </div>
              <div style={{ fontSize: 12.5, color: "#7A5A14", marginBottom: 10 }}>
                Share this temporary password with them now — it won't be shown again. They'll be required to set their own password the next time they sign in.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ background: "#fff", border: `1px solid ${GOLD}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, fontWeight: 700, letterSpacing: 0.5 }}>
                  {reveal.tempPassword}
                </code>
                <button onClick={copyTempPassword} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${GOLD}`, background: "#fff", color: GOLD, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                  Copy
                </button>
              </div>
            </div>
            <button onClick={() => setReveal(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#7A5A14" }}>
              <X size={16} />
            </button>
          </div>
        </Card>
      )}

      <Card style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <SectionTitle>User accounts</SectionTitle>
          <button onClick={() => { setAdding((a) => !a); setCreateError(""); }} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: "none", background: EMERALD, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            <Plus size={15} /> Add user
          </button>
        </div>

        {adding && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${LINE}` }}>
            <input
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitNewUser(); }}
              style={inputStyle}
              autoFocus
            />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={inputStyle}>
              <option value="VIEWER">Viewer</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button onClick={submitNewUser} disabled={creating || !newUsername.trim()} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: creating || !newUsername.trim() ? "#B7E4CE" : EMERALD, color: "#fff", fontWeight: 700, fontSize: 13, cursor: creating || !newUsername.trim() ? "not-allowed" : "pointer" }}>
              {creating ? "Creating…" : "Create"}
            </button>
            {createError && <span style={{ fontSize: 12.5, color: RED, fontWeight: 600 }}>{createError}</span>}
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 13, color: INK_SOFT }}>Loading…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {(users || []).map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.username}</td>
                    <td>{u.role === "ADMIN" ? <Badge text="Admin" color={EMERALD} /> : <Badge text="Viewer" color={BLUE} />}</td>
                    <td>{u.mustChangePassword ? <Badge text="Pending first login" color={GOLD} /> : <span style={{ color: INK_SOFT, fontSize: 12 }}>Active</span>}</td>
                    <td style={{ color: INK_SOFT }}>{new Date(u.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td>
                      <button
                        onClick={() => resetPassword(u)}
                        disabled={resettingId === u.id}
                        style={{ border: "none", background: "none", cursor: resettingId === u.id ? "default" : "pointer", color: BLUE, fontSize: 12, fontWeight: 700, opacity: resettingId === u.id ? 0.6 : 1, padding: 0 }}
                      >
                        {resettingId === u.id ? "Resetting…" : "Reset password"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && otherUserCount > 0 && (
        <DangerZone
          title="Remove all other users"
          description={`Permanently deletes all ${otherUserCount} other user account(s). Your own account is always kept, so you can't be locked out.`}
          confirmWord="DELETE"
          onConfirm={handleWipe}
        />
      )}
    </>
  );
}

// Reconciliation tool: upload an SW/Kotak report and diff it against what's
// already in the system for that date+source, without touching any data
// until the admin explicitly chooses to save the gaps it finds.
function MissingFinderTab({ master, dailyDates, dailyData, onSaveDaily, onSaveMaster, showToast }) {
  const [source, setSource] = useState("SW");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const masterByCode = useMemo(() => {
    const map = {};
    master.forEach((m) => (map[normCode(m.code)] = m));
    return map;
  }, [master]);

  const onFile = async (file) => {
    if (!file) return;
    const wb = await readWorkbook(file);
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
    const { records, error } = parseDailySheet(rows);
    if (error) { showToast(error, "red"); return; }
    if (!records.length) { showToast("No client rows found in file", "red"); return; }

    const detected = detectSourceFromFilename(file.name);
    const effectiveSource = detected || source;
    if (detected && detected !== source) setSource(detected);
    const guessDate = guessDateFromFilename(sheetName.match(/\d{6,8}/) ? sheetName : file.name);
    const iso = isoDate(guessDate);

    const existingForSource = (dailyData[iso] || []).filter((r) => (r.source || "") === effectiveSource);
    const existingByCode = {};
    existingForSource.forEach((r) => (existingByCode[normCode(r.code)] = r));

    const seen = new Set();
    const missingCustomers = [];
    const missingBrokerage = [];
    const mismatched = [];
    for (const r of records) {
      const key = normCode(r.code);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!masterByCode[key]) missingCustomers.push(r);
      const ex = existingByCode[key];
      if (!ex) missingBrokerage.push(r);
      else if (Math.round(ex.netBrok * 100) !== Math.round(r.netBrok * 100)) mismatched.push({ ...r, dbNetBrok: ex.netBrok });
    }
    setResult({ fileName: file.name, source: effectiveSource, date: iso, total: records.length, missingCustomers, missingBrokerage, mismatched });
  };

  const addMissingCustomers = async () => {
    if (!result?.missingCustomers.length) return;
    const existing = new Set(master.map((m) => normCode(m.code)));
    const additions = result.missingCustomers.filter((r) => !existing.has(normCode(r.code))).map((r) => ({ code: r.code, name: r.name, dealer: "", rm: "", branch: "" }));
    if (!additions.length) return;
    await onSaveMaster([...master, ...additions]);
    showToast(`Added ${additions.length} client(s) to the client list — assign a dealer/RM from the Clients tab`);
    setResult((prev) => (prev ? { ...prev, missingCustomers: [] } : prev));
  };

  const saveMissingBrokerage = async () => {
    if (!result?.missingBrokerage.length) return;
    const existing = dailyData[result.date] || [];
    const sameSourceExisting = existing.filter((r) => (r.source || "") === result.source);
    const merged = [...sameSourceExisting, ...result.missingBrokerage.map((r) => ({ ...r, source: result.source }))];
    await onSaveDaily(result.date, merged);
    showToast(`Saved ${result.missingBrokerage.length} missing brokerage row(s) for ${result.date}`);
    setResult((prev) => (prev ? { ...prev, missingBrokerage: [] } : prev));
  };

  const exportList = (label, rows, columns) => {
    if (!result || !rows.length) return;
    const data = rows.map((r) => { const o = {}; columns.forEach(([key, header]) => (o[header] = r[key])); return o; });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, label.slice(0, 31));
    XLSX.writeFile(wb, `${label.replace(/\s+/g, "_").toLowerCase()}_${result.date}_${result.source}.xlsx`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card style={{ padding: 22 }}>
        <SectionTitle>Find missing customers &amp; brokerage</SectionTitle>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 14 }}>
          Upload an SW or Kotak brokerage report (same format as Daily Brokerage — Client Code, Client Name, Net Brokerage). It's compared against the client list and the report already saved for that date, without saving anything itself.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 600 }}>Source:</span>
          <div style={{ display: "flex", gap: 6 }}>
            {["SW", "KOTAK"].map((s) => (
              <button key={s} onClick={() => setSource(s)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${source === s ? RED : LINE}`, background: source === s ? RED_SOFT : "#fff", color: source === s ? RED : INK_SOFT, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                {s === "KOTAK" ? "Kotak" : "SW"}
              </button>
            ))}
          </div>
        </div>
        <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files[0]); }}
          onClick={() => inputRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? RED : LINE}`, borderRadius: 12, padding: "34px 20px", textAlign: "center", cursor: "pointer", background: dragOver ? RED_SOFT : "#FAFBFC" }}>
          <FileSearch size={28} color={INK_SOFT} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Drop the .xlsx or .csv file here, or click to browse</div>
          <div style={{ fontSize: 12.5, color: INK_SOFT }}>Needs: Client Code, Client Name, Net Brokerage.</div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
        </div>
      </Card>

      {result && (
        <>
          <div style={{ fontSize: 12.5, color: INK_SOFT }}>
            Checked <strong>{result.fileName}</strong> — {result.total} rows, {result.source === "KOTAK" ? "Kotak" : "SW"}, dated {result.date} — against {dailyDates.includes(result.date) ? "the report already saved for this date" : "no report yet saved for this date"}.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <KPI label="Missing customers" value={String(result.missingCustomers.length)} sub="in file, not in client list" tone="red" icon={Users} />
            <KPI label="Missing brokerage" value={String(result.missingBrokerage.length)} sub="in file, not in database" tone="gold" icon={IndianRupee} />
            <KPI label="Value mismatches" value={String(result.mismatched.length)} sub="differ from saved amount" tone="violet" icon={AlertTriangle} />
          </div>

          <Card style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              <SectionTitle>Missing customers — in the file but not in the client list</SectionTitle>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => exportList("Missing customers", result.missingCustomers, [["code", "Client Code"], ["name", "Client Name"], ["netBrok", "Net Brokerage"]])} disabled={!result.missingCustomers.length} style={{ display: "flex", gap: 5, alignItems: "center", border: `1px solid ${LINE}`, background: "#fff", color: INK_SOFT, borderRadius: 7, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: result.missingCustomers.length ? "pointer" : "not-allowed", opacity: result.missingCustomers.length ? 1 : 0.5 }}>
                  <Download size={13} /> Export
                </button>
                <button onClick={addMissingCustomers} disabled={!result.missingCustomers.length} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: result.missingCustomers.length ? EMERALD : "#C9CDD4", color: "#fff", fontWeight: 700, fontSize: 12, cursor: result.missingCustomers.length ? "pointer" : "not-allowed" }}>
                  Add all to client list
                </button>
              </div>
            </div>
            <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
              <table>
                <thead><tr><th>Code</th><th>Name</th><th>Net Brokerage</th></tr></thead>
                <tbody>
                  {result.missingCustomers.map((r, i) => (
                    <tr key={`${r.code}-${i}`}><td>{r.code}</td><td>{r.name}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.netBrok)}</td></tr>
                  ))}
                  {result.missingCustomers.length === 0 && <tr><td colSpan={3} style={{ color: INK_SOFT, textAlign: "center", padding: 16 }}>None — every client in the file is already in the client list.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <Card style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              <SectionTitle>Missing brokerage — in the file but not saved for {result.date} ({result.source === "KOTAK" ? "Kotak" : "SW"})</SectionTitle>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => exportList("Missing brokerage", result.missingBrokerage, [["code", "Client Code"], ["name", "Client Name"], ["netBrok", "Net Brokerage"]])} disabled={!result.missingBrokerage.length} style={{ display: "flex", gap: 5, alignItems: "center", border: `1px solid ${LINE}`, background: "#fff", color: INK_SOFT, borderRadius: 7, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: result.missingBrokerage.length ? "pointer" : "not-allowed", opacity: result.missingBrokerage.length ? 1 : 0.5 }}>
                  <Download size={13} /> Export
                </button>
                <button onClick={saveMissingBrokerage} disabled={!result.missingBrokerage.length} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: result.missingBrokerage.length ? EMERALD : "#C9CDD4", color: "#fff", fontWeight: 700, fontSize: 12, cursor: result.missingBrokerage.length ? "pointer" : "not-allowed" }}>
                  Save to database
                </button>
              </div>
            </div>
            <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
              <table>
                <thead><tr><th>Code</th><th>Name</th><th>Net Brokerage</th></tr></thead>
                <tbody>
                  {result.missingBrokerage.map((r, i) => (
                    <tr key={`${r.code}-${i}`}><td>{r.code}</td><td>{r.name}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.netBrok)}</td></tr>
                  ))}
                  {result.missingBrokerage.length === 0 && <tr><td colSpan={3} style={{ color: INK_SOFT, textAlign: "center", padding: 16 }}>None — every client in the file is already saved for this date &amp; source.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {result.mismatched.length > 0 && (
            <Card style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                <SectionTitle>Value mismatches — saved amount differs from the file</SectionTitle>
                <button onClick={() => exportList("Value mismatches", result.mismatched, [["code", "Client Code"], ["name", "Client Name"], ["dbNetBrok", "Saved Net Brokerage"], ["netBrok", "File Net Brokerage"]])} style={{ display: "flex", gap: 5, alignItems: "center", border: `1px solid ${LINE}`, background: "#fff", color: INK_SOFT, borderRadius: 7, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  <Download size={13} /> Export
                </button>
              </div>
              <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 10 }}>Re-upload this source for this date from the Upload tab to overwrite these with the file's values.</div>
              <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
                <table>
                  <thead><tr><th>Code</th><th>Name</th><th>Saved Amount</th><th>File Amount</th></tr></thead>
                  <tbody>
                    {result.mismatched.map((r, i) => (
                      <tr key={`${r.code}-${i}`}><td>{r.code}</td><td>{r.name}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.dbNetBrok)}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.netBrok)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// Per-dealer report: clients currently mapped, how many actually traded in
// the selected range, and Total/Net brokerage for that range — computed
// server-side (/api/reports/dealers) since it joins every DailyRecord in
// the range against MasterClient, not something to reduce client-side.
function ReportsTab({ targets, showToast }) {
  // Defaults to "all" (matching Dealers/Clients/RMs tabs) rather than
  // "month" — Month/Quarter/Year here bucket by real calendar time, same
  // as those tabs' own period buttons, so if the latest upload is behind
  // the real calendar date, "Month" can legitimately show nothing.
  const [period, setPeriod] = useState("all");
  const [useCustom, setUseCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  // Salary vs. incentive-eligibility only makes sense against a single
  // month of pay, so it's shown only for the plain "Month" preset — not
  // Quarter/Year/All/custom, which would need to scale salary by however
  // many months the range spans.
  const isMonthlyView = period === "month" && !useCustom;
  const incentiveMultiplier = targets.incentiveMultiplier ?? 10;

  const range = useMemo(() => {
    if (useCustom) return { from: customFrom || null, to: customTo || null };
    if (period === "all") return { from: null, to: null };
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const start = period === "month" ? new Date(y, m, 1)
      : period === "quarter" ? new Date(y, Math.floor(m / 3) * 3, 1)
      : new Date(y, 0, 1);
    return { from: isoDate(start), to: isoDate(now) };
  }, [period, useCustom, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const qs = new URLSearchParams();
      if (range.from) qs.set("from", range.from);
      if (range.to) qs.set("to", range.to);
      const res = await apiGetCached(`/api/reports/dealers?${qs.toString()}`);
      if (cancelled) return;
      setRows(res?.rows || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  const rangeLabel = range.from || range.to ? `${range.from || "start"} → ${range.to || "today"}` : "All time";

  const totals = (rows || []).reduce((acc, r) => ({
    clientsMapped: acc.clientsMapped + r.clientsMapped,
    tradedClients: acc.tradedClients + r.tradedClients,
    totalBrokerage: acc.totalBrokerage + r.totalBrokerage,
    netBrokerage: acc.netBrokerage + r.netBrokerage,
  }), { clientsMapped: 0, tradedClients: 0, totalBrokerage: 0, netBrokerage: 0 });

  // salary/multiplier/eligible for one dealer's row — null salary means "not
  // set", kept separate from a genuine 0 so it renders as "—" not "0x".
  const incentiveFor = (r) => {
    const salary = targets.dealerSalary?.[r.dealer];
    const hasSalary = salary != null && salary > 0;
    const multiplier = hasSalary ? r.netBrokerage / salary : null;
    const eligible = hasSalary && multiplier >= incentiveMultiplier;
    return { salary: hasSalary ? salary : null, multiplier, eligible };
  };

  const exportExcel = () => {
    if (!rows || !rows.length) { showToast("Nothing to export", "gold"); return; }
    const data = rows.map((r) => {
      const base = {
        "Dealer": r.dealer,
        "Clients Mapped": r.clientsMapped,
        "Traded Clients": r.tradedClients,
        "Total Brokerage": Math.round(r.totalBrokerage * 100) / 100,
        "Net Brokerage": Math.round(r.netBrokerage * 100) / 100,
      };
      if (!isMonthlyView) return base;
      const { salary, multiplier, eligible } = incentiveFor(r);
      return { ...base, "Salary": salary ?? "", "Multiplier": multiplier != null ? `${multiplier.toFixed(2)}x` : "", "Incentive Eligible": salary == null ? "" : (eligible ? "Yes" : "No") };
    });
    data.push({ "Dealer": "TOTAL", "Clients Mapped": totals.clientsMapped, "Traded Clients": totals.tradedClients, "Total Brokerage": Math.round(totals.totalBrokerage * 100) / 100, "Net Brokerage": Math.round(totals.netBrokerage * 100) / 100 });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dealer Report");
    XLSX.writeFile(wb, `dealer_report_${range.from || "all"}_to_${range.to || "now"}.xlsx`);
    showToast(`Exported ${rows.length} dealer(s)`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Printing only shows .dt-report-printable — same trick as a normal
          browser print dialog, so "Export PDF" needs no extra dependency:
          the user picks "Save as PDF" as the destination. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .dt-report-printable, .dt-report-printable * { visibility: visible; }
          .dt-report-printable { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <SectionTitle>Dealer report</SectionTitle>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={exportExcel} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
            <FileSpreadsheet size={14} /> Export Excel
          </button>
          <button onClick={() => window.print()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
            <Printer size={14} /> Export PDF
          </button>
        </div>
      </div>

      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["month", "quarter", "year", "all"].map((p) => (
              <button key={p} onClick={() => { setPeriod(p); setUseCustom(false); }} style={{
                padding: "6px 14px", borderRadius: 8, border: `1px solid ${!useCustom && period === p ? BLUE : LINE}`,
                background: !useCustom && period === p ? BLUE_SOFT : "#fff", color: !useCustom && period === p ? BLUE : INK_SOFT,
                fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
              }}>
                {p === "all" ? "All time" : p}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: LINE }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 600 }}>Custom range:</label>
            <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setUseCustom(true); }} style={{ ...inputStyle, width: 150 }} />
            <span style={{ color: INK_SOFT }}>to</span>
            <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setUseCustom(true); }} style={{ ...inputStyle, width: 150 }} />
            {useCustom && (
              <button onClick={() => { setUseCustom(false); setCustomFrom(""); setCustomTo(""); }} style={{ border: "none", background: "none", color: RED, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                Clear
              </button>
            )}
          </div>
        </div>
      </Card>

      <div className="dt-report-printable">
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <FileBarChart2 size={15} color={INK_SOFT} />
            <span style={{ fontSize: 13, color: INK_SOFT }}>Range: <strong style={{ color: INK }}>{rangeLabel}</strong></span>
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: INK_SOFT }}>Loading report…</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Dealer</th><th>Clients Mapped</th><th>Traded Clients</th><th>Total Brokerage</th><th>Net Brokerage</th>
                    {isMonthlyView && <><th>Salary</th><th>Multiplier</th><th>Incentive</th></>}
                  </tr>
                </thead>
                <tbody>
                  {(rows || []).map((r) => {
                    const { salary, multiplier, eligible } = isMonthlyView ? incentiveFor(r) : {};
                    return (
                      <tr key={r.dealer}>
                        <td style={{ fontWeight: 600 }}>{r.dealer}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.clientsMapped}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.tradedClients}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtFull(r.totalBrokerage)}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.netBrokerage)}</td>
                        {isMonthlyView && (
                          <>
                            <td style={{ fontVariantNumeric: "tabular-nums" }}>{salary != null ? fmtFull(salary) : "—"}</td>
                            <td style={{ fontVariantNumeric: "tabular-nums" }}>{multiplier != null ? `${multiplier.toFixed(2)}x` : "—"}</td>
                            <td>{salary == null ? <span style={{ color: INK_SOFT }}>—</span> : <Badge text={eligible ? "Eligible" : "Not eligible"} color={eligible ? EMERALD : "#9AA1AC"} />}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                  {(!rows || rows.length === 0) && (
                    <tr><td colSpan={isMonthlyView ? 8 : 5} style={{ color: INK_SOFT, textAlign: "center", padding: 20 }}>No dealer activity in this range.</td></tr>
                  )}
                </tbody>
                {rows && rows.length > 0 && (
                  <tfoot>
                    <tr style={{ fontWeight: 700, borderTop: `2px solid ${LINE}` }}>
                      <td>Total</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{totals.clientsMapped}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{totals.tradedClients}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(totals.totalBrokerage)}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(totals.netBrokerage)}</td>
                      {isMonthlyView && <><td></td><td></td><td></td></>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function TargetsTab({ targets, dealerNames, onSave, onWipeUsers, showToast }) {
  const [monthly, setMonthly] = useState(targets.monthly || 0);
  const [kotakSharePct, setKotakSharePct] = useState(targets.kotakSharePct ?? 85);
  const [rmSplitPct, setRmSplitPct] = useState(targets.rmSplitPct ?? 50);
  const [incentiveMultiplier, setIncentiveMultiplier] = useState(targets.incentiveMultiplier ?? 10);
  const [salaryDrafts, setSalaryDrafts] = useState({});
  const save = () => {
    const pct = Number(kotakSharePct);
    const rmPct = Number(rmSplitPct);
    const mult = Number(incentiveMultiplier);
    onSave({
      ...targets,
      monthly: Number(monthly) || 0,
      kotakSharePct: isNaN(pct) ? 85 : Math.min(100, Math.max(0, pct)),
      rmSplitPct: isNaN(rmPct) ? 50 : Math.min(100, Math.max(0, rmPct)),
      incentiveMultiplier: isNaN(mult) ? 10 : Math.max(0, mult),
    });
  };
  const saveSalary = (dealer) => {
    const v = Number(salaryDrafts[dealer]);
    onSave({ ...targets, dealerSalary: { ...targets.dealerSalary, [dealer]: isNaN(v) ? 0 : Math.max(0, v) } });
    showToast(`Saved salary for ${dealer}`);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 520 }}>
      <Card style={{ padding: 20 }}>
        <SectionTitle>Company monthly brokerage target</SectionTitle>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>Quarterly and yearly figures on the dashboard are implied as ×3 and ×12 of this. Set per-dealer targets from the Dealers tab.</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 14, color: INK_SOFT }}>₹</span>
          <input type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} style={{ ...inputStyle, width: 200, fontSize: 15, fontWeight: 700 }} />
        </div>
      </Card>

      <Card style={{ padding: 20 }}>
        <SectionTitle>Kotak brokerage share</SectionTitle>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
          Every Kotak upload is stored at its raw (100%) figure — this percentage is applied wherever brokerage totals are shown, for every Kotak record ever uploaded. Changing it recalculates all of them immediately, no re-upload needed.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {[85].map((p) => (
            <button
              key={p}
              onClick={() => setKotakSharePct(p)}
              style={{
                padding: "7px 16px", borderRadius: 8, border: `1px solid ${Number(kotakSharePct) === p ? GOLD : LINE}`,
                background: Number(kotakSharePct) === p ? GOLD_SOFT : "#fff", color: Number(kotakSharePct) === p ? GOLD : INK_SOFT,
                fontWeight: 700, fontSize: 13, cursor: "pointer",
              }}
            >
              {p}%
            </button>
          ))}
          <input
            type="number" min="0" max="100" value={kotakSharePct}
            onChange={(e) => setKotakSharePct(e.target.value)}
            style={{ ...inputStyle, width: 90, fontSize: 15, fontWeight: 700 }}
          />
          <span style={{ fontSize: 14, color: INK_SOFT }}>%</span>
        </div>
      </Card>

      <Card style={{ padding: 20 }}>
        <SectionTitle>RM / Dealer brokerage split</SectionTitle>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
          For a client mapped to both an RM and a dealer, this percentage is the RM's share — the dealer keeps the rest. If the RM and dealer are the same person (case-insensitive), there's no split: the dealer gets 100%. See the split breakdown table in the Dealers tab.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setRmSplitPct(50)}
            style={{
              padding: "7px 16px", borderRadius: 8, border: `1px solid ${Number(rmSplitPct) === 50 ? TEAL : LINE}`,
              background: Number(rmSplitPct) === 50 ? TEAL_SOFT : "#fff", color: Number(rmSplitPct) === 50 ? TEAL : INK_SOFT,
              fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
          >
            50 / 50
          </button>
          <input
            type="number" min="0" max="100" value={rmSplitPct}
            onChange={(e) => setRmSplitPct(e.target.value)}
            style={{ ...inputStyle, width: 90, fontSize: 15, fontWeight: 700 }}
          />
          <span style={{ fontSize: 14, color: INK_SOFT }}>% to RM</span>
        </div>
      </Card>

      <Card style={{ padding: 20 }}>
        <SectionTitle>Incentive multiplier target</SectionTitle>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
          On the Reports tab's monthly view, a dealer is marked incentive-eligible when their Net Brokerage for the month is at least this many times their monthly salary.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number" min="0" step="0.5" value={incentiveMultiplier}
            onChange={(e) => setIncentiveMultiplier(e.target.value)}
            style={{ ...inputStyle, width: 90, fontSize: 15, fontWeight: 700 }}
          />
          <span style={{ fontSize: 14, color: INK_SOFT }}>x salary</span>
        </div>
      </Card>

      <button onClick={save} style={{ alignSelf: "flex-start", padding: "10px 22px", borderRadius: 9, border: "none", background: ROSE, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>Save settings</button>

      <Card style={{ padding: 20 }}>
        <SectionTitle>Dealer monthly salary</SectionTitle>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
          Used only for the incentive-eligible calculation on the Reports tab. Leave blank/0 for a dealer to exclude them from that check.
        </div>
        {dealerNames.length === 0 ? (
          <div style={{ fontSize: 12.5, color: INK_SOFT }}>No dealers yet — add one from the Dealers tab first.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dealerNames.map((d) => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, width: 160, flexShrink: 0 }}>{d}</span>
                <span style={{ fontSize: 13, color: INK_SOFT }}>₹</span>
                <input
                  type="number" min="0"
                  value={salaryDrafts[d] ?? targets.dealerSalary?.[d] ?? 0}
                  onChange={(e) => setSalaryDrafts((p) => ({ ...p, [d]: e.target.value }))}
                  style={{ ...inputStyle, width: 140 }}
                />
                <button onClick={() => saveSalary(d)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: ROSE, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                  Save
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <UsersSection onWipeUsers={onWipeUsers} showToast={showToast} />
    </div>
  );
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

async function fetchTasks(month) {
  const res = await fetch(`/api/tasks?month=${month}`, { credentials: "same-origin" });
  if (!res.ok) return null;
  return res.json();
}

function TasksTab({ isAdmin, showToast }) {
  const [month, setMonth] = useState(currentMonthKey());
  const [loading, setLoading] = useState(true);
  const [own, setOwn] = useState(null);
  const [byDealer, setByDealer] = useState(null);
  const [dealerFilter, setDealerFilter] = useState("");
  const [editDrafts, setEditDrafts] = useState({});

  const load = async () => {
    setLoading(true);
    const data = await fetchTasks(month);
    if (data) {
      if (isAdmin) setByDealer(data.dealers || {});
      else { setOwn(data); }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [month, isAdmin]);

  const toggleDone = async (slot, done) => {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, slot, done }),
    });
    if (res.ok) {
      setOwn((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.slot === slot ? { ...t, done } : t)) }));
    } else {
      showToast("Couldn't update task", "red");
    }
  };

  const saveDealerTask = async (dealer, slot, text) => {
    const res = await fetch("/api/tasks", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealer, month, slot, text }),
    });
    if (res.ok) {
      setByDealer((prev) => ({
        ...prev,
        [dealer]: prev[dealer].map((t) => (t.slot === slot ? { ...t, text } : t)),
      }));
      showToast(`Saved task ${slot} for ${dealer}`);
    } else {
      showToast("Couldn't save task", "red");
    }
  };

  if (loading) return <Card style={{ padding: 40, textAlign: "center", color: INK_SOFT }}>Loading tasks…</Card>;

  const monthPicker = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <label style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 600 }}>Month:</label>
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value || currentMonthKey())}
        style={{ ...inputStyle, width: 160 }}
      />
    </div>
  );

  if (!isAdmin) {
    const tasks = own?.tasks || [];
    const doneCount = tasks.filter((t) => t.done).length;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <SectionTitle>Your monthly tasks — {monthLabel(month)}</SectionTitle>
          {monthPicker}
        </div>
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: INK_SOFT }}>{doneCount} of {tasks.length} completed</span>
            <ProgressBarInline pct={tasks.length ? (doneCount / tasks.length) * 100 : 0} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tasks.map((t) => (
              <label key={t.slot} style={{
                display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderRadius: 10,
                border: `1px solid ${LINE}`, background: t.done ? EMERALD_SOFT : "#fff", cursor: t.text ? "pointer" : "default",
              }}>
                <input
                  type="checkbox"
                  checked={t.done}
                  disabled={!t.text}
                  onChange={(e) => toggleDone(t.slot, e.target.checked)}
                  style={{ marginTop: 3, width: 16, height: 16, cursor: t.text ? "pointer" : "default" }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK, textDecoration: t.done ? "line-through" : "none" }}>
                    {t.text || <span style={{ color: "#B7BCC5", fontWeight: 500, fontStyle: "italic" }}>No task set for slot {t.slot} this month</span>}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const dealerNames = Object.keys(byDealer || {}).sort();
  const filteredDealers = dealerNames.filter((d) => !dealerFilter || d.toLowerCase().includes(dealerFilter.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <SectionTitle>Monthly tasks by dealer — {monthLabel(month)}</SectionTitle>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="dt-search-wrap" style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input className="dt-search" placeholder="Search dealer" value={dealerFilter} onChange={(e) => setDealerFilter(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 200 }} />
          </div>
          {monthPicker}
        </div>
      </div>

      {filteredDealers.length === 0 && <EmptyState icon={ListChecks} title="No dealers yet" text="Add dealers from the Dealers tab, then set their monthly tasks here." />}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filteredDealers.map((dealer) => {
          const tasks = byDealer[dealer];
          const doneCount = tasks.filter((t) => t.done).length;
          return (
            <Card key={dealer} style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <Badge text={dealer} color={dealerColor(dealer)} />
                <span style={{ fontSize: 12.5, color: INK_SOFT }}>{doneCount} of {tasks.length} completed</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tasks.map((t) => {
                  const draftKey = `${dealer}:${t.slot}`;
                  const draft = editDrafts[draftKey] ?? t.text;
                  return (
                    <div key={t.slot} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11.5, color: INK_SOFT, width: 16 }}>{t.slot}.</span>
                      <input
                        value={draft}
                        placeholder={`Task ${t.slot}`}
                        onChange={(e) => setEditDrafts({ ...editDrafts, [draftKey]: e.target.value })}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        onClick={() => saveDealerTask(dealer, t.slot, (editDrafts[draftKey] ?? t.text).trim())}
                        style={{ border: "none", background: "none", cursor: "pointer", color: BLUE, fontSize: 11.5, fontWeight: 700 }}
                      >
                        Save
                      </button>
                      {t.done ? <CheckCircle2 size={15} color={EMERALD} /> : <span style={{ fontSize: 11, color: "#B7BCC5" }}>not done</span>}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TasksSummaryCard({ isAdmin }) {
  const [loading, setLoading] = useState(true);
  const [own, setOwn] = useState(null);
  const [byDealer, setByDealer] = useState(null);
  const month = currentMonthKey();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await fetchTasks(month);
      if (data) { if (isAdmin) setByDealer(data.dealers || {}); else setOwn(data); }
      setLoading(false);
    })();
  }, [isAdmin]);

  const toggleDone = async (slot, done) => {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, slot, done }),
    });
    if (res.ok) setOwn((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.slot === slot ? { ...t, done } : t)) }));
  };

  if (loading) return null;

  if (!isAdmin) {
    const tasks = own?.tasks || [];
    if (!tasks.some((t) => t.text)) return null;
    const doneCount = tasks.filter((t) => t.done).length;
    return (
      <Card style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <SectionTitle>Your monthly tasks — {monthLabel(month)}</SectionTitle>
          <span style={{ fontSize: 12.5, color: INK_SOFT }}>{doneCount} of {tasks.length} completed</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tasks.filter((t) => t.text).map((t) => (
            <label key={t.slot} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <input type="checkbox" checked={t.done} onChange={(e) => toggleDone(t.slot, e.target.checked)} style={{ width: 15, height: 15, cursor: "pointer" }} />
              <span style={{ textDecoration: t.done ? "line-through" : "none", color: t.done ? INK_SOFT : INK }}>{t.text}</span>
            </label>
          ))}
        </div>
      </Card>
    );
  }

  const dealerNames = Object.keys(byDealer || {}).sort();
  if (!dealerNames.length) return null;
  const rows = dealerNames.map((d) => {
    const tasks = byDealer[d];
    const set = tasks.filter((t) => t.text);
    const done = set.filter((t) => t.done).length;
    return { dealer: d, total: set.length, done };
  });

  return (
    <Card style={{ padding: 18 }}>
      <SectionTitle>Dealer monthly tasks — {monthLabel(month)}</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {rows.map((r) => (
          <div key={r.dealer} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <Badge text={r.dealer} color={dealerColor(r.dealer)} />
            {r.total === 0 ? (
              <span style={{ fontSize: 11.5, color: "#B7BCC5" }}>No tasks set</span>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1 }}><ProgressBarInline pct={(r.done / r.total) * 100} /></div>
                <span style={{ fontSize: 11.5, color: INK_SOFT, whiteSpace: "nowrap" }}>{r.done}/{r.total}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ProgressBarInline({ pct }) {
  const color = pct >= 100 ? EMERALD : pct >= 50 ? GOLD : RED;
  return (
    <div style={{ width: 140, height: 7, background: "#EDEFF2", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(100, Math.max(2, pct))}%`, background: color, borderRadius: 99, transition: "width .4s ease" }} />
    </div>
  );
}
