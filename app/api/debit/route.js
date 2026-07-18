import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireSession } from "../../../lib/apiAuth";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Hard cap — prevents unbounded DB reads. A single day's upload (SW + Kotak,
// ~2-3k clients each) can already be several thousand rows, so this needs to
// stay well above realistic multi-month totals.
const MAX_RECORDS = 500_000;

export async function GET(req) {
  const { session, response } = await requireSession();
  if (response) return response;

  const isAdmin = session.user.role === "ADMIN";
  let allowedCodes = null;
  if (!isAdmin) {
    const clients = await prisma.masterClient.findMany({
      where: { dealer: { equals: session.user.name, mode: "insensitive" } },
      select: { code: true },
    });
    allowedCodes = new Set(clients.map((c) => c.code));
  }

  // Optional date-range filter — ?from=YYYY-MM-DD&to=YYYY-MM-DD
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");
  const where = {};
  if (from && ISO_DATE.test(from)) where.date = { ...where.date, gte: from };
  if (to   && ISO_DATE.test(to))   where.date = { ...where.date, lte: to };

  // Sort newest-first so that if the cap is ever hit, it's the oldest
  // (least relevant) dates that get dropped, not the most recent uploads.
  const rows = await prisma.debitRecord.findMany({
    where,
    orderBy: { date: "desc" },
    take: MAX_RECORDS,
  });

  const byDate = {};
  for (const r of rows) {
    if (allowedCodes && !allowedCodes.has(r.code)) continue;
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push({ code: r.code, name: r.name, debit: r.debit });
  }
  return NextResponse.json(byDate);
}
