import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { requireSession, viewerClientWhere } from "../../../../lib/apiAuth";

// Per-client period brokerage — the one aggregate the Dealers tab's dealer
// totals, RM/Dealer split table, and per-dealer export all reduce through.
// Bounded by client count (thousands), not by transaction volume (grows
// forever), and small enough that everything downstream of it — grouping by
// dealer, applying splitShares() — is cheap to keep doing client-side.
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
      where: viewerClientWhere(session.user.name),
      select: { codeNorm: true },
    });
    allowedCodeNorms = clients.map((c) => c.codeNorm).filter(Boolean);
    if (!allowedCodeNorms.length) return NextResponse.json({ rows: [] });
  }

  const targets = await prisma.targets.findUnique({ where: { id: 1 } });
  const kotakSharePct = targets?.kotakSharePct ?? 85;
  const scopeSql = allowedCodeNorms?.length ? Prisma.sql`AND "codeNorm" IN (${Prisma.join(allowedCodeNorms)})` : Prisma.empty;

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
    month: Prisma.sql`AND date >= ${isoDate(y, m0, 1)}`,
    quarter: Prisma.sql`AND date >= ${isoDate(y, Math.floor(m0 / 3) * 3, 1)}`,
    year: Prisma.sql`AND date >= ${isoDate(y, 0, 1)}`,
  }[period];

  const rows = await prisma.$queryRaw`
    SELECT "codeNorm" AS code, SUM(
      CASE WHEN source = 'KOTAK' THEN "netBrok" * (${kotakSharePct}::float8 / 100.0) ELSE "netBrok" END
    )::float8 AS value
    FROM "DailyRecord"
    WHERE true ${periodFilter} ${scopeSql}
    GROUP BY "codeNorm"
  `;

  return NextResponse.json({ rows });
}
