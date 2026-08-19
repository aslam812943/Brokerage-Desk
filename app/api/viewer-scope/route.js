import { NextResponse } from "next/server";
import { requireSession, resolveViewerScope } from "../../../lib/apiAuth";

// Tells the client whether the current non-admin login is scoped as a
// dealer or an RM — Dashboard.jsx uses this to label the signed-in badge
// and to hide dealer-only tabs (Monthly Tasks) for an RM login.
export async function GET() {
  const { session, response } = await requireSession();
  if (response) return response;

  if (session.user.role === "ADMIN") {
    return NextResponse.json({ isAdmin: true, kind: null, name: session.user.name });
  }

  const scope = await resolveViewerScope(session.user.name);
  return NextResponse.json({ isAdmin: false, kind: scope.kind, name: scope.name });
}
