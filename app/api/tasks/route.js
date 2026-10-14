import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin } from "../../../lib/apiAuth";

const MONTH_RE = /^\d{4}-\d{2}$/;
const SLOTS = [1, 2, 3];
const PRODUCTS = [
  "reactivation",
  "demat",
  "mutual_fund_sip",
  "mutual_fund_lumpsum",
  "privilege_account",
  "corporate",
  "iepf",
  "ra_package",
];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function ensureSlots(dealer, month) {
  const rows = await prisma.dealerTask.findMany({ where: { dealer, month } });
  const bySlot = {};
  rows.forEach((r) => (bySlot[r.slot] = r));
  return SLOTS.map((slot) => bySlot[slot] || { dealer, month, slot, text: "", done: false });
}

export async function GET(req) {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const month = MONTH_RE.test(searchParams.get("month") || "") ? searchParams.get("month") : currentMonth();
  const isAdmin = session.user.role === "ADMIN";

  if (!isAdmin) {
    if (session.user.viewerScope.kind !== "dealer") return NextResponse.json({ error: "Monthly tasks are only available to dealers" }, { status: 403 });
    const dealer = session.user.viewerName;
    const [tasks, productRows] = await Promise.all([
      ensureSlots(dealer, month),
      prisma.dealerProductTask.findMany({ where: { dealer, month }, orderBy: { createdAt: "desc" } }),
    ]);
    return NextResponse.json({ month, dealer, tasks, productEntries: productRows });
  }

  const dealerRows = await prisma.dealer.findMany({ orderBy: { name: "asc" } });
  const clientDealers = await prisma.masterClient.findMany({ where: { dealer: { not: "" } }, select: { dealer: true }, distinct: ["dealer"] });
  const dealerNames = [...new Set([...dealerRows.map((r) => r.name), ...clientDealers.map((r) => r.dealer)])].sort();

  const [allTasks, allProductTasks] = await Promise.all([
    prisma.dealerTask.findMany({ where: { month } }),
    prisma.dealerProductTask.findMany({ where: { month }, orderBy: { createdAt: "desc" } }),
  ]);
  const byDealer = {};
  const productEntriesByDealer = {};
  for (const name of dealerNames) {
    byDealer[name] = SLOTS.map((slot) => ({ dealer: name, month, slot, text: "", done: false }));
    productEntriesByDealer[name] = [];
  }
  for (const t of allTasks) {
    if (!byDealer[t.dealer]) byDealer[t.dealer] = SLOTS.map((slot) => ({ dealer: t.dealer, month, slot, text: "", done: false }));
    byDealer[t.dealer][t.slot - 1] = t;
  }

  for (const row of allProductTasks) {
    if (!productEntriesByDealer[row.dealer]) productEntriesByDealer[row.dealer] = [];
    productEntriesByDealer[row.dealer].push(row);
    if (!byDealer[row.dealer]) byDealer[row.dealer] = SLOTS.map((slot) => ({ dealer: row.dealer, month, slot, text: "", done: false }));
  }

  return NextResponse.json({ month, dealers: byDealer, productEntries: productEntriesByDealer });
}

const textSchema = z.object({
  dealer: z.string().trim().min(1).max(200),
  month: z.string().regex(MONTH_RE),
  slot: z.number().int().min(1).max(3),
  text: z.string().trim().max(500),
});

export async function PUT(req) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = textSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task", details: parsed.error.flatten() }, { status: 400 });
  }
  const { dealer, month, slot, text } = parsed.data;

  const row = await prisma.dealerTask.upsert({
    where: { dealer_month_slot: { dealer, month, slot } },
    update: { text },
    create: { dealer, month, slot, text },
  });
  return NextResponse.json(row);
}

const doneSchema = z.object({
  month: z.string().regex(MONTH_RE),
  slot: z.number().int().min(1).max(3),
  done: z.boolean(),
});

const productSchema = z.object({
  month: z.string().regex(MONTH_RE),
  product: z.enum(PRODUCTS),
  notes: z.string().trim().max(1000).default(""),
});

export async function POST(req) {
  const { session, response } = await requireSession();
  if (response) return response;
  if (session.user.role === "ADMIN") {
    return NextResponse.json({ error: "Only the dealer can add product closures" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid product entry", details: parsed.error.flatten() }, { status: 400 });
  }
  if (session.user.viewerScope.kind !== "dealer") return NextResponse.json({ error: "Monthly tasks are only available to dealers" }, { status: 403 });
  const dealer = session.user.viewerName;
  const row = await prisma.dealerProductTask.create({ data: { dealer, ...parsed.data } });
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = doneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update", details: parsed.error.flatten() }, { status: 400 });
  }
  const { month, slot, done } = parsed.data;

  if (session.user.role === "ADMIN") {
    return NextResponse.json({ error: "Only the dealer can mark tasks done" }, { status: 403 });
  }

  if (session.user.viewerScope.kind !== "dealer") return NextResponse.json({ error: "Monthly tasks are only available to dealers" }, { status: 403 });
  const dealer = session.user.viewerName;
  const row = await prisma.dealerTask.upsert({
    where: { dealer_month_slot: { dealer, month, slot } },
    update: { done },
    create: { dealer, month, slot, done, text: "" },
  });
  return NextResponse.json(row);
}
