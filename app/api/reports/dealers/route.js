import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(y, m0, d) { return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

// Per-dealer report for an arbitrary date range: clients currently mapped to
// the dealer (independent of the range), how many of them actually traded
// within the range, and the dealer's Total/Net brokerage for that range —
// same Kotak-share and RM-split math as the Dealers tab (splitShares()),
// just aggregated in SQL instead of reduced client-side.
export async function GET(req) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  let from = searchParams.get("from");
  let to = searchParams.get("to");
  if (from && !ISO_DATE.test(from)) return NextResponse.json({ error: "Invalid 'from' date" }, { status: 400 });
  if (to && !ISO_DATE.test(to)) return NextResponse.json({ error: "Invalid 'to' date" }, { status: 400 });

  // A preset period (month/quarter/year) is resolved here relative to the
  // latest UPLOADED date, not the real calendar date — matches the Dashboard
  // tab, so "Month" always lands on the most recent month with real data
  // instead of going empty when today's actual report hasn't been uploaded
  // yet. Ignored once an explicit custom from/to is supplied.
  const period = searchParams.get("period");
  if (!from && !to && period && period !== "all") {
    if (!["month", "quarter", "year"].includes(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    const latest = await prisma.dailyRecord.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
    const [y, m0] = latest
      ? latest.date.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n))
      : [new Date().getFullYear(), new Date().getMonth()];
    from = period === "month" ? isoDate(y, m0, 1) : period === "quarter" ? isoDate(y, Math.floor(m0 / 3) * 3, 1) : isoDate(y, 0, 1);
    to = latest?.date ?? isoDate(y, m0, 1);
  }

  const targets = await prisma.targets.findUnique({ where: { id: 1 } });
  const kotakSharePct = targets?.kotakSharePct ?? 85;
  const rmSplitPct = targets?.rmSplitPct ?? 50;

  const dateFilter = Prisma.sql`
    ${from ? Prisma.sql`AND dr.date >= ${from}` : Prisma.empty}
    ${to ? Prisma.sql`AND dr.date <= ${to}` : Prisma.empty}
  `;

  // Month-over-month comparison (previous month vs. this range, plus a
  // dormant-client follow-up list) only makes sense when the range starts
  // on the 1st of a month — the "Month" preset always resolves that way,
  // and so does any custom range the admin deliberately starts on the 1st.
  // `to` doesn't need to reach month-end (a partial "month so far" range
  // still has a well-defined previous month to compare against).
  const showMonthComparison = !!(from && to && from.split("-")[2] === "01");
  let prevMonthStart = null;
  if (showMonthComparison) {
    const [fy, fm0] = from.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n));
    const prevM0 = fm0 === 0 ? 11 : fm0 - 1;
    const prevY = fm0 === 0 ? fy - 1 : fy;
    prevMonthStart = isoDate(prevY, prevM0, 1);
  }

  const [registryDealers, mappedCounts, tradedRows, comparisonRows] = await Promise.all([
    prisma.dealer.findMany({ select: { name: true } }),
    prisma.masterClient.groupBy({ by: ["dealer"], where: { dealer: { not: "" } }, _count: { _all: true } }),
    prisma.$queryRaw`
      -- Per-client sums first (grouped by dealer/codeNorm/rm) so "traded"
      -- can require a nonzero net brokerage for the range, same fix as the
      -- MIS traded-client count — a client can have a DailyRecord row in
      -- range with brokerage summing to exactly 0, which shouldn't count
      -- as having traded. totalBrokerage/netBrokerage sums are unchanged.
      WITH per_client AS (
        SELECT m.dealer AS dealer, dr."codeNorm" AS "codeNorm", m.rm AS rm,
               SUM(CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS client_amt
        FROM "DailyRecord" dr
        JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
        WHERE m.dealer <> '' ${dateFilter}
        GROUP BY m.dealer, dr."codeNorm", m.rm
      )
      SELECT
        dealer,
        COUNT(*) FILTER (WHERE client_amt <> 0)::int AS "tradedClients",
        COALESCE(SUM(client_amt), 0)::float8 AS "totalBrokerage",
        COALESCE(SUM(
          client_amt * (CASE
              WHEN COALESCE(rm, '') = '' THEN 100
              WHEN lower(dealer) = lower(rm) THEN 100
              ELSE 100 - ${rmSplitPct}::float8
            END) / 100.0
        ), 0)::float8 AS "netBrokerage"
      FROM per_client
      GROUP BY dealer
    `,
    showMonthComparison
      ? prisma.$queryRaw`
          -- Previous-month figures + a dormant-client list (traded last
          -- month, not yet in this range) — "traded" identity here matches
          -- tradedClients above: raw per-client brokerage nonzero, before
          -- the RM split. Scans back to prevMonthStart in one pass, tagged
          -- by period, instead of a second full table scan.
          WITH records AS (
            SELECT dr.date, dr."codeNorm" AS "codeNorm", dr.code, dr.name, m.dealer AS dealer, m.rm AS rm,
                   (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS "netRaw",
                   (CASE WHEN dr.date >= ${from} THEN 'current' ELSE 'previous' END) AS period
            FROM "DailyRecord" dr
            JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
            WHERE m.dealer <> '' AND dr.date >= ${prevMonthStart} AND dr.date <= ${to}
          ),
          per_client AS (
            SELECT dealer, period, "codeNorm", MAX(code) AS code, MAX(name) AS name, rm,
                   SUM("netRaw") AS client_amt
            FROM records
            GROUP BY dealer, period, "codeNorm", rm
          )
          SELECT dealer,
                 (SELECT COUNT(*) FROM per_client pc WHERE pc.dealer = base.dealer AND pc.period = 'previous' AND pc.client_amt <> 0)::int AS "prevTradedClients",
                 (SELECT COALESCE(SUM(pc.client_amt), 0) FROM per_client pc WHERE pc.dealer = base.dealer AND pc.period = 'previous')::float8 AS "prevTotalBrokerage",
                 (
                   SELECT COALESCE(SUM(pc.client_amt * (CASE WHEN COALESCE(pc.rm, '') = '' THEN 100 WHEN lower(pc.dealer) = lower(pc.rm) THEN 100 ELSE 100 - ${rmSplitPct}::float8 END) / 100.0), 0)
                   FROM per_client pc WHERE pc.dealer = base.dealer AND pc.period = 'previous'
                 )::float8 AS "prevNetBrokerage",
                 (
                   SELECT COUNT(*) FROM per_client pcPrev
                   WHERE pcPrev.dealer = base.dealer AND pcPrev.period = 'previous' AND pcPrev.client_amt <> 0
                     AND NOT EXISTS (
                       SELECT 1 FROM per_client pcCurr
                       WHERE pcCurr.dealer = pcPrev.dealer AND pcCurr."codeNorm" = pcPrev."codeNorm"
                         AND pcCurr.period = 'current' AND pcCurr.client_amt <> 0
                     )
                 )::int AS "dormantCount",
                 (
                   SELECT jsonb_agg(jsonb_build_object('code', pcPrev.code, 'name', pcPrev.name, 'lastMonthNetBrokerage', ROUND(pcPrev.client_amt::numeric, 2)) ORDER BY pcPrev.client_amt DESC)
                   FROM per_client pcPrev
                   WHERE pcPrev.dealer = base.dealer AND pcPrev.period = 'previous' AND pcPrev.client_amt <> 0
                     AND NOT EXISTS (
                       SELECT 1 FROM per_client pcCurr
                       WHERE pcCurr.dealer = pcPrev.dealer AND pcCurr."codeNorm" = pcPrev."codeNorm"
                         AND pcCurr.period = 'current' AND pcCurr.client_amt <> 0
                     )
                 ) AS "dormantClients"
          FROM (SELECT DISTINCT dealer FROM per_client) base
        `
      : Promise.resolve([]),
  ]);

  const mappedByDealer = Object.fromEntries(mappedCounts.map((r) => [r.dealer, r._count._all]));
  const tradedByDealer = Object.fromEntries(tradedRows.map((r) => [r.dealer, r]));
  const comparisonByDealer = Object.fromEntries(comparisonRows.map((r) => [r.dealer, r]));

  const dealerNames = new Set([
    ...registryDealers.map((d) => d.name),
    ...Object.keys(mappedByDealer),
    ...Object.keys(tradedByDealer),
  ]);

  const rows = Array.from(dealerNames).map((dealer) => {
    const cmp = comparisonByDealer[dealer];
    return {
      dealer,
      clientsMapped: mappedByDealer[dealer] || 0,
      tradedClients: tradedByDealer[dealer]?.tradedClients || 0,
      totalBrokerage: tradedByDealer[dealer]?.totalBrokerage || 0,
      netBrokerage: tradedByDealer[dealer]?.netBrokerage || 0,
      ...(showMonthComparison ? {
        prevTradedClients: cmp?.prevTradedClients || 0,
        prevTotalBrokerage: cmp?.prevTotalBrokerage || 0,
        prevNetBrokerage: cmp?.prevNetBrokerage || 0,
        dormantClientsCount: cmp?.dormantCount || 0,
        dormantClients: cmp?.dormantClients || [],
      } : {}),
    };
  }).sort((a, b) => b.totalBrokerage - a.totalBrokerage);

  return NextResponse.json({ from: from || null, to: to || null, monthComparison: showMonthComparison, rows });
}
