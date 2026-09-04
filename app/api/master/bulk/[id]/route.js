import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireAdmin } from "../../../../../lib/apiAuth";
import { writeAudit } from "../../../../../lib/audit";

// DELETE — roll back a bulk client upload wholesale: clients it newly added
// are removed, clients it modified are restored to their pre-upload values.
export async function DELETE(_req, { params }) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const upload = await prisma.clientUpload.findUnique({ where: { id: params.id } });
  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  const changes = Array.isArray(upload.changes) ? upload.changes : [];
  const createdCodes = changes.filter((c) => c && c.existed === false).map((c) => c.code);
  const restores = changes.filter((c) => c && c.existed === true && c.prev);
  const restoreByCode = new Map(restores.map((c) => [c.code, c]));

  // Only restore rows that still exist (a client deleted since the upload
  // just stays gone). Rebuild them by delete + re-insert with their current
  // createdAt preserved — one deleteMany + one createMany, same as the
  // upload path, so a large rollback still fits the transaction window.
  const liveRestores = restoreByCode.size
    ? await prisma.masterClient.findMany({
        where: { code: { in: [...restoreByCode.keys()] } },
        select: { code: true, createdAt: true },
      })
    : [];
  const reinsert = liveRestores.map((row) => {
    const { prev } = restoreByCode.get(row.code);
    return {
      code: row.code,
      name: prev.name ?? "",
      rm: prev.rm ?? "",
      dealer: prev.dealer ?? "",
      branch: prev.branch ?? "",
      createdAt: row.createdAt,
    };
  });

  await prisma.$transaction([
    prisma.masterClient.deleteMany({ where: { code: { in: [...createdCodes, ...reinsert.map((r) => r.code)] } } }),
    ...(reinsert.length ? [prisma.masterClient.createMany({ data: reinsert })] : []),
    prisma.clientUpload.delete({ where: { id: upload.id } }),
  ]);

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "ROLLBACK_BULK_UPLOAD",
    detail: `upload=${upload.id} file=${upload.fileName || "-"} removed=${createdCodes.length} restored=${reinsert.length}`,
  });

  return NextResponse.json({ ok: true, removed: createdCodes.length, restored: reinsert.length });
}
