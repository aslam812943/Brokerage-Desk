import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { requireSession } from "../../../../lib/apiAuth";

function isoDate(y, m0, d) { return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

export async function GET(req) {
  const { session, response } = await requireSession();
  if (response) return response;

  const isAdmin = session.user.role === "ADMIN";
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "all";
  if (!["month", "quarter", "year", "all"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  let allowedCodeNorms = null;
  if (!isAdmin) {
    const clients = await prisma.masterClient.findMany({
      where: { dealer: { equals: session.user.name, mode: "insensitive" } },
      select: { codeNorm: true },
    });
    allowedCodeNorms = clients.map((c) => c.codeNorm).filter(Boolean);
    if (!allowedCodeNorms.length) return NextResponse.json({ rows: [] });
  }

  const targets = await prisma.targets.findUnique({ where: { id: 1 } });
  const kotakSharePct = targets?.kotakSharePct ?? 85;
  const rmSplitPct = targets?.rmSplitPct ?? 50;

  const scopeSql = allowedCodeNorms?.length ? Prisma.sql`AND dr."codeNorm" IN (${Prisma.join(allowedCodeNorms)})` : Prisma.empty;

  // Bucketed relative to the latest UPLOADED date, not the real calendar
  // date — matches the Dashboard tab, so "Month" always lands on the most
  // recent month with real data instead of going empty when today's actual
  // report hasn't been uploaded yet.
  let y, m0;
  if (period !== "all") {
    const latest = await prisma.dailyRecord.findFirst({
      where: allowedCodeNorms?.length ? { codeNorm: { in: allowedCodeNorms } } : {},
      orderBy: { date: "desc" },
      select: { date: true },
    });
    [y, m0] = latest ? latest.date.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n)) : [new Date().getFullYear(), new Date().getMonth()];
  }
  const periodFilter = {
    all: Prisma.empty,
    month: Prisma.sql`AND dr.date >= ${isoDate(y, m0, 1)}`,
    quarter: Prisma.sql`AND dr.date >= ${isoDate(y, Math.floor(m0 / 3) * 3, 1)}`,
    year: Prisma.sql`AND dr.date >= ${isoDate(y, 0, 1)}`,
  }[period];

  // Each RM's Net Brokerage is their share of every client mapped to them —
  // same splitShares() math as the Dealers tab's split table, just grouped
  // by RM instead of by dealer.
  const rows = await prisma.$queryRaw`
    SELECT m.rm, COALESCE(SUM(
      (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END)
      * (CASE
          WHEN COALESCE(m.rm, '') = '' THEN 0
          WHEN COALESCE(m.dealer, '') = '' THEN 100
          WHEN lower(m.dealer) = lower(m.rm) THEN 0
          ELSE ${rmSplitPct}::float8
        END) / 100.0
    ), 0)::float8 AS value
    FROM "DailyRecord" dr
    JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
    WHERE m.rm <> '' ${periodFilter} ${scopeSql}
    GROUP BY m.rm
  `;

  return NextResponse.json({ rows: rows.map((r) => ({ rm: r.rm, netBrokerage: r.value })) });
}
