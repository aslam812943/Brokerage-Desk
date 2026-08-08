import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";

// Per-date, per-source count/total/unmapped — backs the Upload tab's history
// list and its duplicate-source guard. Deliberately never returns a raw row:
// the table this reduces over grows without bound (150k+ rows/day in
// production), so a per-date/source aggregate is the only shape that stays
// cheap regardless of how much history accumulates. For the one raw-row use
// case that's left (Missing Finder's reconciliation diff), fetch that single
// date via /api/daily/[date] instead.
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const rows = await prisma.$queryRaw`
    SELECT
      dr.date AS date,
      dr.source AS source,
      COUNT(*)::int AS count,
      COALESCE(SUM(dr."netBrok"), 0)::float8 AS total,
      COUNT(*) FILTER (WHERE m."codeNorm" IS NULL)::int AS unmapped
    FROM "DailyRecord" dr
    LEFT JOIN "MasterClient" m ON m."codeNorm" = dr."codeNorm"
    GROUP BY dr.date, dr.source
    ORDER BY dr.date DESC
  `;

  const byDate = {};
  for (const r of rows) {
    if (!byDate[r.date]) byDate[r.date] = {};
    byDate[r.date][r.source || ""] = { count: r.count, total: r.total, unmapped: r.unmapped };
  }
  return NextResponse.json(byDate);
}
