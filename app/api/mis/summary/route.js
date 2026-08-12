import { NextResponse } from "next/server";
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

// Mirrors ReportsTab's incentiveFor() on the client: null salary means "not
// set", kept separate from a genuine 0 so the UI renders "—" not "0x".
function buildPersonSummary(name, aggByPerson, mappedByDealer, dealerMonthly, tradingDays, dealerSalary, incentiveMultiplier) {
  const agg = aggByPerson[name.toLowerCase()];
  const target = Number(caseInsensitiveGet(dealerMonthly, name)) || 0;
  const clientsMapped = Number(caseInsensitiveGet(mappedByDealer, name)) || 0;
  const mtdRevenue = agg?.mtd || 0;
  const rawSalary = Number(caseInsensitiveGet(dealerSalary, name));
  const hasSalary = !isNaN(rawSalary) && rawSalary > 0;
  const multiplier = hasSalary ? mtdRevenue / rawSalary : null;
  const eligible = hasSalary && multiplier >= incentiveMultiplier;
  return {
    dealer: name,
    target,
    dailyTarget: tradingDays > 0 ? target / tradingDays : 0,
    tradingDaysInMonth: tradingDays,
    mtdRevenue,
    yesterdayRevenue: agg?.yesterday || 0,
    clientsMapped,
    tradedClientsCount: agg?.tradedCount || 0,
    tradedClients: agg?.tradedClients || [],
    salary: hasSalary ? rawSalary : null,
    incentiveMultiplier,
    multiplier,
    incentiveEligible: eligible,
  };
}

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;
  const isAdmin = session.user.role === "ADMIN";

  const now = new Date();

  // Everything below except the person-aggregate query is independent of
  // latestDate/prevDate, so it's fetched in the same round trip as the
  // latest/prev-date lookup itself — one query pair replacing what used to
  // be a sequential latest->prev chain plus a separate 3-query batch. This
  // (and folding the two heavy month-wide raw-SQL scans below into one) is
  // what actually overloaded the connection pool last time: 8 round trips
  // per tab-open, several of them full-month table scans, on a pool sized
  // for 3 concurrent connections total.
  const [dateRows, targetsRow, mappedCounts, holidays] = await Promise.all([
    prisma.$queryRaw`SELECT DISTINCT date FROM "DailyRecord" ORDER BY date DESC LIMIT 2`,
    prisma.targets.findUnique({ where: { id: 1 } }),
    prisma.masterClient.groupBy({ by: ["dealer"], where: { dealer: { not: "" } }, _count: { _all: true } }),
    prisma.tradingHoliday.findMany({ select: { date: true } }),
  ]);

  const latestDate = dateRows[0]?.date ?? isoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const prevDate = dateRows[1]?.date ?? null;

  const [y, m0] = latestDate.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n));
  const mStart = isoDate(y, m0, 1);

  const kotakSharePct = targetsRow?.kotakSharePct ?? 85;
  const rmSplitPct = targetsRow?.rmSplitPct ?? 50;
  const dealerMonthly = targetsRow?.dealerMonthly ?? {};
  const dealerSalary = targetsRow?.dealerSalary ?? {};
  const incentiveMultiplier = targetsRow?.incentiveMultiplier ?? 10;
  const mappedByDealer = Object.fromEntries(mappedCounts.map((r) => [r.dealer, r._count._all]));
  const holidaySet = new Set(holidays.map((h) => h.date));
  const tradingDays = tradingDaysInMonth(y, m0, holidaySet);

  // Single pass over the month's records: person_rows is built once and read
  // twice (the revenue aggregates and the traded-clients list, via a
  // correlated subquery against per_client), instead of the previous
  // version's two separate top-level queries that each rebuilt person_rows
  // from scratch over the same month-wide join.
  const personRows = await prisma.$queryRaw`
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
    ),
    per_client AS (
      SELECT person, code, MAX(name) AS name, role, SUM(amt) AS client_amt
      FROM person_rows
      GROUP BY person, code, role
    )
    SELECT pr.person,
           COALESCE(SUM(pr.amt), 0)::float8 AS mtd,
           COALESCE(SUM(pr.amt) FILTER (WHERE pr.date = ${prevDate ?? ""}), 0)::float8 AS yesterday,
           COUNT(DISTINCT pr.code)::int AS "tradedCount",
           (
             SELECT jsonb_agg(jsonb_build_object('code', pc.code, 'name', pc.name, 'role', pc.role) ORDER BY pc.code)
             FROM per_client pc WHERE pc.person = pr.person
           ) AS "tradedClients"
    FROM person_rows pr
    GROUP BY pr.person
  `;
  const aggByPerson = Object.fromEntries(personRows.map((r) => [r.person.toLowerCase(), r]));

  if (!isAdmin) {
    const dealer = await resolveOwnDealerName(session.user.name);
    return NextResponse.json({
      latestDate,
      prevDate,
      ...buildPersonSummary(dealer, aggByPerson, mappedByDealer, dealerMonthly, tradingDays, dealerSalary, incentiveMultiplier),
    });
  }

  // Dealer registry + any ad-hoc dealer names only present on MasterClient,
  // deduped in SQL (one round trip) rather than two queries unioned client-side.
  const dealerNameRows = await prisma.$queryRaw`
    SELECT name FROM "Dealer"
    UNION
    SELECT dealer AS name FROM "MasterClient" WHERE dealer <> ''
  `;
  const dealerNames = dealerNameRows.map((r) => r.name);

  const rows = dealerNames
    .map((name) => buildPersonSummary(name, aggByPerson, mappedByDealer, dealerMonthly, tradingDays, dealerSalary, incentiveMultiplier))
    .sort((a, b) => b.mtdRevenue - a.mtdRevenue);

  return NextResponse.json({ latestDate, prevDate, rows });
}
