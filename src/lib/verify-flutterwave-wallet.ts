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

async function requestVerification(url: string, secretKey: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as V3Envelope | null;
  return { response, payload };
}

export async function verifyAndCreditWalletPayment(paymentId: string, providerTransactionId?: string | null) {
  const service = createServiceClient();
  const { data: payment, error } = await service.from("payment_transactions")
    .select("id,user_id,wallet_id,gateway,gateway_reference,gateway_transaction_id,amount_kobo,currency,status")
    .eq("id", paymentId).maybeSingle();
  if (error || !payment) throw new Error("PAYMENT_NOT_FOUND");
  if (payment.gateway !== "flutterwave" || payment.currency !== "NGN") throw new Error("INVALID_PAYMENT");
  if (payment.status === "successful") return { credited: false, status: "successful" };
  if (payment.status !== "pending") return { credited: false, status: payment.status };

  const suppliedId = providerTransactionId || payment.gateway_transaction_id;
  if (payment.gateway_transaction_id && suppliedId && String(payment.gateway_transaction_id) !== String(suppliedId)) {
    throw new Error("FLUTTERWAVE_TRANSACTION_ID_MISMATCH");
  }

  const secretKey = process.env.FLW_SECRET_KEY;
  if (!secretKey) throw new Error("FLW_SECRET_KEY is not configured.");

  // Flutterwave webhook payloads may contain a charge identifier that is not
  // the V3 transaction ID. Try the numeric ID first, but fall back to the
  // unique merchant tx_ref when that ID cannot be resolved by V3.
  const numericId = suppliedId && /^\d+$/.test(String(suppliedId)) ? String(suppliedId) : null;
  let verification: Awaited<ReturnType<typeof requestVerification>> | null = null;
  if (numericId) {
    verification = await requestVerification(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(numericId)}/verify`,
      secretKey,
    );
  }

  if (!verification || !verification.response.ok || verification.payload?.status !== "success" || !verification.payload.data) {
    verification = await requestVerification(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(payment.gateway_reference)}`,
      secretKey,
    );
  }

  const { response, payload } = verification;
  if (!response.ok || payload?.status !== "success" || !payload.data) {
    throw new Error(payload?.message || `Flutterwave transaction verification failed (${response.status}).`);
  }

  const transaction = payload.data;
  if (
    (numericId !== null && String(transaction.id) !== numericId && transaction.tx_ref !== payment.gateway_reference) ||
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
    await service.from("payment_transactions").update({
      gateway_transaction_id: String(transaction.id),
      raw_event: { provider_transaction_id: String(transaction.id), provider_status: transaction.status, tx_ref: transaction.tx_ref },
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
