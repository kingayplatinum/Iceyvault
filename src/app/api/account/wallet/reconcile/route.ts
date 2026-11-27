import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyAndCreditWalletPayment } from "@/lib/verify-flutterwave-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer-triggered reconciliation is a safe fallback for bank-transfer
// payments when the browser does not return from checkout or a webhook is delayed.
// The provider's V3 verification endpoint remains the authority before any credit.
export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const service = createServiceClient();
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data: pending, error } = await service.from("payment_transactions")
    .select("id,gateway_reference,amount_kobo")
    .eq("user_id", user.id)
    .eq("gateway", "flutterwave")
    .eq("purpose", "wallet_funding")
    .eq("status", "pending")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: "Could not check pending wallet payments." }, { status: 500 });

  const results: Array<{ reference: string; status: string }> = [];
  for (const payment of pending ?? []) {
    try {
      const result = await verifyAndCreditWalletPayment(payment.id);
      results.push({ reference: payment.gateway_reference, status: result.status });
    } catch (error) {
      // Keep the payment pending; never credit from an unverified browser claim.
      console.error("Flutterwave wallet reconciliation deferred:", {
        paymentId: payment.id,
        reference: payment.gateway_reference,
        reason: error instanceof Error ? error.message : "Unknown verification error",
      });
      results.push({ reference: payment.gateway_reference, status: "pending" });
    }
  }

  const { data: wallet, error: walletError } = await service.from("wallets")
    .select("balance_kobo,currency").eq("user_id", user.id).maybeSingle();
  if (walletError) return NextResponse.json({ error: "Wallet balance could not be refreshed." }, { status: 500 });

  return NextResponse.json({
    checked: results.length,
    results,
    walletBalanceKobo: wallet?.balance_kobo ?? null,
    currency: wallet?.currency ?? "NGN",
  }, { headers: { "Cache-Control": "no-store" } });
}
