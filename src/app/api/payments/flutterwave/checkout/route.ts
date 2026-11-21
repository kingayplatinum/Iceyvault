import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, flutterwaveRequest } from "@/lib/payments/flutterwave";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authClient = await createClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user || !user.email) return NextResponse.json({ error: "Sign in before checkout." }, { status: 401 });
  const body = await request.json().catch(() => null) as { purpose?: string; amountKobo?: number; orderId?: string } | null;
  if (!body || !["wallet_funding", "order_payment"].includes(body.purpose ?? "")) return NextResponse.json({ error: "Choose wallet_funding or order_payment." }, { status: 400 });

  const db = createServiceClient();
  const { data: wallet, error: walletError } = await db.from("wallets").select("id").eq("user_id", user.id).single();
  if (walletError || !wallet) return NextResponse.json({ error: "Customer wallet is not initialized." }, { status: 409 });

  let amountKobo: number;
  let orderId: string | null = null;
  if (body.purpose === "wallet_funding") {
    amountKobo = Number(body.amountKobo);
    if (!Number.isSafeInteger(amountKobo) || amountKobo < 50000 || amountKobo > 500_000_000) return NextResponse.json({ error: "Wallet funding must be between ₦500 and ₦5,000,000." }, { status: 400 });
  } else {
    if (!body.orderId) return NextResponse.json({ error: "Order ID is required." }, { status: 400 });
    const { data: order, error } = await db.from("orders").select("id,user_id,retail_amount_kobo,status,expires_at").eq("id", body.orderId).eq("user_id", user.id).maybeSingle();
    if (error || !order || order.status !== "pending_payment" || (order.expires_at && new Date(order.expires_at).getTime() < Date.now())) return NextResponse.json({ error: "A payable order could not be found or has expired." }, { status: 404 });
    const { data: existing } = await db.from("payment_transactions").select("gateway_reference,checkout_url,status").eq("order_id", order.id).eq("status", "pending").not("checkout_url", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing?.checkout_url) return NextResponse.json({ checkoutUrl: existing.checkout_url, reference: existing.gateway_reference, reused: true });
    amountKobo = order.retail_amount_kobo;
    orderId = order.id;
  }

  const txRef = `iv_${randomUUID().replaceAll("-", "")}`;
  const origin = process.env.ICEYVAULT_APP_URL ?? new URL(request.url).origin;
  const { error: insertError } = await db.from("payment_transactions").insert({
    user_id: user.id, wallet_id: wallet.id, gateway: "flutterwave", gateway_reference: txRef,
    amount_kobo: amountKobo, currency: "NGN", status: "pending", purpose: body.purpose, order_id: orderId,
  });
  if (insertError) return NextResponse.json({ error: "Could not create payment record." }, { status: 500 });
  try {
    const checkout = await flutterwaveRequest<{status:string;data:{link:string}}>("/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: txRef, amount: (amountKobo / 100).toFixed(2), currency: "NGN",
        redirect_url: `${origin}/api/payments/flutterwave/callback`,
        customer: { email: user.email, name: user.user_metadata?.name ?? user.email.split("@")[0] },
        customizations: { title: "IceyVault", description: body.purpose === "wallet_funding" ? "Wallet funding" : "Number service order" },
        meta: { user_id: user.id, purpose: body.purpose, order_id: orderId },
        configuration: { session_duration: 30, max_retry_attempt: 3 },
      }),
    });
    await db.from("payment_transactions").update({ checkout_url: checkout.data.link }).eq("gateway_reference", txRef);
    return NextResponse.json({ checkoutUrl: checkout.data.link, reference: txRef });
  } catch (error) {
    await db.from("payment_transactions").update({ status: "failed", failure_reason: error instanceof Error ? error.message.slice(0, 500) : "Checkout initialization failed" }).eq("gateway_reference", txRef);
    return NextResponse.json({ error: "Flutterwave checkout could not be initialized." }, { status: 502 });
  }
}
