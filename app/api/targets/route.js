import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin } from "../../../lib/apiAuth";

const targetsSchema = z.object({
  monthly: z.number().finite().default(0),
  dealerMonthly: z.record(z.string(), z.number().finite()).default({}),
  kotakSharePct: z.number().finite().min(0).max(100).default(85),
  rmSplitPct: z.number().finite().min(0).max(100).default(50),
  dealerSalary: z.record(z.string(), z.number().finite()).default({}),
  incentiveMultiplier: z.number().finite().min(0).default(10),
});

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  const row = await prisma.targets.findUnique({ where: { id: 1 } });
  const monthly = row?.monthly ?? 0;
  const dealerMonthly = row?.dealerMonthly ?? {};
  const kotakSharePct = row?.kotakSharePct ?? 85;
  const rmSplitPct = row?.rmSplitPct ?? 50;
  const dealerSalary = row?.dealerSalary ?? {};
  const incentiveMultiplier = row?.incentiveMultiplier ?? 10;

  if (session.user.role !== "ADMIN") {
    const matchKey = Object.keys(dealerMonthly || {}).find(
      (k) => k.toLowerCase() === session.user.name.toLowerCase()
    );
    const own = matchKey ? dealerMonthly[matchKey] : 0;
    // Salary is sensitive per-dealer data — a VIEWER login only ever sees
    // its own dealerMonthly target today, so dealerSalary is withheld
    // entirely here rather than leaking every dealer's figure.
    return NextResponse.json({ monthly: own, dealerMonthly: { [matchKey || session.user.name]: own }, kotakSharePct, rmSplitPct });
  }

  return NextResponse.json({ monthly, dealerMonthly, kotakSharePct, rmSplitPct, dealerSalary, incentiveMultiplier });
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
