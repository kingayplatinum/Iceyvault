import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertPrivateEncryptionConfigured, encryptPrivateValue } from "@/lib/crypto-vault";
import { smscodeRequest, SmscodeError } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupplierOrder = {
  id: number; status: string; product_id: number; catalog_product_id: number;
  phone_number: string; amount: { amount: string; currency: string; canonical_amount: number; canonical_currency: string };
  otp_code?: string | null; expires_at?: string | null;
};
type CreateResult = { orders: SupplierOrder[]; failed_count: number };

const schema = z.object({
  tierId: z.string().uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
});

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Sign in to purchase a number.", 401);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Choose a valid product tier and retry with a unique request key.");
  if (!process.env.SMSCODE_TOKEN) return fail("Number fulfilment is temporarily unavailable. Please try again later.", 503);
  try {
    assertPrivateEncryptionConfigured();
  } catch {
    return fail("Secure number storage is not configured. Please contact support; no wallet funds have been reserved.", 503);
  }

  const service = createServiceClient();
  const { data: reserved, error: reserveError } = await service.rpc("reserve_smscode_order", {
    p_user_id: user.id,
    p_tier_id: parsed.data.tierId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (reserveError) {
    const reason = reserveError.message || "";
    const status = reason.includes("INSUFFICIENT_WALLET_BALANCE") ? 402 :
      reason.includes("NOT_AVAILABLE") || reason.includes("OUT_OF_STOCK") || reason.includes("STALE") || reason.includes("CAP_EXCEEDED") ? 409 :
      reason.includes("IDEMPOTENCY_KEY_REUSED") ? 409 : 400;
    return fail(
      reason.includes("INSUFFICIENT_WALLET_BALANCE") ? "Your wallet balance is insufficient. Add funds and try again." :
      reason.includes("SUPPLIER_PRODUCT_STALE") ? "This price or stock quote has expired. Refresh the catalogue and try again." :
      reason.includes("SUPPLIER_PRICE_CAP_EXCEEDED") ? "The supplier price is above the configured cap. This tier is temporarily unavailable." :
      reason.includes("OUT_OF_STOCK") ? "This tier is currently out of stock." :
      reason.includes("IDEMPOTENCY_KEY_REUSED") ? "This request key was already used for a different product." :
      "This product is not currently available for purchase.", status
    );
  }

  const reservation = Array.isArray(reserved) ? reserved[0] : reserved;
  if (!reservation?.order_id) return fail("Could not reserve this purchase. No supplier order was placed.", 500);
  const orderId = reservation.order_id as string;

  const { data: existingProviderOrder } = await service
    .from("provider_orders").select("provider_order_ref,status").eq("order_id", orderId).maybeSingle();
  if (existingProviderOrder) {
    return NextResponse.json({ orderId, status: existingProviderOrder.status, alreadyProcessed: true });
  }

  const catalogProductId = Number(reservation.catalog_product_id);
  const cap = Number(reservation.supplier_cap_usd);
  if (!Number.isSafeInteger(catalogProductId) || catalogProductId <= 0 || !Number.isFinite(cap) || cap <= 0) {
    await service.rpc("refund_failed_smscode_order", { p_order_id: orderId, p_reason: "Missing safe supplier catalogue mapping or price cap" });
    return fail("This tier is not configured with a supplier-enforced price cap. Your wallet has been refunded.", 409);
  }

  let supplierOrder: SupplierOrder;
  try {
    const result = await smscodeRequest<CreateResult>("/orders/create", {
      method: "POST",
      headers: { "Idempotency-Key": orderId },
      body: JSON.stringify({ catalog_product_id: catalogProductId, max_price: cap.toFixed(4), quantity: 1 }),
    });
    supplierOrder = result.data.orders?.[0];
    if (!supplierOrder) {
      await service.rpc("refund_failed_smscode_order", { p_order_id: orderId, p_reason: "SMSCode returned no successful order" });
      return fail("The supplier could not fulfil this number. Your wallet has been refunded.", 502);
    }
  } catch (error) {
    const supplierStatus = error instanceof SmscodeError ? error.status : 0;
    const supplierCode = error instanceof SmscodeError ? error.code : undefined;
    const isAmbiguous = supplierStatus === 0 || supplierStatus >= 500 ||
      supplierCode === "REQUEST_IN_PROGRESS" || supplierCode === "IDEMPOTENCY_KEY_REUSED";
    if (isAmbiguous) {
      await service.from("orders").update({ status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
      return NextResponse.json({
        orderId, status: "review_required",
        message: "The supplier response is not conclusive. Your funds remain reserved while the request is reconciled; do not retry with a new request key.",
      }, { status: 202 });
    }
    await service.rpc("refund_failed_smscode_order", {
      p_order_id: orderId,
      p_reason: error instanceof Error ? error.message : "Supplier rejected the order",
    });
    return fail("The supplier rejected this purchase. Your wallet has been refunded.", 502);
  }

  const supplierAmount = Number(supplierOrder.amount?.amount);
  if (supplierOrder.amount?.currency !== "USD" || !Number.isFinite(supplierAmount)) {
    await service.from("orders").update({ status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
    return NextResponse.json({ orderId, status: "review_required", message: "Supplier returned an unexpected settlement format. Funds are held for reconciliation." }, { status: 202 });
  }

  const { data: provider, error: providerError } = await service
    .from("providers").select("id").eq("code", "smscode").maybeSingle();
  if (providerError || !provider) {
    await service.from("orders").update({ status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
    return NextResponse.json({ orderId, status: "review_required", message: "Supplier accepted the order, but the local provider record needs administrator attention." }, { status: 202 });
  }

  const { error: providerOrderError } = await service.from("provider_orders").insert({
    order_id: orderId,
    provider_id: provider.id,
    provider_order_ref: String(supplierOrder.id),
    supplier_product_id: String(supplierOrder.product_id),
    status: supplierOrder.status,
    wholesale_amount_minor: supplierOrder.amount.canonical_amount,
    wholesale_currency: supplierOrder.amount.canonical_currency,
    supplier_cost_usd: supplierAmount,
    supplier_cost_idr: supplierOrder.amount.canonical_amount,
    last_provider_response: {
      status: supplierOrder.status,
      product_id: supplierOrder.product_id,
      catalog_product_id: supplierOrder.catalog_product_id,
      expires_at: supplierOrder.expires_at ?? null,
    },
  });
  if (providerOrderError) {
    await service.from("orders").update({ status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
    return NextResponse.json({ orderId, status: "review_required", message: "Supplier accepted the order, but the local fulfilment record needs administrator reconciliation." }, { status: 202 });
  }

  const { data: tier } = await service.from("smscode_product_tiers")
    .select("country_iso2,service_id").eq("id", parsed.data.tierId).maybeSingle();
  const { data: serviceRow } = tier
    ? await service.from("smscode_service_catalogue").select("sms_code_service_code").eq("id", tier.service_id).maybeSingle()
    : { data: null };
  const phone = supplierOrder.phone_number;
  const { data: numberRow, error: numberError } = await service.from("numbers").insert({
    provider_id: provider.id,
    provider_number_ref: String(supplierOrder.id),
    e164_ciphertext: encryptPrivateValue(phone),
    e164_last4: phone.slice(-4),
    country_iso2: tier?.country_iso2 ?? "NG",
    service_code: serviceRow?.sms_code_service_code ?? null,
    channel: "sms",
    offer_kind: "sms_activation",
    status: "assigned",
    provider_metadata: { supplier_order_id: supplierOrder.id },
  }).select("id").single();

  if (numberError || !numberRow) {
    await service.from("orders").update({ status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
    return NextResponse.json({ orderId, status: "review_required", message: "Supplier accepted the order. Number details are safely held for administrator reconciliation." }, { status: 202 });
  }

  const status = supplierOrder.status === "OTP_RECEIVED" ? "waiting_message" : "active";
  const { error: orderUpdateError } = await service.from("orders").update({
    number_id: numberRow.id, status, fulfilled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", orderId);
  if (orderUpdateError) {
    await service.from("orders").update({ status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
    return NextResponse.json({ orderId, status: "review_required", message: "Supplier accepted the order. Local order linkage needs administrator reconciliation." }, { status: 202 });
  }

  return NextResponse.json({
    orderId,
    status,
    phoneNumber: phone,
    expiresAt: supplierOrder.expires_at ?? null,
    retailAmountKobo: reservation.retail_amount_kobo,
  }, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data, error } = await supabase.from("orders")
    .select("id,status,retail_amount_kobo,currency,created_at,expires_at,fulfilled_at,number_id")
    .eq("user_id", user.id).eq("offer_kind", "sms_activation")
    .order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "Could not load your orders." }, { status: 500 });
  return NextResponse.json({ orders: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
