import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptPrivateValue } from "@/lib/crypto-vault";
import { smscodeRequest } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupplierOrder = {
  id: number; status: string; otp_code?: string | null; otp_message?: string | null;
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

  const [numberResult, providerResult, messagesResult] = await Promise.all([
    order.number_id ? service.from("numbers").select("e164_ciphertext,e164_last4").eq("id", order.number_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    service.from("provider_orders").select("provider_order_ref,status").eq("order_id", order.id).maybeSingle(),
    service.from("messages").select("id,sender,body_ciphertext,received_at,status").eq("order_id", order.id).eq("user_id", user.id).order("received_at", { ascending: false }).limit(20),
  ]);
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
      const result = await smscodeRequest<{ order_id: number; status: string }>( "/orders/cancel", {
        method: "POST", body: JSON.stringify({ id: supplierId }),
      });
      if (result.data.status !== "CANCELED") return NextResponse.json({ error: "The supplier has not confirmed cancellation. Your wallet has not been refunded." }, { status: 409 });
      const { error } = await service.rpc("refund_failed_smscode_order", { p_order_id: id, p_reason: "Customer canceled supplier number" });
      if (error) return NextResponse.json({ error: "Supplier canceled the number, but the wallet refund needs administrator reconciliation." }, { status: 202 });
      await service.from("provider_orders").update({ status: "CANCELED", updated_at: new Date().toISOString() }).eq("order_id", id);
      return NextResponse.json({ status: "refunded", message: "Number canceled and wallet refunded." });
    }

    if (parsed.data.action === "finish") {
      if (order.status !== "waiting_message") return NextResponse.json({ error: "Finish is available after a verification message has arrived." }, { status: 409 });
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
