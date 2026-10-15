import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { requireSession, viewerClientWhere } from "../../../../lib/apiAuth";

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  // Admins see every upload date — one indexed DISTINCT query, no join needed.
  if (session.user.role === "ADMIN") {
    const rows = await prisma.$queryRaw`SELECT DISTINCT date FROM "DailyRecord" ORDER BY date DESC`;
    return NextResponse.json(rows.map((r) => r.date));
  }

  // A dealer or RM (VIEWER) login only sees dates where at least one of
  // their own clients has a record. Filter and deduplicate inside Postgres
  // so response size depends on dates, not the number of brokerage records.
  const clients = await prisma.masterClient.findMany({
    where: viewerClientWhere(session.user.viewerName),
    select: { codeNorm: true },
  });
  const allowedCodes = clients.map((c) => c.codeNorm).filter(Boolean);
  if (!allowedCodes.length) return NextResponse.json([]);

  const rows = await prisma.$queryRaw`
    SELECT DISTINCT date FROM "DailyRecord"
    WHERE "codeNorm" IN (${Prisma.join(allowedCodes)})
    ORDER BY date DESC
  `;
  return NextResponse.json(rows.map((r) => r.date));
}
