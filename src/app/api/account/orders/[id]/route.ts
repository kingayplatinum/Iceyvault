import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptPrivateValue } from "@/lib/crypto-vault";
import { smscodeRequest } from "@/lib/smscode/client";
import { encryptPrivateValue } from "@/lib/crypto-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupplierOrder = {
  id: number; status: string; otp_code?: string | null; otp_message?: string | null;
  sms_revision?: number; phone_number?: string | null;
  can_resend?: boolean; can_cancel?: boolean; can_finish?: boolean; expires_at?: string | null;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const service = createServiceClient();
  const { data: order, error } = await service.from("orders")
    .select("id,user_id,status,retail_amount_kobo,currency,created_at,expires_at,fulfilled_at,number_id")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  let [numberResult, providerResult, messagesResult] = await Promise.all([
    order.number_id ? service.from("numbers").select("e164_ciphertext,e164_last4").eq("id", order.number_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    service.from("provider_orders").select("id,provider_id,provider_order_ref,status,supplier_cost_usd,wholesale_amount_minor,wholesale_currency,supplier_fx_rate,supplier_product_id").eq("order_id", order.id).maybeSingle(),
    service.from("messages").select("id,sender,body_ciphertext,received_at,status").eq("order_id", order.id).eq("user_id", user.id).order("received_at", { ascending: false }).limit(20),
  ]);

  let fallbackMessage: { id:string; sender:string; content:string; received_at:string } | null = null;
  // Self-heal orders where SMSCode accepted the purchase but the original request
  // was interrupted before local accounting/status updates or the webhook arrived.
  if (providerResult.data && order.number_id && ["review_required","active","waiting_message"].includes(order.status)) {
    try {
      const live = await smscodeRequest<SupplierOrder>(`/orders/${encodeURIComponent(providerResult.data.provider_order_ref)}`);
      const now = new Date().toISOString();
      let messagePending = false;
      let ledgerPending = false;
      if (live.data.otp_code || live.data.otp_message) {
        const revision = Math.max(0, Number(live.data.sms_revision) || 0);
        const body = [live.data.otp_code ? "OTP: " + live.data.otp_code : "", live.data.otp_message || ""].filter(Boolean).join("\n");
        if (body) {
          const { error: messageError } = await service.from("messages").insert({
            order_id: order.id, user_id: user.id, provider_id: providerResult.data.provider_id,
            provider_message_ref: providerResult.data.provider_order_ref + ":" + revision,
            sender: "SMSCode", body_ciphertext: encryptPrivateValue(body), received_at: now,
            status: "received", retention_until: new Date(Date.now()+30*24*60*60*1000).toISOString(),
          });
          if (messageError && messageError.code !== "23505") { messagePending = true; fallbackMessage = { id: "live-"+providerResult.data.provider_order_ref+"-"+revision, sender: "SMSCode", content: body, received_at: now }; }
        }
      }

      if (["ACTIVE","OTP_RECEIVED","COMPLETED","EXPIRED"].includes(live.data.status)) {
        // A supplier purchase is already confirmed. Rebuild its missing cost ledger
        // from the durable provider order record; do not charge the customer again.
        const { data: ledger } = await service.from("supplier_cost_ledger").select("id").eq("order_id", order.id).maybeSingle();
        if (!ledger && providerResult.data.wholesale_amount_minor != null && providerResult.data.wholesale_currency) {
          const { error: ledgerError } = await service.from("supplier_cost_ledger").insert({
            order_id: order.id, provider_order_id: providerResult.data.id, supplier_code: "smscode",
            supplier_product_id: providerResult.data.supplier_product_id,
            supplier_currency: providerResult.data.wholesale_currency,
            supplier_amount_minor: providerResult.data.wholesale_amount_minor,
            supplier_amount_usd: providerResult.data.supplier_cost_usd,
            fx_rate_usd_to_idr: providerResult.data.supplier_fx_rate,
            customer_revenue_ngn_kobo: order.retail_amount_kobo,
            metadata: { reconciled_from_supplier_order: true },
          });
          if (ledgerError) ledgerPending = true;
        }
        const nextStatus = live.data.status === "COMPLETED" ? "completed" : live.data.status === "EXPIRED" ? "expired" : live.data.status === "OTP_RECEIVED" ? "waiting_message" : "active";
        await service.from("orders").update({
          status: nextStatus, expires_at: live.data.expires_at ?? order.expires_at,
          fulfilled_at: order.fulfilled_at ?? now, ...(nextStatus === "completed" ? { completed_at: now } : {}),
          updated_at: now,
        }).eq("id", order.id).eq("user_id", user.id);
        await service.from("provider_orders").update({ status: live.data.status, last_provider_response: { status: live.data.status, expires_at: live.data.expires_at ?? null, accounting_reconciliation_required: ledgerPending, message_reconciliation_required: messagePending }, updated_at: now }).eq("id", providerResult.data.id);
      }
    } catch {
      // Keep the safe current state; the next page poll or signed webhook retries reconciliation.
    }
    [numberResult, providerResult, messagesResult] = await Promise.all([
      order.number_id ? service.from("numbers").select("e164_ciphertext,e164_last4").eq("id", order.number_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      service.from("provider_orders").select("id,provider_id,provider_order_ref,status,supplier_cost_usd,wholesale_amount_minor,wholesale_currency,supplier_fx_rate,supplier_product_id").eq("order_id", order.id).maybeSingle(),
      service.from("messages").select("id,sender,body_ciphertext,received_at,status").eq("order_id", order.id).eq("user_id", user.id).order("received_at", { ascending: false }).limit(20),
    ]);
  }
  if (numberResult.error || providerResult.error || messagesResult.error) {
    return NextResponse.json({ error: "Could not load order details." }, { status: 500 });
  }
  let phoneNumber: string | null = null;
  try {
    if (numberResult.data?.e164_ciphertext) phoneNumber = decryptPrivateValue(numberResult.data.e164_ciphertext);
  } catch {
    return NextResponse.json({ error: "Secure number data is temporarily unavailable. Contact support." }, { status: 503 });
  }
  let messages: Array<{ id: string; sender: string | null; content: string; received_at: string }> = [];
  try {
    messages = (messagesResult.data ?? []).map((message) => ({
      id: message.id,
      sender: message.sender,
      content: decryptPrivateValue(message.body_ciphertext),
      received_at: message.received_at,
    }));
    if (fallbackMessage && !messages.some((message) => message.content === fallbackMessage?.content)) messages.unshift(fallbackMessage);
  } catch {
    return NextResponse.json({ error: "Secure message data is temporarily unavailable. Contact support." }, { status: 503 });
  }

  return NextResponse.json({
    order: { ...order, phoneNumber, supplierStatus: providerResult.data?.status ?? null },
    messages,
  }, { headers: { "Cache-Control": "no-store" } });
}

const actionSchema = z.object({ action: z.enum(["cancel", "finish", "resend"]) });
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order action." }, { status: 400 });

  const service = createServiceClient();
  const { data: order } = await service.from("orders")
    .select("id,user_id,status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const { data: providerOrder } = await service.from("provider_orders")
    .select("provider_order_ref,provider_id").eq("order_id", id).maybeSingle();
  if (!providerOrder) return NextResponse.json({ error: "Supplier order not found." }, { status: 404 });
  const supplierId = Number(providerOrder.provider_order_ref);
  if (!Number.isSafeInteger(supplierId) || supplierId <= 0) return NextResponse.json({ error: "Invalid supplier order reference." }, { status: 409 });

  try {
    if (parsed.data.action === "cancel") {
      if (!["active","waiting_message"].includes(order.status)) return NextResponse.json({ error: "This order cannot be canceled in its current state." }, { status: 409 });
      const live = await smscodeRequest<SupplierOrder>(`/orders/${supplierId}`);
      if (!live.data.can_cancel) return NextResponse.json({ error: "The supplier does not currently allow cancellation of this number." }, { status: 409 });
      const result = await smscodeRequest<{ order_id: number; status: string }>("/orders/cancel", {
        method: "POST", body: JSON.stringify({ id: supplierId }),
      });
      if (result.data.status !== "CANCELED") return NextResponse.json({ error: "The supplier has not confirmed cancellation. Your wallet has not been refunded." }, { status: 409 });
      const { error } = await service.rpc("refund_failed_smscode_order", { p_order_id: id, p_reason: "Customer canceled supplier number" });
      if (error) return NextResponse.json({ error: "Supplier canceled the number, but the wallet refund needs administrator reconciliation." }, { status: 202 });
      await service.from("provider_orders").update({ status: "CANCELED", updated_at: new Date().toISOString() }).eq("order_id", id);
      await service.from("numbers").update({ status: "unavailable", updated_at: new Date().toISOString() }).eq("provider_number_ref", String(supplierId));
      return NextResponse.json({ status: "refunded", message: "Number canceled and wallet refunded." });
    }

    if (parsed.data.action === "finish") {
      if (order.status !== "waiting_message") return NextResponse.json({ error: "Finish is available after a verification message has arrived." }, { status: 409 });
      const live = await smscodeRequest<SupplierOrder>(`/orders/${supplierId}`);
      if (!live.data.can_finish) return NextResponse.json({ error: "The supplier does not currently allow this order to be finished." }, { status: 409 });
      const result = await smscodeRequest<{ order_id: number; status: string }>("/orders/finish", {
        method: "POST", body: JSON.stringify({ id: supplierId }),
      });
      await service.from("orders").update({ status: "completed", fulfilled_at: new Date().toISOString(), completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
      await service.from("provider_orders").update({ status: result.data.status, updated_at: new Date().toISOString() }).eq("order_id", id);
      return NextResponse.json({ status: "completed" });
    }

    const current = await smscodeRequest<SupplierOrder>(`/orders/${supplierId}`);
    if (!current.data.can_resend) return NextResponse.json({ error: "The supplier does not currently allow another SMS resend." }, { status: 409 });
    const resent = await smscodeRequest<{ order_id: number; status: string; resent: boolean }>("/orders/resend", {
      method: "POST", body: JSON.stringify({ id: supplierId }),
    });
    return NextResponse.json({ status: resent.data.status, resent: resent.data.resent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
