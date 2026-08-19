import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin, resolveViewerScope } from "../../../lib/apiAuth";

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  if (session.user.role !== "ADMIN") {
    const scope = await resolveViewerScope(session.user.name);
    // A dealer login sees its own name here (used to seed the dealer
    // registry list client-side). An RM login isn't a dealer at all — the
    // dealer(s) tied to its own clients already surface separately, via the
    // `dealer` field on each row /api/master returns for it.
    return NextResponse.json(scope.kind === "dealer" ? [scope.name] : []);
  }

  const rows = await prisma.dealer.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(rows.map((r) => r.name));
}

export async function PUT(req) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = z.array(z.string().trim().min(1).max(200)).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid dealer list" }, { status: 400 });
  }

  // Dedupe case-insensitively, keeping the first-seen casing — prevents
  // "Rasish" and "RASISH" from being stored as two separate dealers.
  const seen = new Set();
  const names = [];
  for (const raw of parsed.data) {
    const key = raw.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(raw);
  }
  await prisma.$transaction([
    prisma.dealer.deleteMany({}),
    ...(names.length ? [prisma.dealer.createMany({ data: names.map((name) => ({ name })) })] : []),
  ]);

  return NextResponse.json({ ok: true, count: names.length });
}
