import { createServiceClient } from "@/lib/supabase/service";

type V3Transaction = {
  id: number | string;
  tx_ref: string;
  amount: number;
  currency: string;
  status: string;
  charged_amount?: number;
  flw_ref?: string;
};
type V3Envelope = { status?: string; message?: string; data?: V3Transaction };

export async function verifyAndCreditWalletPayment(paymentId: string, providerTransactionId?: string | null) {
  const service = createServiceClient();
  const { data: payment, error } = await service.from("payment_transactions")
    .select("id,user_id,wallet_id,gateway,gateway_reference,gateway_transaction_id,amount_kobo,currency,status")
    .eq("id", paymentId).maybeSingle();
  if (error || !payment) throw new Error("PAYMENT_NOT_FOUND");
  if (payment.gateway !== "flutterwave" || payment.currency !== "NGN") throw new Error("INVALID_PAYMENT");
  if (payment.status === "successful") return { credited: false, status: "successful" };
  if (payment.status !== "pending") return { credited: false, status: payment.status };

  const transactionId = providerTransactionId || payment.gateway_transaction_id;
  if (!transactionId) return { credited: false, status: "pending" };
  if (payment.gateway_transaction_id && String(payment.gateway_transaction_id) !== String(transactionId)) {
    throw new Error("FLUTTERWAVE_TRANSACTION_ID_MISMATCH");
  }

  const secretKey = process.env.FLW_SECRET_KEY;
  if (!secretKey) throw new Error("FLW_SECRET_KEY is not configured.");
  const response = await fetch(
    `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transactionId))}/verify`,
    { method: "GET", headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  const payload = await response.json().catch(() => null) as V3Envelope | null;
  if (!response.ok || payload?.status !== "success" || !payload.data) {
    throw new Error(payload?.message || `Flutterwave transaction verification failed (${response.status}).`);
  }

  const transaction = payload.data;
  if (
    String(transaction.id) !== String(transactionId) ||
    transaction.tx_ref !== payment.gateway_reference ||
    transaction.currency !== "NGN" ||
    !Number.isFinite(Number(transaction.amount)) ||
    Math.round(Number(transaction.amount) * 100) !== payment.amount_kobo
  ) throw new Error("FLUTTERWAVE_TRANSACTION_MISMATCH");

  if (transaction.status === "failed" || transaction.status === "cancelled") {
    await service.from("payment_transactions").update({
      gateway_transaction_id: String(transaction.id),
      status: "failed",
      failure_reason: "Flutterwave transaction " + transaction.status,
      raw_event: { provider_transaction_id: String(transaction.id), provider_status: transaction.status, tx_ref: transaction.tx_ref },
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id).eq("status", "pending");
    return { credited: false, status: "failed" };
  }

  if (transaction.status !== "successful") {
    if (!payment.gateway_transaction_id) await service.from("payment_transactions").update({
      gateway_transaction_id: String(transaction.id),
      raw_event: { provider_transaction_id: String(transaction.id), provider_status: transaction.status },
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id).eq("status", "pending");
    return { credited: false, status: "pending" };
  }

  const { data: settlement, error: settlementError } = await service.rpc("settle_flutterwave_payment", {
    p_tx_ref: payment.gateway_reference,
    p_gateway_transaction_id: String(transaction.id),
    p_verified_amount_kobo: Math.round(Number(transaction.amount) * 100),
    p_currency: transaction.currency,
    p_gateway_status: "successful",
    p_raw_event: {
      provider_transaction_id: String(transaction.id),
      flw_ref: transaction.flw_ref ?? null,
      status: transaction.status,
      amount: transaction.amount,
      charged_amount: transaction.charged_amount ?? null,
      currency: transaction.currency,
      tx_ref: transaction.tx_ref,
    },
  });
  if (settlementError) throw new Error(settlementError.message || "WALLET_SETTLEMENT_FAILED");
  return { credited: settlement?.status === "settled", status: "successful" };
}
