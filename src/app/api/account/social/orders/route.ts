import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sizzleRequest, SizzleError } from "@/lib/sizzle/client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  serviceId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10000000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  targetLink: z.string().trim().max(2000).optional().default(""),
  destinationEmail: z.string().email().max(254).optional().default(""),
  comments: z.string().max(20000).optional().default(""),
  runs: z.number().int().min(1).max(1000).optional(),
  interval: z.number().int().optional(),
});
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(request: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return fail("Sign in to place an order.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Check the selected service, quantity and order details.");
  const service = createServiceClient();
  const { data: reservation, error: reserveError } = await service.rpc("reserve_sizzle_order", {
    p_user_id: user.id, p_service_id: parsed.data.serviceId,
    p_idempotency_key: parsed.data.idempotencyKey, p_quantity: parsed.data.quantity,
    p_target_link: parsed.data.targetLink, p_destination_email: parsed.data.destinationEmail || user.email || "",
    p_comments: parsed.data.comments, p_runs: parsed.data.runs ?? null,
    p_interval_minutes: parsed.data.runs ? parsed.data.interval ?? null : null,
  });
  if (reserveError) {
    const reason = reserveError.message || "";
    const insufficient = reason.toLowerCase().includes("insufficient wallet balance");
    return fail(insufficient ? "Your wallet balance is insufficient. Add funds and try again." :
      reason.includes("QUANTITY_OUT_OF_RANGE") ? "The quantity is outside this service's allowed minimum and maximum." :
      reason.includes("DESTINATION_EMAIL_REQUIRED") ? "A valid delivery email is required for digital account purchases." :
      reason.includes("TARGET_LINK_REQUIRED") ? "Enter the public profile or post URL for this service." :
      reason.includes("COMMENTS_REQUIRED") ? "Enter at least one custom comment." :
      reason.includes("INVALID_DRIPFEED") ? "This service does not support the selected drip-feed settings." :
      reason.includes("SERVICE_CATALOGUE_STALE") ? "The supplier catalogue needs to be refreshed. Please try again later." :
      reason.includes("SERVICE_NOT_PRICED") ? "This service is not yet priced for customers." :
      reason.includes("IDEMPOTENCY_KEY_REUSED") ? "This checkout key was already used for another order." :
      "This service is not currently available for purchase.", insufficient ? 402 : 409);
  }
  const reserved = Array.isArray(reservation) ? reservation[0] : reservation;
  if (!reserved?.order_id) return fail("Could not reserve your order. No supplier order was sent.", 500);
  const { data: localOrder, error: localError } = await service.from("sizzle_orders")
    .select("id,status,provider_order_ref,retail_amount_kobo")
    .eq("id", reserved.order_id).eq("user_id", user.id).single();
  if (localError || !localOrder) return fail("Could not verify your order state.", 503);
  if (!reserved.is_new) {
    return NextResponse.json({ orderId: localOrder.id, status: localOrder.status, alreadyProcessed: true, supplierOrderId: localOrder.provider_order_ref }, { status: localOrder.provider_order_ref ? 200 : 202 });
  }

  const { data: serviceRow, error: serviceError } = await service.from("sizzle_services")
    .select("service_type,product_kind,fulfilment_mode")
    .eq("id", parsed.data.serviceId).single();
  if (serviceError || !serviceRow) {
    await service.rpc("refund_failed_sizzle_order", { p_order_id: localOrder.id, p_reason: "Could not load service settings after reservation." });
    return fail("Service configuration could not be verified. Your wallet has been refunded.", 500);
  }

  const providerParams: Record<string,string|number> = {
    action: "add", service: reserved.external_service_id,
    quantity: parsed.data.quantity,
  };
  if (serviceRow.product_kind === "digital_account") {
    providerParams.destination_email = parsed.data.destinationEmail || user.email || "";
  } else {
    providerParams.link = parsed.data.targetLink;
  }
  if (serviceRow.service_type === "custom_comments") {
    providerParams.comments = parsed.data.comments;
    delete providerParams.quantity;
  }
  if (parsed.data.runs) {
    providerParams.runs = parsed.data.runs;
    providerParams.interval = parsed.data.interval ?? 0;
  }

  let supplier: { status?: string; order?: string | number };
  try {
    supplier = await sizzleRequest<{ status?: string; order?: string | number }>(providerParams);
    if (supplier.status !== "success" || supplier.order == null) throw new SizzleError("Sizzle did not confirm the order.", 502, "UNCERTAIN_RESPONSE");
  } catch (error) {
    const ambiguous = !(error instanceof SizzleError) || error.status >= 500 || error.code === "UNCERTAIN_RESPONSE";
    if (ambiguous) {
      await service.from("sizzle_orders").update({ status: "manual_review", metadata: { supplier_response_uncertain: true }, updated_at: new Date().toISOString() }).eq("id", localOrder.id);
      return NextResponse.json({ orderId: localOrder.id, status: "manual_review", message: "The supplier response was inconclusive. Your wallet funds remain reserved while this is reconciled. Do not submit the order again." }, { status: 202 });
    }
    await service.rpc("refund_failed_sizzle_order", { p_order_id: localOrder.id, p_reason: error.message });
    return fail("Sizzle rejected the order. Your wallet has been refunded.", 502);
  }

  const supplierRef = String(supplier.order);
  const { error: saveError } = await service.from("sizzle_orders").update({
    provider_order_ref: supplierRef,
    status: serviceRow.fulfilment_mode === "manual_review" ? "manual_review" : "pending",
    metadata: { supplier_status: supplier.status, delivery_mode: serviceRow.fulfilment_mode },
    updated_at: new Date().toISOString(),
  }).eq("id", localOrder.id).is("provider_order_ref", null);
  if (saveError) {
    await service.from("sizzle_orders").update({ status: "manual_review", metadata: { supplier_order_ref: supplierRef, local_save_error: saveError.message }, updated_at: new Date().toISOString() }).eq("id", localOrder.id);
    return NextResponse.json({ orderId: localOrder.id, status: "manual_review", message: "The supplier accepted the order, but local confirmation needs administrator reconciliation." }, { status: 202 });
  }

  const costNgn = Number(reserved.estimated_supplier_cost_ngn);
  const { error: ledgerError } = await service.from("sizzle_cost_ledger").insert({
    sizzle_order_id: localOrder.id, supplier_order_ref: supplierRef,
    supplier_cost_ngn: costNgn, customer_revenue_ngn_kobo: reserved.retail_amount_kobo,
    gross_profit_ngn_kobo: Math.round(reserved.retail_amount_kobo - costNgn * 100),
  });
  if (ledgerError) {
    await service.from("sizzle_orders").update({ status: "manual_review", updated_at: new Date().toISOString() }).eq("id", localOrder.id);
    return NextResponse.json({ orderId: localOrder.id, status: "manual_review", message: "The supplier accepted the order. Financial reconciliation is required; funds remain recorded." }, { status: 202 });
  }
  return NextResponse.json({ orderId: localOrder.id, status: "pending", supplierOrderId: supplierRef }, { status: 201 });
}

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return fail("Sign in required.", 401);
  const { data, error } = await auth.from("sizzle_orders")
    .select("id,product_kind,status,target_link,destination_email,quantity,retail_amount_kobo,provider_order_ref,created_at,refill_supported,remains,start_count,service_id")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
  if (error) return fail("Could not load social orders.", 500);
  const ids = [...new Set((data ?? []).map(x => x.service_id))];
  const { data: services } = ids.length ? await auth.from("sizzle_services").select("id,name,category").in("id", ids) : { data: [] };
  const names = new Map((services ?? []).map(x => [x.id, x]));
  return NextResponse.json({ orders: (data ?? []).map(x => ({ ...x, service: names.get(x.service_id) ?? null })) }, { headers: { "Cache-Control": "no-store" } });
}
