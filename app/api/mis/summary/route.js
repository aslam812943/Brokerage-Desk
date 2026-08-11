import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { requireSession } from "../../../../lib/apiAuth";

function isoDate(y, m0, d) { return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

// Weekdays (Mon-Fri) in the given month, minus any admin-entered trading
// holiday that falls in it — the denominator for each dealer's Daily Target.
function tradingDaysInMonth(year, month0, holidaySet) {
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month0, d).getDay();
    if (dow === 0 || dow === 6) continue;
    if (holidaySet.has(isoDate(year, month0, d))) continue;
    count++;
  }
  return count;
}

async function resolveOwnDealerName(username) {
  const dealerMatch = await prisma.dealer.findFirst({ where: { name: { equals: username, mode: "insensitive" } } });
  if (dealerMatch) return dealerMatch.name;
  const clientMatch = await prisma.masterClient.findFirst({
    where: { dealer: { equals: username, mode: "insensitive" } },
    select: { dealer: true },
  });
  return clientMatch ? clientMatch.dealer : username;
}

function caseInsensitiveGet(obj, key) {
  const matchKey = Object.keys(obj || {}).find((k) => k.toLowerCase() === key.toLowerCase());
  return matchKey ? obj[matchKey] : undefined;
}

function buildPersonSummary(name, aggByPerson, clientsByPerson, mappedByDealer, dealerMonthly, tradingDays) {
  const agg = aggByPerson[name.toLowerCase()];
  const target = Number(caseInsensitiveGet(dealerMonthly, name)) || 0;
  const clientsMapped = Number(caseInsensitiveGet(mappedByDealer, name)) || 0;
  return {
    dealer: name,
    target,
    dailyTarget: tradingDays > 0 ? target / tradingDays : 0,
    tradingDaysInMonth: tradingDays,
    mtdRevenue: agg?.mtd || 0,
    yesterdayRevenue: agg?.yesterday || 0,
    clientsMapped,
    tradedClientsCount: agg?.tradedCount || 0,
    tradedClients: clientsByPerson[name.toLowerCase()] || [],
  };
}

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;
  const isAdmin = session.user.role === "ADMIN";

  const now = new Date();
  const latest = await prisma.dailyRecord.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  const latestDate = latest?.date ?? isoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const prev = latest
    ? await prisma.dailyRecord.findFirst({
        where: { date: { lt: latestDate } },
        orderBy: { date: "desc" },
        select: { date: true },
        distinct: ["date"],
      })
    : null;
  const prevDate = prev?.date ?? null;

  const [y, m0] = latestDate.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n));
  const mStart = isoDate(y, m0, 1);

  const [targetsRow, mappedCounts, holidays] = await Promise.all([
    prisma.targets.findUnique({ where: { id: 1 } }),
    prisma.masterClient.groupBy({ by: ["dealer"], where: { dealer: { not: "" } }, _count: { _all: true } }),
    prisma.tradingHoliday.findMany({ select: { date: true } }),
  ]);
  const kotakSharePct = targetsRow?.kotakSharePct ?? 85;
  const rmSplitPct = targetsRow?.rmSplitPct ?? 50;
  const dealerMonthly = targetsRow?.dealerMonthly ?? {};
  const mappedByDealer = Object.fromEntries(mappedCounts.map((r) => [r.dealer, r._count._all]));
  const holidaySet = new Set(holidays.map((h) => h.date));
  const tradingDays = tradingDaysInMonth(y, m0, holidaySet);

  // The same CTE chain feeds two separate final SELECTs below: revenue needs
  // per-date granularity (for the yesterday FILTER), but the traded-clients
  // list needs per-(person, code) granularity first — a client re-uploaded
  // under two slightly different name spellings within the month must still
  // collapse to one list entry, not one per spelling.
  const personRowsSql = (finalSelect) => prisma.$queryRaw`
    WITH records AS (
      SELECT dr.date, dr.code, dr.name,
             COALESCE(NULLIF(m.dealer, ''), '') AS dealer,
             COALESCE(NULLIF(m.rm, ''), '') AS rm,
             (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS "netRaw"
      FROM "DailyRecord" dr
      LEFT JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
      WHERE dr.date >= ${mStart} AND dr.date <= ${latestDate}
    ),
    split AS (
      SELECT *,
        (CASE WHEN dealer = '' THEN 0 WHEN rm = '' THEN 100 WHEN lower(dealer) = lower(rm) THEN 100 ELSE 100 - ${rmSplitPct}::float8 END) AS "dealerPct",
        (CASE WHEN rm = '' THEN 0 WHEN dealer = '' THEN 100 WHEN lower(dealer) = lower(rm) THEN 0 ELSE ${rmSplitPct}::float8 END) AS "rmPct"
      FROM records
    ),
    person_rows AS (
      SELECT dealer AS person, date, code, name, "netRaw" * "dealerPct" / 100.0 AS amt, 'dealer' AS role FROM split WHERE dealer <> ''
      UNION ALL
      SELECT rm AS person, date, code, name, "netRaw" * "rmPct" / 100.0 AS amt, 'rm' AS role FROM split WHERE rm <> '' AND lower(rm) <> lower(dealer)
    )
    ${finalSelect}
  `;

  const [revenueRows, clientRows] = await Promise.all([
    personRowsSql(Prisma.sql`
      SELECT person,
             COALESCE(SUM(amt), 0)::float8 AS mtd,
             COALESCE(SUM(amt) FILTER (WHERE date = ${prevDate ?? ""}), 0)::float8 AS yesterday,
             COUNT(DISTINCT code)::int AS "tradedCount"
      FROM person_rows
      GROUP BY person
    `),
    personRowsSql(Prisma.sql`
      SELECT person, jsonb_agg(jsonb_build_object('code', code, 'name', name, 'role', role) ORDER BY code) AS "tradedClients"
      FROM (
        SELECT person, code, MAX(name) AS name, role
        FROM person_rows
        GROUP BY person, code, role
      ) per_client
      GROUP BY person
    `),
  ]);
  const aggByPerson = Object.fromEntries(revenueRows.map((r) => [r.person.toLowerCase(), r]));
  const clientsByPerson = Object.fromEntries(clientRows.map((r) => [r.person.toLowerCase(), r.tradedClients]));

  if (!isAdmin) {
    const dealer = await resolveOwnDealerName(session.user.name);
    return NextResponse.json({
      latestDate,
      prevDate,
      ...buildPersonSummary(dealer, aggByPerson, clientsByPerson, mappedByDealer, dealerMonthly, tradingDays),
    });
  }

  const [registryDealers, clientDealers] = await Promise.all([
    prisma.dealer.findMany({ select: { name: true } }),
    prisma.masterClient.findMany({ where: { dealer: { not: "" } }, select: { dealer: true }, distinct: ["dealer"] }),
  ]);
  const dealerNames = [...new Set([...registryDealers.map((r) => r.name), ...clientDealers.map((r) => r.dealer)])];

  const rows = dealerNames
    .map((name) => buildPersonSummary(name, aggByPerson, clientsByPerson, mappedByDealer, dealerMonthly, tradingDays))
    .sort((a, b) => b.mtdRevenue - a.mtdRevenue);

  return NextResponse.json({ latestDate, prevDate, rows });
}
