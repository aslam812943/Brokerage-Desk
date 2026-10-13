import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";
import { listViewerAssignments } from "../../../../lib/viewerScope";

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  return NextResponse.json(await listViewerAssignments(prisma));
}
