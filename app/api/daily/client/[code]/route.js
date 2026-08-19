import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireSession } from "../../../../../lib/apiAuth";

const normCode = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "");

// Every DailyRecord row for one client, across all dates/sources — bounded
// by that one client's own upload history, not the whole table. Backs
// ClientTransactionsModal (opened from the Dealers/Clients tabs).
export async function GET(req, { params }) {
  const { session, response } = await requireSession();
  if (response) return response;

  const codeNorm = normCode(params.code);
  if (!codeNorm) return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  if (session.user.role !== "ADMIN") {
    const client = await prisma.masterClient.findUnique({ where: { codeNorm }, select: { dealer: true, rm: true } });
    const username = session.user.name.toLowerCase();
    const owned = client && (client.dealer.toLowerCase() === username || client.rm.toLowerCase() === username);
    if (!owned) {
      return NextResponse.json([]);
    }
  }

  const rows = await prisma.dailyRecord.findMany({
    where: { codeNorm },
    select: { date: true, source: true, netBrok: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(rows);
}
