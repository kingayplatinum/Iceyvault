import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyAndCreditWalletPayment } from "@/lib/verify-flutterwave-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const reference = request.nextUrl.searchParams.get("reference");
  if (!reference || !/^[A-Za-z0-9-]{6,42}$/.test(reference)) {
    return NextResponse.json({ error: "A valid payment reference is required." }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: payment, error } = await service.from("payment_transactions")
    .select("id,status,amount_kobo,currency,gateway_reference")
    .eq("user_id", user.id).eq("gateway", "flutterwave")
    .eq("gateway_reference", reference).maybeSingle();
  if (error || !payment) return NextResponse.json({ error: "Payment request not found." }, { status: 404 });

  try {
    const result = await verifyAndCreditWalletPayment(payment.id);
    const { data: wallet } = await service.from("wallets")
      .select("balance_kobo,currency").eq("user_id", user.id).maybeSingle();
    return NextResponse.json({
      status: result.status,
      credited: result.credited,
      amountKobo: payment.amount_kobo,
      walletBalanceKobo: wallet?.balance_kobo ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "pending", message: "Flutterwave has not yet confirmed this payment. Your wallet has not been credited." }, { status: 202 });
  }
}
