import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin } from "../../../lib/apiAuth";
import { writeAudit } from "../../../lib/audit";

const clientSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().max(200).default(""),
  rm: z.string().trim().max(200).default(""),
  dealer: z.string().trim().max(200).default(""),
  branch: z.string().trim().max(200).default(""),
});

export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  const isAdmin = session.user.role === "ADMIN";
  const rows = await prisma.masterClient.findMany(
    isAdmin ? {} : { where: { dealer: { equals: session.user.name, mode: "insensitive" } } }
  );
  return NextResponse.json(rows);
}

export async function PUT(req) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = z.array(clientSchema).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid client list", details: parsed.error.flatten() }, { status: 400 });
  }

  const records = parsed.data;
  await prisma.$transaction([
    prisma.masterClient.deleteMany({}),
    ...(records.length
      ? [
          prisma.masterClient.createMany({
            data: records.map((r) => ({ ...r, code: r.code })),
          }),
        ]
      : []),
  ]);

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "REPLACE_MASTER_CLIENTS",
    detail: `count=${records.length}`,
  });

  return NextResponse.json({ ok: true, count: records.length });
}
