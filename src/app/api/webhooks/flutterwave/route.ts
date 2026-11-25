import { timingSafeEqual } from "node:crypto";
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
  const signature = request.headers.get("verif-hash") || "";
  if (!secret || !signature || !safeEqual(signature, secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const payload = await request.json().catch(() => null) as {
    event?: string;
    data?: { id?: string | number; reference?: string; status?: string; tx_ref?: string };
  } | null;
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
  if (providerId && payment.gateway_transaction_id && providerId !== payment.gateway_transaction_id) {
    return new NextResponse("Provider order mismatch", { status: 409 });
  }

  try {
    await verifyAndCreditWalletPayment(payment.id);
    return NextResponse.json({ received: true, matched: true });
  } catch {
    return new NextResponse("Payment verification pending", { status: 503 });
  }
}
