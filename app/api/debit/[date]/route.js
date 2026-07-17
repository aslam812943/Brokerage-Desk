import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";
import { writeAudit } from "../../../../lib/audit";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const recordSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().max(200).default(""),
  debit: z.number().finite(),
});

export async function PUT(req, { params }) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const date = params.date;
  if (!ISO_DATE.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = z.array(recordSchema).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid records", details: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.debitRecord.deleteMany({ where: { date } }),
    ...(parsed.data.length
      ? [prisma.debitRecord.createMany({ data: parsed.data.map((r) => ({ ...r, date })) })]
      : []),
  ]);

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "UPSERT_DEBIT_RECORDS",
    detail: `date=${date} count=${parsed.data.length}`,
  });

  return NextResponse.json({ ok: true, count: parsed.data.length });
}

export async function DELETE(req, { params }) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const date = params.date;
  if (!ISO_DATE.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const result = await prisma.debitRecord.deleteMany({ where: { date } });

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "DELETE_DEBIT_RECORDS",
    detail: `date=${date} deleted=${result.count}`,
  });

  return NextResponse.json({ ok: true });
}
