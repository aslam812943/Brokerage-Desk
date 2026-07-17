import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./authOptions";

export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
