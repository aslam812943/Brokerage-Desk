import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";

// Per-date count/total/unmapped for DebitRecord — same rationale as
// /api/daily/summary. DebitRecord has no codeNorm generated column (unlike
// DailyRecord/MasterClient), so the match is done inline here with the same
// normalization normCode() uses client-side (trim, uppercase, strip
// whitespace) instead of via a join column.
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const rows = await prisma.$queryRaw`
    SELECT
      dr.date AS date,
      COUNT(*)::int AS count,
      COALESCE(SUM(dr.debit), 0)::float8 AS total,
      COUNT(*) FILTER (WHERE m."codeNorm" IS NULL)::int AS unmapped
    FROM "DebitRecord" dr
    LEFT JOIN "MasterClient" m ON m."codeNorm" = upper(regexp_replace(dr.code, '\s+', '', 'g'))
    GROUP BY dr.date
    ORDER BY dr.date DESC
  `;

  const byDate = {};
  for (const r of rows) byDate[r.date] = { count: r.count, total: r.total, unmapped: r.unmapped };
  return NextResponse.json(byDate);
}
