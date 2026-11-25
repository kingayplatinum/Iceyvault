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
  const secret = process.env.FLW_WEBHOOK_SECRET_HASH;
  const rawBody = await request.text();
  const staticHash = request.headers.get("verif-hash") || "";
  const v4Signature = request.headers.get("flutterwave-signature") || "";
  const digest = secret ? createHmac("sha256", secret).update(rawBody).digest() : null;
  const expectedHex = digest?.toString("hex") || "";
  const expectedBase64 = digest?.toString("base64") || "";
  const validStatic = Boolean(secret && staticHash && safeEqual(staticHash, secret));
  const validV4 = Boolean(secret && v4Signature && (
    safeEqual(v4Signature, expectedHex) ||
    safeEqual(v4Signature, "sha256=" + expectedHex) ||
    safeEqual(v4Signature, expectedBase64)
  ));
  if (!secret || (!validStatic && !validV4)) return new NextResponse("Unauthorized", { status: 401 });

  let payload: {
    event?: string;
    data?: { id?: string | number; reference?: string; status?: string; tx_ref?: string };
  } | null = null;
  try { payload = JSON.parse(rawBody); } catch { return new NextResponse("Invalid JSON", { status: 400 }); }
  if (!payload?.event || !payload.data) return new NextResponse("Invalid payload", { status: 400 });

  if (!["order.completed", "charge.completed"].includes(payload.event)) {
    return NextResponse.json({ received: true });
  }

  const reference = payload.data.reference || payload.data.tx_ref;
  const providerId = payload.data.id == null ? null : String(payload.data.id);
  if (!reference && !providerId) return NextResponse.json({ received: true });

  const service = createServiceClient();
  let query = service.from("payment_transactions").select("id,gateway_transaction_id,gateway_reference")
    .eq("gateway", "flutterwave");
  if (reference) query = query.eq("gateway_reference", reference);
  else if (providerId) query = query.eq("gateway_transaction_id", providerId);
  const { data: payment, error } = await query.maybeSingle();
  if (error) return new NextResponse("Could not locate payment", { status: 500 });
  if (!payment) return NextResponse.json({ received: true, matched: false });
  if (payload.event === "order.completed" && providerId && payment.gateway_transaction_id && providerId !== payment.gateway_transaction_id) {
    return new NextResponse("Provider order mismatch", { status: 409 });
  }

  try {
    await verifyAndCreditWalletPayment(payment.id);
    return NextResponse.json({ received: true, matched: true });
  } catch {
    return new NextResponse("Payment verification pending", { status: 503 });
  }
}
