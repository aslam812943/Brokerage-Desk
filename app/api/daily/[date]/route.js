import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";
import { writeAudit } from "../../../../lib/audit";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const recordSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().max(200).default(""),
  netBrok: z.number().finite(),
  source: z.enum(["SW", "KOTAK", ""]).default(""),
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

  // A single upload is always one source's report. Only that source's rows for
  // this date are replaced — the other source's rows (if any) are left alone,
  // so SW and Kotak reports for the same date coexist instead of overwriting.
  const source = parsed.data.length ? parsed.data[0].source : "";
  if (!parsed.data.every((r) => r.source === source)) {
    return NextResponse.json({ error: "All records in one upload must share the same source" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.dailyRecord.deleteMany({ where: { date, source } }),
    ...(parsed.data.length
      ? [prisma.dailyRecord.createMany({ data: parsed.data.map((r) => ({ ...r, date })) })]
      : []),
  ]);

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "UPSERT_DAILY_RECORDS",
    detail: `date=${date} source=${source || "(none)"} count=${parsed.data.length}`,
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

  // ?source=SW scopes the delete to just that source's rows for the date;
  // omitting it deletes everything saved for the date (all sources).
  const { searchParams } = new URL(req.url);
  const scoped = searchParams.has("source");
  const source = searchParams.get("source") ?? undefined;
  const where = scoped ? { date, source } : { date };

  const result = await prisma.dailyRecord.deleteMany({ where });

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "DELETE_DAILY_RECORDS",
    detail: `date=${date}${scoped ? ` source=${source || "(none)"}` : " (all sources)"} deleted=${result.count}`,
  });

  return NextResponse.json({ ok: true });
}
