import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { pgPool } from "../../../lib/pgPool";
import { requireSession } from "../../../lib/apiAuth";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Hard cap — prevents unbounded DB reads. A single day's upload (SW + Kotak,
// ~2-3k clients each) can already be several thousand rows, so this needs to
// stay well above realistic multi-month totals.
const MAX_RECORDS = 5_000_000;
// Matches the normCode() convention used client-side (Dashboard.jsx) for
// joining MasterClient <-> DebitRecord by code — codes are entered by hand
// across separate uploads and can differ in case/whitespace.
const normCode = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "");

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
    allowedCodes = new Set(clients.map((c) => normCode(c.code)));
  }

  // Optional date-range filter — ?from=YYYY-MM-DD&to=YYYY-MM-DD
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");
  const conditions = [];
  const params = [];
  if (from && ISO_DATE.test(from)) { params.push(from); conditions.push(`"date" >= $${params.length}`); }
  if (to   && ISO_DATE.test(to))   { params.push(to);   conditions.push(`"date" <= $${params.length}`); }
  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(MAX_RECORDS);

  // Raw pg query instead of prisma.debitRecord.findMany() — see /api/daily
  // for why: Prisma's per-row model mapping dominates cost at this table's
  // size, not the query itself.
  const { rows } = await pgPool.query(
    `SELECT "date", "code", "name", "debit" FROM "DebitRecord" ${whereSql} ORDER BY "date" DESC LIMIT $${params.length}`,
    params
  );

  const byDate = {};
  for (const r of rows) {
    if (allowedCodes && !allowedCodes.has(normCode(r.code))) continue;
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push({ code: r.code, name: r.name, debit: r.debit });
  }
  return NextResponse.json(byDate);
}
