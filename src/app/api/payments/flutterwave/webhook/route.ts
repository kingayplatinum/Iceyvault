import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/payments/flutterwave";
import { verifyFlutterwaveTransaction } from "@/lib/payments/flutterwave";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secretHash = process.env.FLW_WEBHOOK_SECRET_HASH;
  const signature = request.headers.get("verif-hash");
  if (!secretHash || !signature || signature !== secretHash) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as {
    event?: string; type?: string; data?: { id?: number | string; tx_ref?: string };
  } | null;
  const transactionId = body?.data?.id;
  const txRef = body?.data?.tx_ref;
  if (!transactionId || !txRef) return NextResponse.json({ received: true, ignored: true });

  const db = createServiceClient();
  const eventId = String(transactionId);
  await db.from("payment_webhook_events").upsert({
    provider: "flutterwave",
    event_id: eventId,
    event_type: body?.event ?? body?.type ?? "unknown",
    payload: body,
  }, { onConflict: "provider,event_id", ignoreDuplicates: true });

  try {
    const verified = await verifyFlutterwaveTransaction(String(transactionId));
    const tx = verified.data;
    if (tx.status !== "successful" || tx.tx_ref !== txRef) {
      return NextResponse.json({ received: true, settled: false });
    }
    const { error } = await db.rpc("settle_flutterwave_payment", {
      p_tx_ref: txRef,
      p_gateway_transaction_id: String(tx.id),
      p_verified_amount_kobo: Math.round(tx.amount * 100),
      p_currency: tx.currency,
      p_gateway_status: tx.status,
      p_raw_event: body,
    });
    if (error) throw error;
    await db.from("payment_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq("provider", "flutterwave").eq("event_id", eventId);
    return NextResponse.json({ received: true, settled: true });
  } catch (error) {
    await db.from("payment_webhook_events").update({
      processing_error: error instanceof Error ? error.message.slice(0, 500) : "Settlement failed",
    }).eq("provider", "flutterwave").eq("event_id", eventId);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
