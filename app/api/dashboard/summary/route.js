import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { requireSession } from "../../../../lib/apiAuth";

const UNMAPPED = "Unmapped";

// "Today" in this app means the latest UPLOADED date, not the real calendar
// date (a report for the actual current day may not exist yet) — every
// period boundary below is relative to that, matching the Dashboard tab's
// existing client-side logic exactly.
function isoDate(y, m0, d) { return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

export async function GET(req) {
  const { session, response } = await requireSession();
  if (response) return response;

  const isAdmin = session.user.role === "ADMIN";
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "month";
  if (!["day", "month", "quarter", "year"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  // A dealer (VIEWER) login only ever sees its own clients — same scoping
  // /api/daily applies today, expressed here as a codeNorm allowlist so it
  // can be pushed into the SQL WHERE clause instead of filtered in JS.
  let allowedCodeNorms = null;
  if (!isAdmin) {
    const clients = await prisma.masterClient.findMany({
      where: { dealer: { equals: session.user.name, mode: "insensitive" } },
      select: { codeNorm: true },
    });
    allowedCodeNorms = clients.map((c) => c.codeNorm).filter(Boolean);
    if (!allowedCodeNorms.length) return NextResponse.json({ hasData: false });
  }
  const scopedWhere = allowedCodeNorms ? { codeNorm: { in: allowedCodeNorms } } : {};

  const latest = await prisma.dailyRecord.findFirst({
    where: scopedWhere,
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return NextResponse.json({ hasData: false });
  const latestDate = latest.date;

  const prev = await prisma.dailyRecord.findFirst({
    where: { ...scopedWhere, date: { lt: latestDate } },
    orderBy: { date: "desc" },
    select: { date: true },
    distinct: ["date"],
  });
  const prevDate = prev?.date ?? null;

  const last30 = await prisma.dailyRecord.findMany({
    where: scopedWhere,
    distinct: ["date"],
    select: { date: true },
    orderBy: { date: "desc" },
    take: 30,
  });
  const last30Dates = last30.map((r) => r.date).sort(); // ascending, for the chart

  const [y, m0] = latestDate.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n));
  const mStart = isoDate(y, m0, 1);
  const qStart = isoDate(y, Math.floor(m0 / 3) * 3, 1);
  const yStart = isoDate(y, 0, 1);

  const targets = await prisma.targets.findUnique({ where: { id: 1 } });
  const kotakSharePct = targets?.kotakSharePct ?? 85;
  const rmSplitPct = targets?.rmSplitPct ?? 50;

  // Every query below joins through this same shape: one row per DailyRecord,
  // carrying the Kotak-share-adjusted amount (netRaw) and the dealer's share
  // of it (dealerPct) — mirroring splitShares() in Dashboard.jsx exactly, so
  // dealerRows/trend/KPIs all agree with what the Dealers tab already shows.
  const scopeSql = allowedCodeNorms?.length
    ? Prisma.sql`AND dr."codeNorm" IN (${Prisma.join(allowedCodeNorms)})`
    : Prisma.empty;
  const perRecord = (dateFilterSql) => Prisma.sql`
    SELECT
      dr.date,
      dr.code,
      dr.name,
      COALESCE(NULLIF(m.dealer, ''), ${UNMAPPED}) AS dealer,
      (CASE WHEN dr.source = 'KOTAK' THEN dr."netBrok" * (${kotakSharePct}::float8 / 100.0) ELSE dr."netBrok" END) AS "netRaw",
      (CASE
        WHEN COALESCE(m.dealer, '') = '' AND COALESCE(m.rm, '') = '' THEN 0
        WHEN COALESCE(m.dealer, '') = '' THEN 0
        WHEN COALESCE(m.rm, '') = '' THEN 100
        WHEN lower(m.dealer) = lower(m.rm) THEN 100
        ELSE 100 - ${rmSplitPct}::float8
      END) AS "dealerPct"
    FROM "DailyRecord" dr
    LEFT JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
    WHERE ${dateFilterSql} ${scopeSql}
  `;
  const netExpr = isAdmin ? Prisma.sql`"netRaw"` : Prisma.sql`("netRaw" * "dealerPct" / 100.0)`;

  const periodFilter = {
    day: Prisma.sql`dr.date = ${latestDate}`,
    month: Prisma.sql`dr.date >= ${mStart} AND dr.date <= ${latestDate}`,
    quarter: Prisma.sql`dr.date >= ${qStart} AND dr.date <= ${latestDate}`,
    year: Prisma.sql`dr.date >= ${yStart} AND dr.date <= ${latestDate}`,
  }[period];

  const [kpiRows, dealerRows, topClientRows, trendRows] = await Promise.all([
    // KPI row — Today/T-1/MTD/QTD/YTD. Admin sees the undivided total; a
    // dealer login sees its own Net (post RM-split) share, same as netSum()
    // in Dashboard.jsx today.
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(net) FILTER (WHERE date = ${latestDate}), 0)::float8 AS today,
        COALESCE(SUM(net) FILTER (WHERE date = ${prevDate ?? ""}), 0)::float8 AS yesterday,
        COALESCE(SUM(net) FILTER (WHERE date >= ${mStart}), 0)::float8 AS mtd,
        COALESCE(SUM(net) FILTER (WHERE date >= ${qStart}), 0)::float8 AS qtd,
        COALESCE(SUM(net) FILTER (WHERE date >= ${yStart}), 0)::float8 AS ytd
      FROM (
        SELECT date, ${netExpr} AS net
        FROM (${perRecord(Prisma.sql`dr.date >= ${yStart} AND dr.date <= ${latestDate}`)}) x
      ) y
    `,
    // Dealer-wise Net brokerage for the selected period — always split-adjusted,
    // for both roles (matches the always-on dealerMap reduce in Dashboard.jsx).
    prisma.$queryRaw`
      SELECT dealer, COALESCE(SUM("netRaw" * "dealerPct" / 100.0), 0)::float8 AS value
      FROM (${perRecord(periodFilter)}) x
      GROUP BY dealer
      ORDER BY value DESC
    `,
    // Top 10 clients by their own raw brokerage for the period — unconditional,
    // no dealer/RM split applied (matches topClients in Dashboard.jsx).
    prisma.$queryRaw`
      SELECT code, max(name) AS name, SUM("netRaw")::float8 AS value
      FROM (${perRecord(periodFilter)}) x
      GROUP BY code
      ORDER BY value DESC
      LIMIT 10
    `,
    // Last 30 uploaded dates' totals, for the trend chart.
    last30Dates.length
      ? prisma.$queryRaw`
          SELECT date, COALESCE(SUM(${netExpr}), 0)::float8 AS value
          FROM (${perRecord(Prisma.sql`dr.date >= ${last30Dates[0]} AND dr.date <= ${latestDate}`)}) x
          GROUP BY date
          ORDER BY date ASC
        `
      : [],
  ]);

  const kpi = kpiRows[0] || { today: 0, yesterday: 0, mtd: 0, qtd: 0, ytd: 0 };
  const monthlyTarget = targets?.monthly || 0;

  return NextResponse.json({
    hasData: true,
    latestDate,
    prevDate,
    period,
    kpi: {
      today: kpi.today,
      yesterday: prevDate ? kpi.yesterday : null,
      mtd: kpi.mtd,
      qtd: kpi.qtd,
      ytd: kpi.ytd,
      monthlyTarget,
    },
    dealerRows: dealerRows.map((r) => ({ dealer: r.dealer, value: Math.round(r.value) })),
    topClients: topClientRows.map((r) => ({ code: r.code, name: r.name, value: r.value })),
    trend: (() => {
      const byDate = Object.fromEntries(trendRows.map((r) => [r.date, r.value]));
      return last30Dates.map((d) => ({ date: d, value: Math.round(byDate[d] || 0) }));
    })(),
  });
}
