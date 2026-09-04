import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";
import { writeAudit } from "../../../../lib/audit";

const clientSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().max(200).default(""),
  rm: z.string().trim().max(200).default(""),
  dealer: z.string().trim().max(200).default(""),
  branch: z.string().trim().max(200).default(""),
});

const bodySchema = z.object({
  fileName: z.string().trim().max(260).default(""),
  records: z.array(clientSchema).min(1),
});

// Mirror the codeNorm generated column: upper(regexp_replace(code, '\s+', '', 'g')).
const normCode = (code) => String(code).toUpperCase().replace(/\s+/g, "");

// GET — recent bulk uploads for the "Recent uploads" list (Clients tab).
// The reversal payload (`changes`) can be large, so it's left out here.
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const rows = await prisma.clientUpload.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      createdAt: true,
      fileName: true,
      username: true,
      createdCount: true,
      updatedCount: true,
    },
  });
  return NextResponse.json(rows);
}

// POST — apply a bulk client upload and record it so it can be rolled back.
// New codes are inserted; existing codes (matched case/whitespace-insensitively)
// are updated in place, keeping their original code and createdAt.
export async function POST(req) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload", details: parsed.error.flatten() }, { status: 400 });
  }

  // Dedupe incoming rows by normalized code — last occurrence wins, same as
  // the client-side merge that used to build the full list.
  const incoming = new Map();
  for (const r of parsed.data.records) incoming.set(normCode(r.code), r);

  const existing = await prisma.masterClient.findMany({
    select: { code: true, name: true, rm: true, dealer: true, branch: true, createdAt: true, codeNorm: true },
  });
  const existingByNorm = new Map(existing.map((r) => [r.codeNorm ?? normCode(r.code), r]));

  // Existing codes are updated by delete + re-insert (keeping the stored code
  // and createdAt) rather than N per-row updates — one deleteMany + one
  // createMany stays well inside the transaction window even for large files.
  const replaceCodes = [];
  const toInsert = [];
  const changes = [];
  let createdCount = 0;
  let updatedCount = 0;
  for (const [norm, r] of incoming) {
    const prevRow = existingByNorm.get(norm);
    if (prevRow) {
      replaceCodes.push(prevRow.code);
      toInsert.push({ code: prevRow.code, name: r.name, rm: r.rm, dealer: r.dealer, branch: r.branch, createdAt: prevRow.createdAt });
      changes.push({
        code: prevRow.code,
        existed: true,
        prev: { name: prevRow.name, rm: prevRow.rm, dealer: prevRow.dealer, branch: prevRow.branch },
      });
      updatedCount++;
    } else {
      toInsert.push({ code: r.code, name: r.name, rm: r.rm, dealer: r.dealer, branch: r.branch });
      changes.push({ code: r.code, existed: false, prev: null });
      createdCount++;
    }
  }

  const [, , upload] = await prisma.$transaction([
    prisma.masterClient.deleteMany({ where: { code: { in: replaceCodes } } }),
    prisma.masterClient.createMany({ data: toInsert }),
    prisma.clientUpload.create({
      data: {
        fileName: parsed.data.fileName,
        userId: session.user.id,
        username: session.user.name,
        createdCount,
        updatedCount,
        changes,
      },
      select: { id: true, createdCount: true, updatedCount: true },
    }),
  ]);

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "BULK_UPLOAD_MASTER_CLIENTS",
    detail: `upload=${upload.id} file=${parsed.data.fileName || "-"} created=${upload.createdCount} updated=${upload.updatedCount}`,
  });

  return NextResponse.json({ ok: true, uploadId: upload.id, createdCount: upload.createdCount, updatedCount: upload.updatedCount });
}
