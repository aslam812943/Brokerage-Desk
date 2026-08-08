import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Per-dealer report for an arbitrary date range: clients currently mapped to
// the dealer (independent of the range), how many of them actually traded
// within the range, and the dealer's Total/Net brokerage for that range —
// same Kotak-share and RM-split math as the Dealers tab (splitShares()),
// just aggregated in SQL instead of reduced client-side.
export async function GET(req) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from && !ISO_DATE.test(from)) return NextResponse.json({ error: "Invalid 'from' date" }, { status: 400 });
  if (to && !ISO_DATE.test(to)) return NextResponse.json({ error: "Invalid 'to' date" }, { status: 400 });

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
