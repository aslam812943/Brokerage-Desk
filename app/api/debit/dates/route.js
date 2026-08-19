import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireSession, viewerClientWhere } from "../../../../lib/apiAuth";

// Matches the normCode() convention used client-side (Dashboard.jsx) for
// joining MasterClient <-> DebitRecord by code.
const normCode = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "");

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  // Admins see every debit report date — one indexed DISTINCT query.
  if (session.user.role === "ADMIN") {
    const rows = await prisma.debitRecord.findMany({
      distinct: ["date"],
      select: { date: true },
      orderBy: { date: "desc" },
    });
    return NextResponse.json(rows.map((r) => r.date));
  }

  // A dealer or RM (VIEWER) login only sees dates where at least one of
  // their own clients has a record — same scoping /api/debit applies today,
  // but this only pulls the two columns needed to compute it instead of full rows.
  const clients = await prisma.masterClient.findMany({
    where: viewerClientWhere(session.user.name),
    select: { code: true },
  });
  const allowedCodes = new Set(clients.map((c) => normCode(c.code)));
  if (!allowedCodes.size) return NextResponse.json([]);

  const rows = await prisma.debitRecord.findMany({ select: { code: true, date: true } });
  const dates = new Set();
  for (const r of rows) { if (allowedCodes.has(normCode(r.code))) dates.add(r.date); }
  return NextResponse.json([...dates].sort().reverse());
}
