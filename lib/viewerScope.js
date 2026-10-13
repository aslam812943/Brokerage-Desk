// Keep matching exact (apart from case). Guessing by first name can grant
// another person's book to the wrong login.
export function viewerClientWhere(name) {
  if (!name) return { code: { in: [] } };
  return {
    OR: [
      { dealer: { equals: name, mode: "insensitive" } },
      { rm: { equals: name, mode: "insensitive" } },
    ],
  };
}

export async function resolveViewerScope(db, name) {
  if (!name) return { kind: null, name: null, matched: false };
  const dealer = await db.dealer.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (dealer) return { kind: "dealer", name: dealer.name, matched: true };
  const dealerClient = await db.masterClient.findFirst({
    where: { dealer: { equals: name, mode: "insensitive" } }, select: { dealer: true },
  });
  if (dealerClient) return { kind: "dealer", name: dealerClient.dealer, matched: true };
  const rm = await db.rm.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (rm) return { kind: "rm", name: rm.name, matched: true };
  const rmClient = await db.masterClient.findFirst({
    where: { rm: { equals: name, mode: "insensitive" } }, select: { rm: true },
  });
  if (rmClient) return { kind: "rm", name: rmClient.rm, matched: true };
  return { kind: null, name, matched: false };
}

// One small catalogue serves the admin assignment picker and account health
// indicators. Names present only in imported client data are valid too.
export async function listViewerAssignments(db) {
  const [dealers, rms, dealerCounts, rmCounts] = await Promise.all([
    db.dealer.findMany({ select: { name: true } }),
    db.rm.findMany({ select: { name: true } }),
    db.masterClient.groupBy({ by: ["dealer"], where: { dealer: { not: "" } }, _count: { _all: true } }),
    db.masterClient.groupBy({ by: ["rm"], where: { rm: { not: "" } }, _count: { _all: true } }),
  ]);
  const entries = new Map();
  const add = (name, kind, count = 0) => {
    if (!name) return;
    const key = name.toLowerCase();
    const entry = entries.get(key) || { name, kind, dealerClients: 0, rmClients: 0 };
    if (kind === "dealer") { entry.kind = "dealer"; entry.dealerClients += count; }
    else entry.rmClients += count;
    entries.set(key, entry);
  };
  dealers.forEach((r) => add(r.name, "dealer"));
  dealerCounts.forEach((r) => add(r.dealer, "dealer", r._count._all));
  rms.forEach((r) => add(r.name, "rm"));
  rmCounts.forEach((r) => add(r.rm, "rm", r._count._all));
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}
