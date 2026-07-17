import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireSession, requireAdmin } from "../../../lib/apiAuth";

const MONTH_RE = /^\d{4}-\d{2}$/;
const SLOTS = [1, 2, 3];

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

async function resolveOwnDealerName(username) {
  const dealerMatch = await prisma.dealer.findFirst({ where: { name: { equals: username, mode: "insensitive" } } });
  if (dealerMatch) return dealerMatch.name;
  const clientMatch = await prisma.masterClient.findFirst({
    where: { dealer: { equals: username, mode: "insensitive" } },
    select: { dealer: true },
  });
  return clientMatch ? clientMatch.dealer : username;
}

export async function GET(req) {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const month = MONTH_RE.test(searchParams.get("month") || "") ? searchParams.get("month") : currentMonth();
  const isAdmin = session.user.role === "ADMIN";

  if (!isAdmin) {
    const dealer = await resolveOwnDealerName(session.user.name);
    const tasks = await ensureSlots(dealer, month);
    return NextResponse.json({ month, dealer, tasks });
  }

  const dealerRows = await prisma.dealer.findMany({ orderBy: { name: "asc" } });
  const clientDealers = await prisma.masterClient.findMany({ where: { dealer: { not: "" } }, select: { dealer: true }, distinct: ["dealer"] });
  const dealerNames = [...new Set([...dealerRows.map((r) => r.name), ...clientDealers.map((r) => r.dealer)])].sort();

  const allTasks = await prisma.dealerTask.findMany({ where: { month } });
  const byDealer = {};
  for (const name of dealerNames) byDealer[name] = SLOTS.map((slot) => ({ dealer: name, month, slot, text: "", done: false }));
  for (const t of allTasks) {
    if (!byDealer[t.dealer]) byDealer[t.dealer] = SLOTS.map((slot) => ({ dealer: t.dealer, month, slot, text: "", done: false }));
    byDealer[t.dealer][t.slot - 1] = t;
  }

  return NextResponse.json({ month, dealers: byDealer });
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

  const dealer = await resolveOwnDealerName(session.user.name);
  const row = await prisma.dealerTask.upsert({
    where: { dealer_month_slot: { dealer, month, slot } },
    update: { done },
    create: { dealer, month, slot, done, text: "" },
  });
  return NextResponse.json(row);
}
