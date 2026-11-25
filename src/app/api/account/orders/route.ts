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
    const insufficient = reason.toLowerCase().includes("insufficient wallet balance") || reason.includes("INSUFFICIENT_WALLET_BALANCE");
    const status = insufficient ? 402 :
      reason.includes("NOT_AVAILABLE") || reason.includes("OUT_OF_STOCK") || reason.includes("STALE") || reason.includes("CAP_EXCEEDED") || reason.includes("ORDER_ALREADY_TERMINAL") ? 409 :
      reason.includes("IDEMPOTENCY_KEY_REUSED") ? 409 : 400;
    return fail(
      insufficient ? "Your wallet balance is insufficient. Add funds and try again." :
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

  const [{ data: existingProviderOrder, error: existingProviderError }, { data: existingLocalOrder, error: existingLocalError }] = await Promise.all([
    service.from("provider_orders").select("provider_order_ref,status").eq("order_id", orderId).maybeSingle(),
    service.from("orders").select("number_id,status").eq("id", orderId).maybeSingle(),
  ]);
  if (existingProviderError || existingLocalError || !existingLocalOrder) {
    return fail("Could not safely verify the current order state. No new supplier request was sent.", 503);
  }
  if (existingProviderOrder) {
    if (existingLocalOrder.number_id) {
      return NextResponse.json({ orderId, status: existingLocalOrder.status, alreadyProcessed: true });
    }
    await service.from("orders").update({ status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
    return NextResponse.json({ orderId, status: "review_required", message: "The supplier order already exists, but its number record needs administrator reconciliation. No duplicate supplier order was created." }, { status: 202 });
  }

  const catalogProductId = Number(reservation.catalog_product_id);
  const cap = Number(reservation.supplier_cap_usd);
  if (!Number.isSafeInteger(catalogProductId) || catalogProductId <= 0 || !Number.isFinite(cap) || cap <= 0) {
    await service.rpc("refund_failed_smscode_order", { p_order_id: orderId, p_reason: "Missing safe supplier catalogue mapping or price cap" });
    return fail("This tier is not configured with a supplier-enforced price cap. Your wallet has been refunded.", 409);
  }

  let supplierOrder: SupplierOrder;\n  let supplierFxRate: number | null = null;\n  let supplierFxAsOf: string | null = null;
  try {
    const result = await smscodeRequest<CreateResult>("/orders/create", {
      method: "POST",
      headers: { "Idempotency-Key": orderId },
      body: JSON.stringify({ catalog_product_id: catalogProductId, max_price: cap.toFixed(4), quantity: 1 }),
    });
    supplierOrder = result.data.orders?.[0];\n    const fx = result.meta as { fx?: { rate?: number; rate_as_of?: string | null } } | undefined;\n    supplierFxRate = Number(fx?.fx?.rate) || null;\n    supplierFxAsOf = fx?.fx?.rate_as_of ?? null;
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

  const { data: providerOrder, error: providerOrderError } = await service.from("provider_orders").insert({
    order_id: orderId,
    provider_id: provider.id,
    provider_order_ref: String(supplierOrder.id),
    supplier_product_id: String(supplierOrder.product_id),
    status: supplierOrder.status,
    wholesale_amount_minor: supplierOrder.amount.canonical_amount,
    wholesale_currency: supplierOrder.amount.canonical_currency,
    supplier_cost_usd: supplierAmount,
    supplier_cost_idr: supplierOrder.amount.canonical_amount,
    supplier_fx_rate: supplierFxRate,
    last_provider_response: {
      status: supplierOrder.status,
      product_id: supplierOrder.product_id,
      catalog_product_id: supplierOrder.catalog_product_id,
      expires_at: supplierOrder.expires_at ?? null,
    },
  }).select("id").single();
  if (providerOrderError || !providerOrder) {
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

  if (supplierAmount > cap) {
    try {
      const canceled = await smscodeRequest<{ order_id: number; status: string }>("/orders/cancel", {
        method: "POST", body: JSON.stringify({ id: supplierOrder.id }),
      });
      if (canceled.data.status === "CANCELED") {
        await service.from("provider_orders").update({ status: "CANCELED", updated_at: new Date().toISOString() }).eq("id", providerOrder.id);
        await service.from("numbers").update({ status: "unavailable", updated_at: new Date().toISOString() }).eq("id", numberRow.id);
        await service.rpc("refund_failed_smscode_order", { p_order_id: orderId, p_reason: "Supplier price exceeded configured maximum" });
        return fail("Supplier price exceeded the configured cap. The number was canceled and your wallet was refunded.", 502);
      }
    } catch {
      // Keep the customer's funds reserved until the supplier cancellation can be verified.
    }
    await service.from("orders").update({ number_id: numberRow.id, status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
    await service.from("provider_orders").update({ status: "REVIEW_REQUIRED", updated_at: new Date().toISOString() }).eq("id", providerOrder.id);
    return NextResponse.json({ orderId, status: "review_required", message: "The supplier charged above the configured cap. The number is held for administrator reconciliation; your wallet has not been refunded yet." }, { status: 202 });
  }

  const { error: costLedgerError } = await service.from("supplier_cost_ledger").insert({
    order_id: orderId,
    provider_order_id: providerOrder.id,
    supplier_code: "smscode",
    supplier_product_id: String(supplierOrder.product_id),
    supplier_currency: supplierOrder.amount.canonical_currency,
    supplier_amount_minor: supplierOrder.amount.canonical_amount,
    supplier_amount_usd: supplierAmount,
    fx_rate_usd_to_idr: supplierFxRate,
    customer_revenue_ngn_kobo: reservation.retail_amount_kobo,
    metadata: { catalog_product_id: supplierOrder.catalog_product_id, fx_rate_as_of: supplierFxAsOf },
  });
  if (costLedgerError) {
    await service.from("orders").update({ number_id: numberRow.id, status: "review_required", updated_at: new Date().toISOString() }).eq("id", orderId);
    return NextResponse.json({ orderId, status: "review_required", message: "The number was purchased, but supplier cost accounting needs administrator reconciliation." }, { status: 202 });
  }
\n  const status = supplierOrder.status === "OTP_RECEIVED" ? "waiting_message" : "active";
  const { error: orderUpdateError } = await service.from("orders").update({
    number_id: numberRow.id, status, expires_at: supplierOrder.expires_at ?? null, fulfilled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
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
