import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireSession } from "../../../../../lib/apiAuth";
import { productClosureSchema } from "../../../../../lib/productClosure";
import { writeAudit } from "../../../../../lib/audit";

async function mutate(req, { params }, deleting) {
  const { session, response } = await requireSession();
  if (response) return response;
  if (session.user.role === "ADMIN" || session.user.viewerScope?.kind !== "dealer") {
    return NextResponse.json({ error: "Only the assigned dealer can change product closures" }, { status: 403 });
  }
  let data;
  if (!deleting) {
    const parsed = productClosureSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid product and enter notes of at most 1000 characters" }, { status: 400 });
    data = parsed.data;
  }
  // Include ownership in the mutation itself; never trust a client-supplied dealer.
  const where = { id: params.id, dealer: session.user.viewerName };
  try {
    const row = deleting
      ? await prisma.dealerProductTask.delete({ where })
      : await prisma.dealerProductTask.update({ where, data });
    await writeAudit({
      userId: session.user.id, username: session.user.name,
      action: deleting ? "DELETE_PRODUCT_CLOSURE" : "EDIT_PRODUCT_CLOSURE",
      detail: JSON.stringify({ id: row.id, dealer: row.dealer, month: row.month, product: row.product }),
    });
    return NextResponse.json(deleting ? { ok: true, id: row.id } : row);
  } catch (error) {
    if (error.code === "P2025") return NextResponse.json({ error: "Product closure not found. It may have already been removed." }, { status: 404 });
    console.error("[product-closure] Mutation failed", error);
    return NextResponse.json({ error: "Couldn't save your change. Please try again." }, { status: 500 });
  }
}

export const PATCH = (req, context) => mutate(req, context, false);
export const DELETE = (req, context) => mutate(req, context, true);
