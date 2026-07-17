import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  LayoutDashboard, UploadCloud, Users, Target, TrendingUp,
  Calendar, Trash2, Plus, Search, AlertTriangle, CheckCircle2,
  FileSpreadsheet, Building2, IndianRupee, Pencil, X, Check,
  ShieldCheck, Eye, ChevronUp, ChevronDown, ReceiptText, Layers
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

async function storageGet(key) {
  try { const r = await window.storage.get(key, false); return r ? JSON.parse(r.value) : null; } catch (e) { return null; }
}
async function storageSet(key, value) {
  try { await window.storage.set(key, JSON.stringify(value), false); return true; } catch (e) { return false; }
}
async function storageDelete(key) {
  try { await window.storage.delete(key, false); return true; } catch (e) { return false; }
}
async function storageList(prefix) {
  try { const r = await window.storage.list(prefix, false); return r ? r.keys : []; } catch (e) { return []; }
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
  const netBrokI = findCol(headers, "net brok", "net brokerage", "brokerage");
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
function ProgressBar({ pct }) {
  const color = pct >= 100 ? EMERALD : pct >= 60 ? GOLD : RED;
  return <div style={{ height: 7, background: "#EDEFF2", borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, Math.max(2, pct))}%`, background: color, borderRadius: 99, transition: "width .4s ease" }} /></div>;
}
function Badge({ text, color }) {
  return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, color: "#fff", background: color }}>{text}</span>;
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
  const [dailyDates, setDailyDates] = useState([]);
  const [dailyData, setDailyData] = useState({});
  const [debitDates, setDebitDates] = useState([]);
  const [debitData, setDebitData] = useState({});
  const [targets, setTargets] = useState({ monthly: 0, dealerMonthly: {} });
  const [role, setRole] = useState("admin");
  const [toast, setToast] = useState(null);

  const showToast = (msg, tone = "emerald") => { setToast({ msg, tone }); setTimeout(() => setToast(null), 3200); };
  const isAdmin = role === "admin";

  useEffect(() => {
    (async () => {
      const m = await storageGet("master-clients"); if (m) setMaster(m);
      const dr = await storageGet("dealers-list"); if (dr) setDealerRegistry(dr);
      const t = await storageGet("targets"); if (t) setTargets(t);
      const r = await storageGet("user-role"); if (r) setRole(r);

      const dKeys = await storageList("daily:");
      const dDates = dKeys.map((k) => k.replace("daily:", "")).sort();
      setDailyDates(dDates);
      const dData = {};
      for (const d of dDates) { const recs = await storageGet(`daily:${d}`); if (recs) dData[d] = recs; }
      setDailyData(dData);

      const bKeys = await storageList("debit:");
      const bDates = bKeys.map((k) => k.replace("debit:", "")).sort();
      setDebitDates(bDates);
      const bData = {};
      for (const d of bDates) { const recs = await storageGet(`debit:${d}`); if (recs) bData[d] = recs; }
      setDebitData(bData);

      setLoading(false);
    })();
  }, []);

  const masterByCode = useMemo(() => { const map = {}; master.forEach((m) => (map[normCode(m.code)] = m)); return map; }, [master]);

  const allRecords = useMemo(() => {
    const out = [];
    for (const d of dailyDates) {
      for (const r of dailyData[d] || []) {
        const mm = masterByCode[normCode(r.code)];
        out.push({ ...r, date: d, dealer: mm && mm.dealer ? mm.dealer : UNMAPPED, rm: mm ? mm.rm : "" });
      }
    }
    return out;
  }, [dailyDates, dailyData, masterByCode]);

  const latestDebitByCode = useMemo(() => {
    const map = {};
    for (const d of debitDates) { for (const r of debitData[d] || []) map[normCode(r.code)] = r.debit; }
    return map;
  }, [debitDates, debitData]);

  const dealerNames = useMemo(() => {
    const s = new Set(dealerRegistry);
    master.forEach((m) => { if (m.dealer) s.add(m.dealer); });
    return Array.from(s).sort();
  }, [dealerRegistry, master]);

  const latestDate = dailyDates.length ? dailyDates[dailyDates.length - 1] : null;

  const saveDaily = async (isoD, records) => {
    const total = records.reduce((s, r) => s + r.netBrok, 0);
    setDailyData((p) => ({ ...p, [isoD]: records }));
    setDailyDates((p) => (p.includes(isoD) ? p : [...p, isoD].sort()));
    showToast(`Saved ${isoD} — ${records.length} clients, ${fmtFull(total)} net brokerage`);
    storageSet(`daily:${isoD}`, records);
  };
  const deleteDaily = async (isoD) => {
    setDailyData((p) => { const c = { ...p }; delete c[isoD]; return c; });
    setDailyDates((p) => p.filter((d) => d !== isoD));
    showToast(`Removed ${isoD}`, "gold");
    storageDelete(`daily:${isoD}`);
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
  const saveMaster = async (records) => { setMaster(records); storageSet("master-clients", records); };
  const saveDealerRegistry = async (list) => { setDealerRegistry(list); storageSet("dealers-list", list); };
  const saveTargets = async (t) => { setTargets(t); storageSet("targets", t); };
  const changeRole = async (r) => { await storageSet("user-role", r); setRole(r); };

  const renameDealer = async (oldName, newName) => {
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
    if (!name || dealerNames.includes(name)) return;
    await saveDealerRegistry([...dealerRegistry, name]);
    showToast(`Added dealer ${name}`);
  };

  if (loading) {
    return <div style={{ minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "Inter, sans-serif", color: INK_SOFT }}>Loading brokerage data…</div>;
  }

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, color: BLUE, adminOnly: false },
    { id: "clients", label: "Clients", icon: Users, color: TEAL, adminOnly: false },
    { id: "dealers", label: "Dealers", icon: Building2, color: VIOLET, adminOnly: false },
    { id: "upload", label: "Upload", icon: UploadCloud, color: GOLD, adminOnly: true },
    { id: "targets", label: "Targets", icon: Target, color: ROSE, adminOnly: true },
  ];
  const visibleNav = NAV.filter((n) => !n.adminOnly || isAdmin);

  return (
    <div style={{ background: BG, minHeight: 600, fontFamily: "Inter, sans-serif", color: INK, borderRadius: 16 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 9px 12px; font-size: 13px; }
        thead th { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.4px; color: ${INK_SOFT}; border-bottom: 1px solid ${LINE}; font-weight: 600; }
        tbody tr { border-bottom: 1px solid ${LINE}; }
        tbody tr:hover { background: #FAFBFC; }
        input, select, button { font-family: 'Inter', sans-serif; font-size: 13.5px; }
        input:focus, select:focus, button:focus-visible { outline: 2px solid ${BLUE}; outline-offset: 1px; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: #D6D9DE; border-radius: 8px; }
      `}</style>

      <div style={{ background: NAVY, borderRadius: "16px 16px 0 0", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${BLUE}, ${VIOLET})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IndianRupee size={19} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>Sharewealth Brokerage Desk</div>
            <div style={{ fontSize: 12, color: "#A6B0C3" }}>{latestDate ? `Data through ${parseISO(latestDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : "No data uploaded yet"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.06)", padding: 5, borderRadius: 12, flexWrap: "wrap" }}>
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
          <RoleSwitch role={role} onChange={changeRole} />
        </div>
      </div>

      <div style={{ padding: 22 }}>
        {tab === "dashboard" && <Dashboard allRecords={allRecords} dailyDates={dailyDates} latestDate={latestDate} targets={targets} />}
        {tab === "clients" && (
          <ClientsTab
            master={master} allRecords={allRecords} latestDebitByCode={latestDebitByCode} dealerNames={dealerNames}
            isAdmin={isAdmin} onSave={saveMaster}
          />
        )}
        {tab === "dealers" && (
          <DealersTab
            master={master} dealerNames={dealerNames} allRecords={allRecords} targets={targets}
            isAdmin={isAdmin} onRename={renameDealer} onRemove={removeDealer} onAdd={addDealer} onSaveTargets={saveTargets}
          />
        )}
        {tab === "upload" && isAdmin && (
          <UploadTab
            dailyDates={dailyDates} dailyData={dailyData} debitDates={debitDates} debitData={debitData} masterByCode={masterByCode}
            onSaveDaily={saveDaily} onDeleteDaily={deleteDaily} onSaveDebit={saveDebit} onDeleteDebit={deleteDebit} showToast={showToast}
          />
        )}
        {tab === "targets" && isAdmin && <TargetsTab targets={targets} onSave={saveTargets} />}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: toast.tone === "red" ? RED : toast.tone === "gold" ? GOLD : NAVY, color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13.5, fontWeight: 500, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", zIndex: 50, display: "flex", alignItems: "center", gap: 8 }}>
          {toast.tone === "red" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />} {toast.msg}
        </div>
      )}
    </div>
  );
}

function RoleSwitch({ role, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
        {role === "admin" ? <ShieldCheck size={14} /> : <Eye size={14} />} {role === "admin" ? "Admin" : "Viewer"}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "#fff", borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,0.18)", padding: 6, width: 230, zIndex: 40 }}>
          {["admin", "user"].map((r) => (
            <button key={r} onClick={() => { onChange(r); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: role === r ? "#EEF0F3" : "transparent", cursor: "pointer", fontSize: 13, fontWeight: 600, color: INK, textAlign: "left" }}>
              {r === "admin" ? <ShieldCheck size={14} color={EMERALD} /> : <Eye size={14} color={BLUE} />} {r === "admin" ? "Admin — full edit access" : "Viewer — read-only dashboard"}
            </button>
          ))}
          <div style={{ fontSize: 11, color: INK_SOFT, padding: "8px 10px 4px", lineHeight: 1.4 }}>
            This is a view-mode switch stored in your browser, not secure login — anyone with this chat can switch back.
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard({ allRecords, dailyDates, latestDate, targets }) {
  const [period, setPeriod] = useState("month");
  const [todaySearch, setTodaySearch] = useState("");
  if (!dailyDates.length) return <EmptyState icon={UploadCloud} title="No data uploaded yet" text="Head to Upload to add your first day's brokerage report — the dashboard fills in automatically." />;

  const latestD = parseISO(latestDate);
  const y = latestD.getFullYear(), m = latestD.getMonth(), q = quarterOf(latestD);

  const inPeriod = (rec, p) => {
    const d = parseISO(rec.date);
    if (p === "day") return rec.date === latestDate;
    if (p === "month") return d.getFullYear() === y && d.getMonth() === m;
    if (p === "quarter") return d.getFullYear() === y && quarterOf(d) === q;
    if (p === "year") return d.getFullYear() === y;
    return true;
  };
  const sum = (arr) => arr.reduce((s, r) => s + r.netBrok, 0);
  const dayTotal = sum(allRecords.filter((r) => inPeriod(r, "day")));
  const monthTotal = sum(allRecords.filter((r) => inPeriod(r, "month")));
  const quarterTotal = sum(allRecords.filter((r) => inPeriod(r, "quarter")));
  const yearTotal = sum(allRecords.filter((r) => inPeriod(r, "year")));

  const monthlyTarget = targets.monthly || 0;
  const monthPct = monthlyTarget > 0 ? (monthTotal / monthlyTarget) * 100 : null;
  const quarterPct = monthlyTarget > 0 ? (quarterTotal / (monthlyTarget * 3)) * 100 : null;
  const yearPct = monthlyTarget > 0 ? (yearTotal / (monthlyTarget * 12)) * 100 : null;

  const activeRecs = allRecords.filter((r) => inPeriod(r, period));
  const dealerMap = {};
  activeRecs.forEach((r) => { dealerMap[r.dealer] = (dealerMap[r.dealer] || 0) + r.netBrok; });
  const dealerRows = Object.entries(dealerMap).map(([dealer, val]) => ({ dealer, value: Math.round(val) })).sort((a, b) => b.value - a.value);

  const clientMap = {};
  activeRecs.forEach((r) => { if (!clientMap[r.code]) clientMap[r.code] = { code: r.code, name: r.name, value: 0 }; clientMap[r.code].value += r.netBrok; });
  const topClients = Object.values(clientMap).sort((a, b) => b.value - a.value).slice(0, 10);

  const byDate = {};
  allRecords.forEach((r) => { byDate[r.date] = (byDate[r.date] || 0) + r.netBrok; });
  const trend = dailyDates.slice(-30).map((d) => ({ date: parseISO(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), value: Math.round(byDate[d] || 0) }));

  const unmapped = dealerRows.find((d) => d.dealer === UNMAPPED);

  const todayRecs = allRecords.filter((r) => r.date === latestDate);
  const todayFiltered = todayRecs.filter((r) => {
    if (!todaySearch) return true;
    const s = todaySearch.toLowerCase();
    return r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || (r.dealer || "").toLowerCase().includes(s) || (r.rm || "").toLowerCase().includes(s);
  });
  const { sorted: todaySorted, sortKey: todaySortKey, sortDir: todaySortDir, toggle: todayToggle } = useSort(todayFiltered, "netBrok", "desc");
  const todayGrandTotal = todayRecs.reduce((s, r) => s + r.netBrok, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        <KPI label="Today" value={fmtINR(dayTotal)} sub={latestD.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} tone="blue" icon={Calendar} />
        <KPI label={`${MONTH_NAMES[m]} MTD`} value={fmtINR(monthTotal)} sub={monthPct !== null ? `${monthPct.toFixed(0)}% of ${fmtINR(monthlyTarget)} target` : "Set a target in the Targets tab"} tone={monthPct === null ? "violet" : monthPct >= 100 ? "emerald" : monthPct >= 60 ? "gold" : "red"} icon={TrendingUp} />
        <KPI label={`Q${q} QTD`} value={fmtINR(quarterTotal)} sub={quarterPct !== null ? `${quarterPct.toFixed(0)}% of implied target` : "—"} tone={quarterPct === null ? "violet" : quarterPct >= 100 ? "emerald" : quarterPct >= 60 ? "gold" : "red"} icon={TrendingUp} />
        <KPI label={`${y} YTD`} value={fmtINR(yearTotal)} sub={yearPct !== null ? `${yearPct.toFixed(0)}% of implied target` : "—"} tone={yearPct === null ? "violet" : yearPct >= 100 ? "emerald" : yearPct >= 60 ? "gold" : "red"} icon={Building2} />
      </div>

      {unmapped && unmapped.value !== 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: GOLD_SOFT, border: `1px dashed ${GOLD}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#7A5A14" }}>
          <AlertTriangle size={15} /> {fmtINR(unmapped.value)} of brokerage in this period belongs to clients with no dealer mapped yet — not a real dealer, just clients waiting to be assigned in Clients.
        </div>
      )}

      <Card style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <SectionTitle>Today's upload — client-wise breakdown ({latestD.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })})</SectionTitle>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input placeholder="Search code, name, dealer, RM" value={todaySearch} onChange={(e) => setTodaySearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 240 }} />
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
              {todaySorted.length === 0 && <tr><td colSpan={5} style={{ color: INK_SOFT, textAlign: "center", padding: 16 }}>No matching rows.</td></tr>}
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
          <LineChart data={trend} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
            <CartesianGrid stroke={LINE} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: INK_SOFT }} axisLine={{ stroke: LINE }} tickLine={false} />
            <YAxis tickFormatter={fmtINR} tick={{ fontSize: 11, fill: INK_SOFT }} axisLine={false} tickLine={false} width={60} />
            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12.5 }} />
            <Line type="monotone" dataKey="value" stroke={BLUE} strokeWidth={2.6} dot={{ r: 2.5 }} name="Net Brokerage" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <Card style={{ padding: 18 }}>
          <SectionTitle>Dealer-wise net brokerage ({period})</SectionTitle>
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
          <SectionTitle>Dealer share ({period})</SectionTitle>
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
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={topClients} layout="vertical" margin={{ top: 4, right: 20, left: 10, bottom: 4 }}>
            <CartesianGrid stroke={LINE} horizontal={false} />
            <XAxis type="number" tickFormatter={fmtINR} tick={{ fontSize: 11, fill: INK_SOFT }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11.5, fill: INK }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${LINE}`, fontSize: 12.5 }} />
            <Bar dataKey="value" fill={TEAL} radius={[0, 6, 6, 0]} name="Net Brokerage" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function ClientsTab({ master, allRecords, latestDebitByCode, dealerNames, isAdmin, onSave }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("month");
  const [editingCode, setEditingCode] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ code: "", name: "", dealer: "", rm: "", branch: "" });

  const now = new Date();
  const brokerageByCode = useMemo(() => {
    const map = {};
    const y = now.getFullYear(), m = now.getMonth(), q = quarterOf(now);
    allRecords.forEach((r) => {
      const d = parseISO(r.date);
      const match = period === "all" ? true
        : period === "month" ? (d.getFullYear() === y && d.getMonth() === m)
        : period === "quarter" ? (d.getFullYear() === y && quarterOf(d) === q)
        : (d.getFullYear() === y);
      if (match) map[normCode(r.code)] = (map[normCode(r.code)] || 0) + r.netBrok;
    });
    return map;
  }, [allRecords, period]);

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
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input placeholder="Search code, name, dealer, RM, branch" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 260 }} />
          </div>
          {isAdmin && (
            <button onClick={() => setAdding((a) => !a)} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: "none", background: TEAL, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              <Plus size={15} /> Add client
            </button>
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
            <input placeholder="RM" value={draft.rm} onChange={(e) => setDraft({ ...draft, rm: e.target.value })} style={inputStyle} />
            <input placeholder="Branch" value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} style={inputStyle} />
            <button onClick={addClient} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: EMERALD, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save</button>
          </div>
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
                    <td>{editing ? <input value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} style={{ ...inputStyle, width: 140 }} /> : r.name}</td>
                    <td>
                      {editing ? (
                        <select value={editDraft.dealer} onChange={(e) => setEditDraft({ ...editDraft, dealer: e.target.value })} style={{ ...inputStyle, width: 130 }}>
                          <option value="">—</option>
                          {dealerNames.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      ) : r.dealer ? <Badge text={r.dealer} color={dealerColor(r.dealer)} /> : <Badge text={UNMAPPED} color="#9AA1AC" />}
                    </td>
                    <td>{editing ? <input value={editDraft.rm} onChange={(e) => setEditDraft({ ...editDraft, rm: e.target.value })} style={{ ...inputStyle, width: 110 }} /> : <span style={{ color: INK_SOFT }}>{r.rm}</span>}</td>
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
    </div>
  );
}

function DealersTab({ master, dealerNames, allRecords, targets, isAdmin, onRename, onRemove, onAdd, onSaveTargets }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("month");
  const [newDealer, setNewDealer] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [targetDrafts, setTargetDrafts] = useState({});
  const inputRef = useRef(null);

  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), q = quarterOf(now);
  const brokerageByDealer = useMemo(() => {
    const map = {};
    allRecords.forEach((r) => {
      const d = parseISO(r.date);
      const match = period === "all" ? true
        : period === "month" ? (d.getFullYear() === y && d.getMonth() === m)
        : period === "quarter" ? (d.getFullYear() === y && quarterOf(d) === q)
        : (d.getFullYear() === y);
      if (match) map[r.dealer] = (map[r.dealer] || 0) + r.netBrok;
    });
    return map;
  }, [allRecords, period]);

  const clientCount = useMemo(() => {
    const c = {};
    master.forEach((m) => { if (m.dealer) c[m.dealer] = (c[m.dealer] || 0) + 1; });
    return c;
  }, [master]);

  const rows = dealerNames.filter((d) => !search || d.toLowerCase().includes(search.toLowerCase())).map((d) => ({
    dealer: d, clients: clientCount[d] || 0, brokerage: brokerageByDealer[d] || 0, target: targets.dealerMonthly?.[d] || 0,
  })).sort((a, b) => b.brokerage - a.brokerage);

  const saveTarget = (dealer) => {
    const v = Number(targetDrafts[dealer]);
    onSaveTargets({ ...targets, dealerMonthly: { ...targets.dealerMonthly, [dealer]: isNaN(v) ? 0 : v } });
  };

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
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: INK_SOFT }} />
            <input placeholder="Search dealer" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 30, width: 200 }} />
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 6 }}>
              <input ref={inputRef} placeholder="New dealer name" value={newDealer} onChange={(e) => setNewDealer(e.target.value)} style={inputStyle} />
              <button onClick={() => { onAdd(newDealer.trim()); setNewDealer(""); }} style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 14px", borderRadius: 8, border: "none", background: VIOLET, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                <Plus size={15} /> Add dealer
              </button>
            </div>
          )}
        </div>
      </div>

      <Card style={{ padding: 18 }}>
        <SectionTitle>Dealer performance ({period})</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Dealer</th><th>Clients</th><th>Net Brokerage</th><th>Monthly Target</th><th style={{ width: 150 }}>Progress</th>{isAdmin && <th></th>}</tr></thead>
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
                    <td>
                      {isAdmin ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="number" placeholder="0" defaultValue={r.target || ""} onChange={(e) => setTargetDrafts({ ...targetDrafts, [r.dealer]: e.target.value })} style={{ ...inputStyle, width: 100 }} />
                          <button onClick={() => saveTarget(r.dealer)} style={{ border: "none", background: "none", cursor: "pointer", color: BLUE, fontSize: 11.5, fontWeight: 700 }}>Save</button>
                        </div>
                      ) : (r.target ? fmtFull(r.target) : "—")}
                    </td>
                    <td>{monthPct !== null ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1 }}><ProgressBar pct={monthPct} /></div><span style={{ fontSize: 11.5, color: INK_SOFT, width: 34 }}>{monthPct.toFixed(0)}%</span></div> : <span style={{ color: "#B7BCC5", fontSize: 12 }}>{period === "month" ? "no target" : "monthly only"}</span>}</td>
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
              {rows.length === 0 && <tr><td colSpan={6} style={{ color: INK_SOFT, textAlign: "center", padding: 20 }}>No dealers yet — add one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function UploadTab({ dailyDates, dailyData, debitDates, debitData, masterByCode, onSaveDaily, onDeleteDaily, onSaveDebit, onDeleteDebit, showToast }) {
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

function UploadPane({ title, accent, accentSoft, helperText, sampleName, sampleHeader, sampleRows, parseFn, dates, data, onSave, onDelete, valueKey, valueLabel, masterByCode, showToast }) {
  const [pending, setPending] = useState(null);
  const [dateInput, setDateInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const onFile = async (file) => {
    if (!file) return;
    const wb = await readWorkbook(file);
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
    const { records, error } = parseFn(rows);
    if (error) { showToast(error, "red"); return; }
    const guessDate = guessDateFromFilename(sheetName.match(/\d{6,8}/) ? sheetName : file.name);
    setPending({ records, count: records.length, total: records.reduce((s, r) => s + r[valueKey], 0), fileName: file.name });
    setDateInput(isoDate(guessDate));
  };
  const confirmSave = async () => { if (!pending || !dateInput) return; await onSave(dateInput, pending.records); setPending(null); };
  const rows = [...dates].sort().reverse();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card style={{ padding: 22 }}>
        <SectionTitle>{title}</SectionTitle>
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
            <div style={{ fontSize: 13.5 }}>Parsed <strong>{pending.fileName}</strong> — {pending.count} clients, total {valueLabel.toLowerCase()} <strong>{fmtFull(pending.total)}</strong></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12.5, color: INK_SOFT }}>Report date:</label>
              <input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${LINE}` }} />
              <button onClick={confirmSave} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: EMERALD, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save to dashboard</button>
              <button onClick={() => setPending(null)} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK_SOFT, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              {dates.includes(dateInput) && <span style={{ fontSize: 12, color: RED }}>This date already has data — saving will overwrite it.</span>}
            </div>
          </div>
        )}
      </Card>

      <Card style={{ padding: 18 }}>
        <SectionTitle>Uploaded reports ({rows.length})</SectionTitle>
        {rows.length === 0 ? <div style={{ fontSize: 13.5, color: INK_SOFT }}>Nothing uploaded yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Date</th><th>Clients</th><th>{valueLabel}</th><th>Unmapped</th><th></th></tr></thead>
              <tbody>
                {rows.map((d) => {
                  const recs = data[d] || [];
                  const total = recs.reduce((s, r) => s + r[valueKey], 0);
                  const unmapped = recs.filter((r) => !masterByCode[normCode(r.code)]).length;
                  return (
                    <tr key={d}>
                      <td style={{ fontWeight: 600 }}>{parseISO(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td>{recs.length}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtFull(total)}</td>
                      <td>{unmapped > 0 ? <span style={{ color: GOLD, fontWeight: 700 }}>{unmapped}</span> : <span style={{ color: EMERALD }}>0</span>}</td>
                      <td><button onClick={() => onDelete(d)} title="Remove this date" style={{ border: "none", background: "none", cursor: "pointer", color: RED, display: "flex", alignItems: "center" }}><Trash2 size={15} /></button></td>
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

function TargetsTab({ targets, onSave }) {
  const [monthly, setMonthly] = useState(targets.monthly || 0);
  const save = () => onSave({ ...targets, monthly: Number(monthly) || 0 });
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
      <button onClick={save} style={{ alignSelf: "flex-start", padding: "10px 22px", borderRadius: 9, border: "none", background: ROSE, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>Save target</button>
    </div>
  );
}
