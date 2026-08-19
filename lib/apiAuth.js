import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./authOptions";
import { prisma } from "./prisma";

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

// A non-admin (VIEWER) login is scoped to whichever book it's the login for —
// a dealer sees clients where they're the `dealer`, an RM sees clients where
// they're the `rm`. Every read endpoint that used to filter MasterClient by
// `dealer = username` alone now needs both, so a client is visible if the
// logged-in username matches either field.
export function viewerClientWhere(username) {
  return {
    OR: [
      { dealer: { equals: username, mode: "insensitive" } },
      { rm: { equals: username, mode: "insensitive" } },
    ],
  };
}

// Resolves a non-admin username to its canonical registry name and which
// book it belongs to. Dealer match takes priority (preserves existing
// accounts, and the rare case where a name is registered as both) — falls
// back to RM, then, if neither registry nor any client row matches at all,
// defaults to a dealer-shaped scope keyed by the raw username (same
// no-match-found behavior every dealer-login endpoint already had, which
// safely resolves to zero visible clients).
export async function resolveViewerScope(username) {
  const dealerMatch = await prisma.dealer.findFirst({ where: { name: { equals: username, mode: "insensitive" } } });
  if (dealerMatch) return { kind: "dealer", name: dealerMatch.name };
  const dealerClientMatch = await prisma.masterClient.findFirst({
    where: { dealer: { equals: username, mode: "insensitive" } },
    select: { dealer: true },
  });
  if (dealerClientMatch) return { kind: "dealer", name: dealerClientMatch.dealer };

  const rmMatch = await prisma.rm.findFirst({ where: { name: { equals: username, mode: "insensitive" } } });
  if (rmMatch) return { kind: "rm", name: rmMatch.name };
  const rmClientMatch = await prisma.masterClient.findFirst({
    where: { rm: { equals: username, mode: "insensitive" } },
    select: { rm: true },
  });
  if (rmClientMatch) return { kind: "rm", name: rmClientMatch.rm };

  return { kind: "dealer", name: username };
}
