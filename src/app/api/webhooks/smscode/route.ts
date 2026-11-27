import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { encryptPrivateValue } from "@/lib/crypto-vault";
import { smscodeRequest } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

type SmsEvent = {
  event: "order.otp_received" | "order.completed" | "order.expired" | "order.canceled";
  timestamp?: string;
  data: {
    order_id: number | string;
    phone_number?: string;
    otp_code?: string | null;
    otp_message?: string | null;
    sms_revision?: number;
    platform?: string;
    expires_at?: string | null;
  };
};
type SupplierOrderState = { id: number; status: string; can_finish?: boolean; can_cancel?: boolean };

export async function POST(request: NextRequest) {
  const secret = process.env.SMSCODE_WEBHOOK_SECRET;
  if (!secret) return new NextResponse("Webhook secret is not configured", { status: 503 });
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature") || "";
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!signature || !safeEqual(signature, expected)) return new NextResponse("Invalid signature", { status: 401 });

  let event: SmsEvent;
  try { event = JSON.parse(rawBody) as SmsEvent; }
  catch { return new NextResponse("Invalid JSON", { status: 400 }); }
  if (!event.data?.order_id || !["order.otp_received","order.completed","order.expired","order.canceled"].includes(event.event)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const service = createServiceClient();
  const supplierOrderId = String(event.data.order_id);
  const { data: provider } = await service.from("providers").select("id").eq("code", "smscode").maybeSingle();
  if (!provider) return new NextResponse("SMSCode provider is not configured", { status: 503 });

  const { data: providerOrder, error: providerOrderError } = await service.from("provider_orders")
    .select("id,order_id,status").eq("provider_id", provider.id)
    .eq("provider_order_ref", supplierOrderId).maybeSingle();
  if (providerOrderError) return new NextResponse("Could not load supplier order", { status: 500 });
  if (!providerOrder) return NextResponse.json({ received: true, matched: false });

  const { data: localOrder, error: localOrderError } = await service.from("orders")
    .select("user_id,status").eq("id", providerOrder.order_id).maybeSingle();
  if (localOrderError || !localOrder) return new NextResponse("Could not load local order", { status: 500 });
  const now = new Date().toISOString();

  if (event.event === "order.otp_received") {
    const revision = Math.max(0, Number(event.data.sms_revision) || 0);
    const { data: priorMessages, error: revisionError } = await service.from("messages")
      .select("provider_message_ref").eq("order_id", providerOrder.order_id)
      .like("provider_message_ref", supplierOrderId + ":%");
    if (revisionError) return new NextResponse("Could not check message revision", { status: 500 });
    const latestRevision = Math.max(-1, ...(priorMessages ?? []).map((message) => Number(message.provider_message_ref?.split(":").pop()) || 0));
    if (revision < latestRevision) return NextResponse.json({ received: true, ignored: "stale_revision" });

    const body = [event.data.otp_code ? "OTP: " + event.data.otp_code : "", event.data.otp_message || ""].filter(Boolean).join("\n");
    if (body) {
      try {
        const { error } = await service.from("messages").insert({
          order_id: providerOrder.order_id,
          user_id: localOrder.user_id,
          provider_id: provider.id,
          provider_message_ref: supplierOrderId + ":" + revision,
          sender: event.data.platform || "SMSCode",
          body_ciphertext: encryptPrivateValue(body),
          received_at: event.timestamp || now,
          status: "received",
          retention_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (error && error.code !== "23505") return new NextResponse("Could not store verification message", { status: 500 });
      } catch {
        return new NextResponse("Secure message storage is not configured", { status: 503 });
      }
    }
    await service.from("orders").update({ status: "waiting_message", updated_at: now }).eq("id", providerOrder.order_id).in("status", ["active","provisioning","review_required"]);
    await service.from("provider_orders").update({
      status: "OTP_RECEIVED",
      last_provider_response: { event: event.event, sms_revision: revision, expires_at: event.data.expires_at ?? null },
      updated_at: now,
    }).eq("id", providerOrder.id);
    return NextResponse.json({ received: true, matched: true });
  }

  // Terminal notifications can arrive out of order. Trust the supplier's current order state, not the event label alone.
  let current: SupplierOrderState;
  try {
    const latest = await smscodeRequest<SupplierOrderState>(`/orders/${encodeURIComponent(supplierOrderId)}`);
    current = latest.data;
  } catch {
    return new NextResponse("Could not verify current supplier order state", { status: 503 });
  }

  if (current.status === "COMPLETED") {
    await service.from("orders").update({ status: "completed", fulfilled_at: now, completed_at: now, updated_at: now })
      .eq("id", providerOrder.order_id).in("status", ["active","waiting_message","provisioning","review_required"]);
    await service.from("provider_orders").update({ status: "COMPLETED", updated_at: now }).eq("id", providerOrder.id);
  } else if (current.status === "EXPIRED" || current.status === "CANCELED") {
    const { error } = await service.rpc("refund_failed_smscode_order", {
      p_order_id: providerOrder.order_id,
      p_reason: current.status === "EXPIRED" ? "Supplier number expired before fulfilment" : "Supplier number was canceled",
    });
    if (error && !error.message.includes("ORDER_NOT_REFUNDABLE")) return new NextResponse("Could not refund supplier cancellation", { status: 500 });
    await service.from("provider_orders").update({ status: current.status, updated_at: now }).eq("id", providerOrder.id);
  } else {
    return NextResponse.json({ received: true, ignored: "supplier_order_not_terminal" });
  }

  return NextResponse.json({ received: true, matched: true });
}
