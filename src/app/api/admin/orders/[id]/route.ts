import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { decryptPrivateValue, encryptPrivateValue } from "@/lib/crypto-vault";
import { smscodeRequest } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const { data: order, error } = await auth.service.from("orders")
    .select("id,user_id,status,retail_amount_kobo,currency,created_at,updated_at,fulfilled_at,expires_at,number_id,offer_kind,smscode_tier_id")
    .eq("id", id).maybeSingle();
  if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const [providerResult, numberResult, messagesResult, tierResult] = await Promise.all([
    auth.service.from("provider_orders").select("id,provider_id,provider_order_ref,status,supplier_cost_usd,wholesale_amount_minor,wholesale_currency,supplier_fx_rate,supplier_product_id,last_provider_response").eq("order_id", id).maybeSingle(),
    order.number_id ? auth.service.from("numbers").select("e164_ciphertext,e164_last4,country_iso2,service_code,status").eq("id", order.number_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    auth.service.from("messages").select("id,sender,body_ciphertext,received_at,status").eq("order_id", id).order("received_at", { ascending: false }).limit(30),
    order.smscode_tier_id ? auth.service.from("smscode_product_tiers").select("tier_label,country_iso2,retail_price_kobo").eq("id", order.smscode_tier_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (providerResult.error || numberResult.error || messagesResult.error || tierResult.error) {
    return NextResponse.json({ error: "Could not load complete order details." }, { status: 500 });
  }

  // Opening an admin order also reconciles it against SMSCode. This removes the
  // old manual-review dependency when the supplier accepted but local writes/webhooks lagged.
  if (providerResult.data && ["review_required","active","waiting_message"].includes(order.status)) {
    try {
      type LiveOrder = { status:string; otp_code?:string|null; otp_message?:string|null; sms_revision?:number; expires_at?:string|null };
      const live = await smscodeRequest<LiveOrder>(`/orders/${encodeURIComponent(providerResult.data.provider_order_ref)}`);
      const now = new Date().toISOString();
      let messagePending = false;
      let ledgerPending = false;
      if (live.data.otp_code || live.data.otp_message) {
        const revision = Math.max(0, Number(live.data.sms_revision) || 0);
        const body = [live.data.otp_code ? "OTP: "+live.data.otp_code : "", live.data.otp_message || ""].filter(Boolean).join("\n");
        const { error: messageError } = await auth.service.from("messages").insert({
          order_id: id, user_id: order.user_id, provider_id: providerResult.data.provider_id,
          provider_message_ref: providerResult.data.provider_order_ref+":"+revision,
          sender: "SMSCode", body_ciphertext: encryptPrivateValue(body), received_at: now,
          status: "received", retention_until: new Date(Date.now()+30*24*60*60*1000).toISOString(),
        });
        if (messageError && messageError.code !== "23505") messagePending = true;
      }
      if (["ACTIVE","OTP_RECEIVED","COMPLETED","EXPIRED"].includes(live.data.status)) {
        const { data: ledger } = await auth.service.from("supplier_cost_ledger").select("id").eq("order_id",id).maybeSingle();
        if (!ledger && providerResult.data.wholesale_amount_minor != null && providerResult.data.wholesale_currency) {
          const { error: ledgerError } = await auth.service.from("supplier_cost_ledger").insert({
            order_id:id,provider_order_id:providerResult.data.id,supplier_code:"smscode",
            supplier_product_id:providerResult.data.supplier_product_id,
            supplier_currency:providerResult.data.wholesale_currency,
            supplier_amount_minor:providerResult.data.wholesale_amount_minor,
            supplier_amount_usd:providerResult.data.supplier_cost_usd,
            fx_rate_usd_to_idr:providerResult.data.supplier_fx_rate,
            customer_revenue_ngn_kobo:order.retail_amount_kobo,
            metadata:{reconciled_from_admin_order_view:true},
          });
          if (ledgerError) ledgerPending = true;
        }
        const nextStatus=live.data.status==="COMPLETED"?"completed":live.data.status==="EXPIRED"?"expired":live.data.status==="OTP_RECEIVED"?"waiting_message":"active";
        await auth.service.from("orders").update({status:nextStatus,expires_at:live.data.expires_at??order.expires_at,fulfilled_at:order.fulfilled_at??now,...(nextStatus==="completed"?{completed_at:now}:{}),updated_at:now}).eq("id",id);
        await auth.service.from("provider_orders").update({status:live.data.status,last_provider_response:{status:live.data.status,expires_at:live.data.expires_at??null,accounting_reconciliation_required:ledgerPending,message_reconciliation_required:messagePending},updated_at:now}).eq("id",providerResult.data.id);
      }
    } catch {
      // Keep the current state and allow the next automatic refresh or webhook to retry.
    }
  }

  let phoneNumber: string | null = null;
  let messages: Array<{ id: string; sender: string | null; content: string; received_at: string }> = [];
  try {
    if (numberResult.data?.e164_ciphertext) phoneNumber = decryptPrivateValue(numberResult.data.e164_ciphertext);
    messages = (messagesResult.data ?? []).map((message) => ({
      id: message.id, sender: message.sender,
      content: decryptPrivateValue(message.body_ciphertext), received_at: message.received_at,
    }));
  } catch {
    return NextResponse.json({ error: "Secure order data could not be decrypted." }, { status: 503 });
  }
  return NextResponse.json({
    order, provider: providerResult.data, number: numberResult.data ? { e164_last4: numberResult.data.e164_last4, country_iso2: numberResult.data.country_iso2, service_code: numberResult.data.service_code, status: numberResult.data.status, phoneNumber } : null,
    tier: tierResult.data, messages,
  }, { headers: { "Cache-Control": "no-store" } });
}
