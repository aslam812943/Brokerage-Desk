import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin } from "../../../lib/apiAuth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  const rows = await prisma.tradingHoliday.findMany({ orderBy: { date: "asc" } });
  return NextResponse.json(rows);
}

const holidaySchema = z.object({
  date: z.string().regex(DATE_RE),
  name: z.string().trim().max(200).default(""),
});

export async function POST(req) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = holidaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid holiday", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.tradingHoliday.upsert({
    where: { date: parsed.data.date },
    update: { name: parsed.data.name },
    create: parsed.data,
  });
  return NextResponse.json(row);
}

export async function DELETE(req) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  await prisma.tradingHoliday.delete({ where: { date } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
