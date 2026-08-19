import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireSession, viewerClientWhere } from "../../../../lib/apiAuth";

const normCode = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "");

// Latest debit balance per client — DISTINCT ON (code), backed by the
// DebitRecord(code, date) index. Replaces folding every debit date's rows
// client-side just to find each client's most recent one.
export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  const isAdmin = session.user.role === "ADMIN";
  let allowedCodes = null;
  if (!isAdmin) {
    const clients = await prisma.masterClient.findMany({
      where: viewerClientWhere(session.user.name),
      select: { code: true },
    });
    allowedCodes = new Set(clients.map((c) => normCode(c.code)));
  }

  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (code) code, debit
    FROM "DebitRecord"
    ORDER BY code, date DESC
  `;
  const filtered = allowedCodes ? rows.filter((r) => allowedCodes.has(normCode(r.code))) : rows;
  return NextResponse.json(filtered.map((r) => ({ code: r.code, debit: r.debit })));
}
