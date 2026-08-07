import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireSession } from "../../../../lib/apiAuth";

// Matches the normCode() convention used client-side (Dashboard.jsx) for
// joining MasterClient <-> DailyRecord by code.
const normCode = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "");

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  // Admins see every upload date — one indexed DISTINCT query, no join needed.
  if (session.user.role === "ADMIN") {
    const rows = await prisma.dailyRecord.findMany({
      distinct: ["date"],
      select: { date: true },
      orderBy: { date: "desc" },
    });
    return NextResponse.json(rows.map((r) => r.date));
  }

  // A dealer (VIEWER) login only sees dates where at least one of their own
  // clients has a record — same scoping /api/daily applies today, but this
  // only pulls the two columns needed to compute it instead of full rows.
  const clients = await prisma.masterClient.findMany({
    where: { dealer: { equals: session.user.name, mode: "insensitive" } },
    select: { code: true },
  });
  const allowedCodes = new Set(clients.map((c) => normCode(c.code)));
  if (!allowedCodes.size) return NextResponse.json([]);

  const rows = await prisma.dailyRecord.findMany({ select: { code: true, date: true } });
  const dates = new Set();
  for (const r of rows) { if (allowedCodes.has(normCode(r.code))) dates.add(r.date); }
  return NextResponse.json([...dates].sort().reverse());
}
