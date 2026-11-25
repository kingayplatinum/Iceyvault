import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { flutterwaveV4Request } from "@/lib/flutterwave-v4";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type V4Order = {
  id: string;
  amount: number;
  currency: string;
  reference: string;
  status: string;
  next_action?: { type?: string; redirect_url?: { url?: string } };
  redirect_url?: string;
};
const schema = z.object({
  amountKobo: z.number().int().min(5000).max(50_000_000),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to fund your wallet." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid amount between ₦50 and ₦500,000." }, { status: 400 });

  if (!user.email) return NextResponse.json({ error: "A verified email address is required for Flutterwave checkout. Add an email to your account first." }, { status: 400 });\n  if (!process.env.FLW_CLIENT_ID || !process.env.FLW_CLIENT_SECRET || !process.env.FLW_WEBHOOK_SECRET_HASH || !process.env.FLW_API_BASE_URL) {
    return NextResponse.json({ error: "Flutterwave V4 is not fully configured for this environment. No payment was initiated." }, { status: 503 });
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
    if (existing.checkout_url) return NextResponse.json({ checkoutUrl: existing.checkout_url, reference: existing.gateway_reference, reused: true });
    return NextResponse.json({ error: "This payment request is already being processed. Refresh your wallet in a moment.", reference: existing.gateway_reference }, { status: 202 });
  }

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

  const { data: profile } = await service.from("profiles")
    .select("display_name,phone_e164").eq("id", user.id).maybeSingle();
  const displayName = (profile?.display_name || user.email?.split("@")[0] || "IceyVault Customer").trim();
  const parts = displayName.split(/\s+/).filter(Boolean);
  const first = parts[0] && parts[0].length >= 2 ? parts[0] : "IceyVault";
  const last = parts.slice(1).join(" ") || "Customer";
  const phoneDigits = (profile?.phone_e164 || "").replace(/^\+234/, "").replace(/^0/, "");
  const redirectUrl = new URL("/dashboard/wallet", request.nextUrl.origin);
  redirectUrl.searchParams.set("payment", "pending");
  redirectUrl.searchParams.set("reference", reference);

  try {
    const idempotency = `IVW${randomUUID().replaceAll("-", "")}`;
    const traceId = randomUUID().replaceAll("-", "");
    const result = await flutterwaveV4Request<V4Order>("orchestration/direct-orders", {
      method: "POST",
      headers: { "X-Idempotency-Key": idempotency, "X-Trace-Id": traceId },
      body: JSON.stringify({
        amount: parsed.data.amountKobo / 100,
        currency: "NGN",
        reference,
        customer: {
          email: user.email,
          name: { first, last },
          ...(phoneDigits.length >= 7 && phoneDigits.length <= 10
            ? { phone: { country_code: "234", number: phoneDigits } }
            : {}),
        },
        payment_method: { type: "card" },
        redirect_url: redirectUrl.toString(),
        description: "IceyVault wallet funding",
        meta: { payment_id: payment.id, purpose: "wallet_funding" },
      }),
    });

    const checkoutUrl = result.data.next_action?.redirect_url?.url || result.data.redirect_url;
    if (!checkoutUrl || !/^https:\/\//i.test(checkoutUrl)) {
      await service.from("payment_transactions").update({
        gateway_transaction_id: result.data.id,
        raw_event: { provider_status: result.data.status, message: "V4 order created without a hosted redirect URL" },
        updated_at: new Date().toISOString(),
      }).eq("id", payment.id);
      return NextResponse.json({ error: "Flutterwave created the order but did not return a hosted checkout link. The payment remains pending; contact support before retrying.", reference }, { status: 202 });
    }

    await service.from("payment_transactions").update({
      gateway_transaction_id: result.data.id,
      checkout_url: checkoutUrl,
      raw_event: { provider_order_id: result.data.id, provider_status: result.data.status },
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id);

    return NextResponse.json({ checkoutUrl, reference }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      await service.from("payment_transactions").update({
        status: "failed", raw_event: { provider_error: (error as Error).message }, updated_at: new Date().toISOString(),
      }).eq("id", payment.id);
      return NextResponse.json({ error: "Flutterwave declined the checkout request. No wallet funds were added." }, { status: 502 });
    }
    return NextResponse.json({
      error: "Flutterwave did not return a conclusive response. The payment request remains pending; retry with the same request key or contact support.",
      reference,
    }, { status: 202 });
  }
}
