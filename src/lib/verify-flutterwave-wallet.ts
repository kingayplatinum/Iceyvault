import { createServiceClient } from "@/lib/supabase/service";
import { flutterwaveV4Request } from "@/lib/flutterwave-v4";

type V4Order = {
  id: string;
  amount: number;
  currency: string;
  reference: string;
  status: "completed" | "pending" | "authorized" | "partially-completed" | "voided" | "failed";
};

export async function verifyAndCreditWalletPayment(paymentId: string) {
  const service = createServiceClient();
  const { data: payment, error } = await service.from("payment_transactions")
    .select("id,user_id,wallet_id,gateway,gateway_reference,gateway_transaction_id,amount_kobo,currency,status")
    .eq("id", paymentId).maybeSingle();
  if (error || !payment) throw new Error("PAYMENT_NOT_FOUND");
  if (payment.gateway !== "flutterwave" || payment.currency !== "NGN") throw new Error("INVALID_PAYMENT");
  if (payment.status === "successful") return { credited: false, status: "successful" };
  if (payment.status !== "pending") return { credited: false, status: payment.status };
  if (!payment.gateway_transaction_id) return { credited: false, status: "pending" };

  const result = await flutterwaveV4Request<V4Order>(`orders/${encodeURIComponent(payment.gateway_transaction_id)}`);
  const order = result.data;
  if (
    order.reference !== payment.gateway_reference ||
    order.currency !== "NGN" ||
    !Number.isFinite(order.amount) ||
    Math.round(order.amount * 100) !== payment.amount_kobo
  ) throw new Error("FLUTTERWAVE_ORDER_MISMATCH");

  if (order.status === "failed" || order.status === "voided") {
    await service.from("payment_transactions").update({
      status: "failed",
      failure_reason: "Flutterwave order " + order.status,
      raw_event: { provider_order_id: order.id, provider_status: order.status },
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id).eq("status", "pending");
    return { credited: false, status: "failed" };
  }
  if (order.status !== "completed") return { credited: false, status: "pending" };

  const { data: settlement, error: settlementError } = await service.rpc("settle_flutterwave_payment", {
    p_tx_ref: payment.gateway_reference,
    p_gateway_transaction_id: order.id,
    p_verified_amount_kobo: Math.round(order.amount * 100),
    p_currency: order.currency,
    p_gateway_status: "successful",
    p_raw_event: {
      provider_order_id: order.id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      reference: order.reference,
    },
  });
  if (settlementError) throw new Error(settlementError.message || "WALLET_SETTLEMENT_FAILED");
  return { credited: settlement?.status === "settled", status: "successful" };
}
