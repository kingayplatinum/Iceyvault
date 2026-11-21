import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/payments/flutterwave";
import { verifyFlutterwaveTransaction } from "@/lib/payments/flutterwave";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const txRef = url.searchParams.get("tx_ref");
  const transactionId = url.searchParams.get("transaction_id");
  const status = url.searchParams.get("status");
  const origin = process.env.ICEYVAULT_APP_URL ?? url.origin;
  if (!txRef || !transactionId || status !== "successful") {
    return NextResponse.redirect(new URL("/dashboard?payment=pending", origin));
  }
  try {
    const verified = await verifyFlutterwaveTransaction(transactionId);
    const tx = verified.data;
    if (tx.status !== "successful" || tx.tx_ref !== txRef) throw new Error("Flutterwave verification did not match the expected payment.");
    const db = createServiceClient();
    const { data, error } = await db.rpc("settle_flutterwave_payment", {
      p_tx_ref: txRef,
      p_gateway_transaction_id: String(tx.id),
      p_verified_amount_kobo: Math.round(tx.amount * 100),
      p_currency: tx.currency,
      p_gateway_status: tx.status,
      p_raw_event: { id: tx.id, tx_ref: tx.tx_ref, status: tx.status, amount: tx.amount, currency: tx.currency },
    });
    if (error) throw error;
    const result = data as { purpose?: string };
    return NextResponse.redirect(new URL(`/dashboard?payment=success&purpose=${result.purpose ?? "unknown"}`, origin));
  } catch {
    return NextResponse.redirect(new URL("/dashboard?payment=verification_pending", origin));
  }
}
