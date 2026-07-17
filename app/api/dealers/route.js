import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin } from "../../../lib/apiAuth";

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  if (session.user.role !== "ADMIN") {
    const dealerMatch = await prisma.dealer.findFirst({
      where: { name: { equals: session.user.name, mode: "insensitive" } },
    });
    if (dealerMatch) return NextResponse.json([dealerMatch.name]);

    const clientMatch = await prisma.masterClient.findFirst({
      where: { dealer: { equals: session.user.name, mode: "insensitive" } },
      select: { dealer: true },
    });
    return NextResponse.json([clientMatch ? clientMatch.dealer : session.user.name]);
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

  const names = [...new Set(parsed.data)];
  await prisma.$transaction([
    prisma.dealer.deleteMany({}),
    ...(names.length ? [prisma.dealer.createMany({ data: names.map((name) => ({ name })) })] : []),
  ]);

  return NextResponse.json({ ok: true, count: names.length });
}
