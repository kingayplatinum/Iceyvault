import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyAndCreditWalletPayment } from "@/lib/verify-flutterwave-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const secretHash = process.env.FLW_WEBHOOK_SECRET_HASH;
  const rawBody = await request.text();
  const signature = request.headers.get("flutterwave-signature") || "";
  const legacyHash = request.headers.get("verif-hash") || "";

  if (!secretHash) {
    console.error("Flutterwave webhook rejected: FLW_WEBHOOK_SECRET_HASH is not configured.");
    return new NextResponse("Webhook secret is not configured", { status: 503 });
  }
  const expectedSignature = createHmac("sha256", secretHash).update(rawBody).digest("base64");
  // Flutterwave integrations may send either the newer HMAC signature or
  // the legacy verif-hash. Accept either valid header if both are present.
  const signatureValid =
    Boolean(signature && safeEqual(signature, expectedSignature)) ||
    Boolean(legacyHash && safeEqual(legacyHash, secretHash));
  if (!signatureValid) {
    console.warn("Flutterwave webhook rejected: signature mismatch.", {
      hasFlutterwaveSignature: Boolean(signature),
      hasLegacyVerificationHash: Boolean(legacyHash),
    });
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: {
    type?: string;
    event?: string;
    data?: { id?: string | number; reference?: string; tx_ref?: string; status?: string };
  } | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  if (!payload?.data) return new NextResponse("Invalid payload", { status: 400 });

  const eventType = payload.event || payload.type;
  const reference = payload.data.tx_ref || payload.data.reference;
  console.info("Flutterwave webhook received.", {
    eventType: eventType || "unknown",
    reference: reference || null,
    providerTransactionId: payload.data.id == null ? null : String(payload.data.id),
    providerStatus: payload.data.status || null,
  });
  if (eventType !== "charge.completed") return NextResponse.json({ received: true });
  if (!reference) return NextResponse.json({ received: true, matched: false });

  const providerId = payload.data.id == null ? null : String(payload.data.id);
  const service = createServiceClient();
  const { data: payment, error } = await service.from("payment_transactions")
    .select("id,gateway_transaction_id,gateway_reference")
    .eq("gateway", "flutterwave")
    .eq("gateway_reference", reference)
    .maybeSingle();

  if (error) return new NextResponse("Could not locate payment", { status: 500 });
  if (!payment) return NextResponse.json({ received: true, matched: false });
  if (payment.gateway_transaction_id && providerId && /^\d+$/.test(providerId) &&
      payment.gateway_transaction_id !== providerId) {
    return new NextResponse("Provider transaction mismatch", { status: 409 });
  }

  try {
    // V3 Standard uses numeric transaction IDs. Newer webhook payloads can expose
    // charge IDs instead, so the verifier falls back to the unique tx_ref.
    await verifyAndCreditWalletPayment(payment.id, providerId && /^\d+$/.test(providerId) ? providerId : null);
    return NextResponse.json({ received: true, matched: true });
  } catch {
    // A non-200 response asks Flutterwave to retry; the wallet remains uncredited
    // until the authoritative V3 verification and atomic settlement succeed.
    return new NextResponse("Payment verification pending", { status: 503 });
  }
}
