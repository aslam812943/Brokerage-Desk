import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";

// GET — every client grouped by the (IST) day it was added, newest first.
// Backs the "Clients by added date" list on the Clients tab, which is the
// only handle on uploads that predate per-upload tracking (createdAt was
// backfilled from updatedAt by the add_client_upload_history migration).
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  // createdAt is stored UTC (timestamp without tz) — tag it UTC, then shift
  // to Asia/Kolkata before truncating so the grouping matches the dates the
  // table's "Added" column renders in the user's (IST) locale.
  const rows = await prisma.$queryRaw`
    SELECT ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date)::text AS date,
           COUNT(*)::int AS count
    FROM "MasterClient"
    GROUP BY 1
    ORDER BY 1 DESC
  `;
  return NextResponse.json(rows);
}
