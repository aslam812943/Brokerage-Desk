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

  const [registryDealers, mappedCounts, tradedRows] = await Promise.all([
    prisma.dealer.findMany({ select: { name: true } }),
    prisma.masterClient.groupBy({ by: ["dealer"], where: { dealer: { not: "" } }, _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT
        m.dealer AS dealer,
        COUNT(DISTINCT dr."codeNorm")::int AS "tradedClients",
        COALESCE(SUM(CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END), 0)::float8 AS "totalBrokerage",
        COALESCE(SUM(
          (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END)
          * (CASE
              WHEN COALESCE(m.rm, '') = '' THEN 100
              WHEN lower(m.dealer) = lower(m.rm) THEN 100
              ELSE 100 - ${rmSplitPct}::float8
            END) / 100.0
        ), 0)::float8 AS "netBrokerage"
      FROM "DailyRecord" dr
      JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
      WHERE m.dealer <> '' ${dateFilter}
      GROUP BY m.dealer
    `,
  ]);

  const mappedByDealer = Object.fromEntries(mappedCounts.map((r) => [r.dealer, r._count._all]));
  const tradedByDealer = Object.fromEntries(tradedRows.map((r) => [r.dealer, r]));

  const dealerNames = new Set([
    ...registryDealers.map((d) => d.name),
    ...Object.keys(mappedByDealer),
    ...Object.keys(tradedByDealer),
  ]);

  const rows = Array.from(dealerNames).map((dealer) => ({
    dealer,
    clientsMapped: mappedByDealer[dealer] || 0,
    tradedClients: tradedByDealer[dealer]?.tradedClients || 0,
    totalBrokerage: tradedByDealer[dealer]?.totalBrokerage || 0,
    netBrokerage: tradedByDealer[dealer]?.netBrokerage || 0,
  })).sort((a, b) => b.totalBrokerage - a.totalBrokerage);

  return NextResponse.json({ from: from || null, to: to || null, rows });
}
