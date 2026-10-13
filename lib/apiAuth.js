import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./authOptions";
import { prisma } from "./prisma";
import { resolveViewerScope } from "./viewerScope";
export { viewerClientWhere } from "./viewerScope";

export async function requireSession({ allowUnmapped = false } = {}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  // Read the assignment on every request: admin corrections take effect
  // immediately, without waiting for an existing JWT to expire.
  if (session.user.role !== "ADMIN") {
    const account = await prisma.user.findUnique({
      where: { id: session.user.id }, select: { username: true, viewerName: true },
    });
    if (!account) return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const scope = await resolveViewerScope(prisma, account.viewerName ?? account.username);
    session.user.viewerScope = scope;
    session.user.viewerName = scope.matched ? scope.name : null;
    if (!scope.matched && !allowUnmapped) {
      return { session: null, response: NextResponse.json({
        code: "VIEWER_ASSIGNMENT_REQUIRED",
        error: "Your account needs a dealer/RM assignment. Please contact your administrator.",
      }, { status: 403 }) };
    }
  }
  return { session, response: null };
}

export async function requireAdmin() {
  const { session, response } = await requireSession();
  if (response) return { session: null, response };
  if (session.user.role !== "ADMIN") {
    return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, response: null };
}
