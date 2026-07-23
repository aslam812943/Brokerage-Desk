import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin } from "../../../lib/apiAuth";

const targetsSchema = z.object({
  monthly: z.number().finite().default(0),
  dealerMonthly: z.record(z.string(), z.number().finite()).default({}),
  kotakSharePct: z.number().finite().min(0).max(100).default(85),
});

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  const row = await prisma.targets.findUnique({ where: { id: 1 } });
  const monthly = row?.monthly ?? 0;
  const dealerMonthly = row?.dealerMonthly ?? {};
  const kotakSharePct = row?.kotakSharePct ?? 85;

  if (session.user.role !== "ADMIN") {
    const matchKey = Object.keys(dealerMonthly || {}).find(
      (k) => k.toLowerCase() === session.user.name.toLowerCase()
    );
    const own = matchKey ? dealerMonthly[matchKey] : 0;
    return NextResponse.json({ monthly: own, dealerMonthly: { [matchKey || session.user.name]: own }, kotakSharePct });
  }

  return NextResponse.json({ monthly, dealerMonthly, kotakSharePct });
}

export async function PUT(req) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = targetsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid targets", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.targets.upsert({
    where: { id: 1 },
    update: parsed.data,
    create: { id: 1, ...parsed.data },
  });

  return NextResponse.json({ monthly: row.monthly, dealerMonthly: row.dealerMonthly });
}
