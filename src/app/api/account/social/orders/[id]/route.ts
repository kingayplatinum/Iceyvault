import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sizzleRequest } from "@/lib/sizzle/client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const service = createServiceClient();
  const { data: order, error } = await service.from("sizzle_orders")
    .select("id,user_id,status,provider_order_ref,refill_supported,remains,start_count,supplier_charge_ngn")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (!order.provider_order_ref) return NextResponse.json({ order });
  try {
    const live = await sizzleRequest<{ order?: string; status?: string; charge?: string; start_count?: string; remains?: string; currency?: string }>({ action: "status", order: order.provider_order_ref });
    const update = {
      status: live.status || order.status,
      supplier_charge_ngn: Number.isFinite(Number(live.charge)) ? Number(live.charge) : order.supplier_charge_ngn,
      start_count: Number.isFinite(Number(live.start_count)) ? Number(live.start_count) : order.start_count,
      remains: Number.isFinite(Number(live.remains)) ? Number(live.remains) : order.remains,
      updated_at: new Date().toISOString(),
    };
    const { data: saved } = await service.from("sizzle_orders").update(update).eq("id", order.id).eq("user_id", user.id).select("id,status,provider_order_ref,refill_supported,remains,start_count,supplier_charge_ngn").single();
    return NextResponse.json({ order: saved ?? { ...order, ...update } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ order, refreshWarning: "Supplier status could not be refreshed right now." }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const service = createServiceClient();
  const { data: order } = await service.from("sizzle_orders").select("id,provider_order_ref,refill_supported,status").eq("id",id).eq("user_id",user.id).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (!order.refill_supported || !order.provider_order_ref) return NextResponse.json({ error: "Refill is not supported for this order." }, { status: 409 });
  if (!["completed","partial"].includes((order.status||"").toLowerCase())) return NextResponse.json({ error: "Only completed or partially completed orders can be submitted for refill." }, { status: 409 });
  try {
    const result = await sizzleRequest<{ status?: string; refill?: string; message?: string }>({ action: "refill", order: order.provider_order_ref });
    if (result.status !== "success" || !result.refill) return NextResponse.json({ error: result.message || "Sizzle did not confirm the refill request." }, { status: 502 });
    await service.from("sizzle_orders").update({ metadata: { refill_id: result.refill }, updated_at: new Date().toISOString() }).eq("id", order.id);
    return NextResponse.json({ status: "success", refillId: result.refill });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Refill request failed." }, { status: 502 });
  }
}
