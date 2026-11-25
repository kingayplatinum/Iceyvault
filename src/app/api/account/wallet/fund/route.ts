import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type V3CheckoutResponse = {
  status?: string;
  message?: string;
  data?: { link?: string };
};
const schema = z.object({
  amountKobo: z.number().int().min(5000).max(50_000_000),
  idempotencyKey: z.string().uuid(),
}).refine((value) => value.amountKobo % 100 === 0, {
  message: "Enter a whole naira amount. Flutterwave Standard V3 accepts integer amounts.",
});

export async function POST(request: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to fund your wallet." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid amount between ₦50 and ₦500,000." }, { status: 400 });
  if (!user.email) return NextResponse.json({ error: "A valid email address is required for Flutterwave checkout." }, { status: 400 });

  const secretKey = process.env.FLW_SECRET_KEY;
  const webhookSecret = process.env.FLW_WEBHOOK_SECRET_HASH;
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: "Flutterwave Standard is not fully configured. No payment was initiated." }, { status: 503 });
  }

  const service = createServiceClient();
  const { data: wallet, error: walletError } = await service.from("wallets")
    .select("id").eq("user_id", user.id).maybeSingle();
  if (walletError || !wallet) return NextResponse.json({ error: "Your wallet account could not be found." }, { status: 404 });

  const { data: existing } = await service.from("payment_transactions")
    .select("id,gateway_reference,gateway_transaction_id,checkout_url,status,amount_kobo")
    .eq("user_id", user.id).eq("gateway", "flutterwave")
    .eq("idempotency_key", parsed.data.idempotencyKey).maybeSingle();
  if (existing) {
    if (existing.amount_kobo !== parsed.data.amountKobo) {
      return NextResponse.json({ error: "This request key was already used for a different amount." }, { status: 409 });
    }
    if (existing.status !== "pending") {
      return NextResponse.json({ error: "This payment request is already settled or failed. Start a new funding request." }, { status: 409 });
    }
    if (existing.checkout_url) return NextResponse.json({ checkoutUrl: existing.checkout_url, reference: existing.gateway_reference, reused: true });
    return NextResponse.json({ error: "This payment request is already being processed. Refresh your wallet in a moment.", reference: existing.gateway_reference }, { status: 202 });
  }

  const { data: profile } = await service.from("profiles")
    .select("display_name,phone_e164").eq("id", user.id).maybeSingle();

  const reference = `IVW${randomUUID().replaceAll("-", "")}`;
  const { data: payment, error: paymentError } = await service.from("payment_transactions").insert({
    user_id: user.id,
    wallet_id: wallet.id,
    gateway: "flutterwave",
    gateway_reference: reference,
    amount_kobo: parsed.data.amountKobo,
    currency: "NGN",
    status: "pending",
    idempotency_key: parsed.data.idempotencyKey,
  }).select("id").single();
  if (paymentError || !payment) return NextResponse.json({ error: "Could not create a payment request. Please retry once." }, { status: 500 });

  const displayName = (profile?.display_name || user.email.split("@")[0] || "IceyVault Customer").trim();
  const phoneNumber = (profile?.phone_e164 || "").replace(/[^0-9]/g, "");
  const redirectUrl = new URL("/dashboard/wallet", request.nextUrl.origin);
  redirectUrl.searchParams.set("payment", "pending");
  redirectUrl.searchParams.set("reference", reference);

  try {
    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        tx_ref: reference,
        amount: Math.round(parsed.data.amountKobo / 100),
        currency: "NGN",
        // Nigerian NGN methods: bank transfer (temporary virtual account), card,
        // bank account, USSD and other supported local methods.
        // Flutterwave account-level preferred-method settings must be disabled
        // for this per-transaction list to take effect.
        payment_options: "card, banktransfer, account, ussd, opay, nqr, enaira, internetbanking",
        redirect_url: redirectUrl.toString(),
        customer: {
          email: user.email,
          name: displayName,
          ...(phoneNumber.length >= 7 ? { phone_number: phoneNumber } : {}),
        },
        customizations: {
          title: "IceyVault Wallet Funding",
          description: "Add funds to your IceyVault NGN wallet",
        },
        configuration: { session_duration: 30, max_retry_attempt: 5 },
        meta: { payment_id: payment.id, purpose: "wallet_funding" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const result = await response.json().catch(() => null) as V3CheckoutResponse | null;
    const checkoutUrl = result?.data?.link;
    if (!response.ok || result?.status !== "success" || !checkoutUrl || !checkoutUrl.startsWith("https://checkout.flutterwave.com/")) {
      await service.from("payment_transactions").update({
        status: "failed",
        failure_reason: (result?.message || "Flutterwave did not return a valid hosted checkout link.").slice(0, 500),
        raw_event: { provider_status: result?.status ?? null, provider_message: result?.message ?? null, http_status: response.status },
        updated_at: new Date().toISOString(),
      }).eq("id", payment.id).eq("status", "pending");
      return NextResponse.json({
        error: result?.message || "Flutterwave could not create a hosted checkout. No wallet funds were added.",
        reference,
      }, { status: 502 });
    }

    const { error: updateError } = await service.from("payment_transactions").update({
      checkout_url: checkoutUrl,
      raw_event: { provider_status: result.status, provider_message: result.message, checkout: "flutterwave_standard_v3" },
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id).eq("status", "pending");
    if (updateError) {
      return NextResponse.json({ error: "Checkout was created but could not be saved safely. Contact support before starting another payment.", reference }, { status: 202 });
    }

    return NextResponse.json({ checkoutUrl, reference }, { status: 201 });
  } catch {
    return NextResponse.json({
      error: "Flutterwave did not return a conclusive response. The request remains pending; retry with the same amount so the same request key is reused.",
      reference,
    }, { status: 202 });
  }
}
