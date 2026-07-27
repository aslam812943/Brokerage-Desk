import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin } from "../../../lib/apiAuth";

export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  const rows = await prisma.rm.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(rows.map((r) => r.name));
}

export async function PUT(req) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = z.array(z.string().trim().min(1).max(200)).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid RM list" }, { status: 400 });
  }

  // Dedupe case-insensitively, keeping the first-seen casing — same rationale
  // as the dealer registry: prevents "Meera" and "MEERA" splitting into two rows.
  const seen = new Set();
  const names = [];
  for (const raw of parsed.data) {
    const key = raw.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(raw);
  }
  await prisma.$transaction([
    prisma.rm.deleteMany({}),
    ...(names.length ? [prisma.rm.createMany({ data: names.map((name) => ({ name })) })] : []),
  ]);

  return NextResponse.json({ ok: true, count: names.length });
}
