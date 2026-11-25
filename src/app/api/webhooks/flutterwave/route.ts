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
  const signature = request.headers.get("verif-hash") || "";
  if (!secret || !signature || !safeEqual(signature, secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: {
    event?: string;
    data?: { id?: string | number; reference?: string; status?: string; tx_ref?: string };
  } | null = null;
  try { payload = JSON.parse(rawBody); } catch { return new NextResponse("Invalid JSON", { status: 400 }); }
  if (!payload?.event || !payload.data) return new NextResponse("Invalid payload", { status: 400 });
  if (payload.event !== "charge.completed") return NextResponse.json({ received: true });

  const reference = payload.data.tx_ref || payload.data.reference;
  const providerId = payload.data.id == null ? null : String(payload.data.id);
  if (!reference || !providerId) return NextResponse.json({ received: true, matched: false });

  const service = createServiceClient();
  const { data: payment, error } = await service.from("payment_transactions")
    .select("id,gateway_transaction_id,gateway_reference")
    .eq("gateway", "flutterwave")
    .eq("gateway_reference", reference)
    .maybeSingle();
  if (error) return new NextResponse("Could not locate payment", { status: 500 });
  if (!payment) return NextResponse.json({ received: true, matched: false });
  if (payment.gateway_transaction_id && payment.gateway_transaction_id !== providerId) {
    return new NextResponse("Provider transaction mismatch", { status: 409 });
  }

  try {
    await verifyAndCreditWalletPayment(payment.id, providerId);
    return NextResponse.json({ received: true, matched: true });
  } catch {
    return new NextResponse("Payment verification pending", { status: 503 });
  }
}
