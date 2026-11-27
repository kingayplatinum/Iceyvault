import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { z } from "zod";
import { decryptPrivateValue } from "@/lib/crypto-vault";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const [profile, wallet, orders, messages, notifications, transactions] = await Promise.all([
    auth.from("profiles").select("display_name,phone_e164,country_code,billing_address_line1,billing_city,billing_state,billing_postal_code,billing_country").eq("id", user.id).maybeSingle(),
    auth.from("wallets").select("balance_kobo,currency").eq("user_id", user.id).maybeSingle(),
    auth.from("orders").select("id,offer_kind,status,retail_amount_kobo,currency,created_at,expires_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    auth.from("messages").select("id,order_id,sender,body_ciphertext,received_at,status").eq("user_id", user.id).order("received_at", { ascending: false }).limit(30),
    auth.from("notifications").select("id,title,body,category,read_at,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    auth.from("wallet_transactions").select("id,direction,amount_kobo,transaction_type,description,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);

  if (profile.error) return NextResponse.json({ error: "Could not load your profile." }, { status: 500 });
  if (messages.error) return NextResponse.json({ error: "Could not load your verification messages." }, { status: 500 });

  // Message bodies are encrypted at rest. Decrypt only after the authenticated
  // user's RLS-scoped message query has completed; never return ciphertext.
  const messageRows = messages.data ?? [];
  const messageOrderIds = Array.from(new Set(messageRows.map((message) => message.order_id).filter(Boolean)));
  const messageOrders = messageOrderIds.length
    ? await auth.from("orders")
        .select("id,status,retail_amount_kobo,created_at")
        .eq("user_id", user.id)
        .in("id", messageOrderIds)
    : { data: [], error: null };
  if (messageOrders.error) return NextResponse.json({ error: "Could not load verification order details." }, { status: 500 });

  let inboxMessages: Array<{
    id: string; order_id: string; sender: string | null; content: string;
    received_at: string; status: string;
    order: { id: string; status: string; retail_amount_kobo: number; created_at: string } | null;
  }>;
  try {
    const orderById = new Map((messageOrders.data ?? []).map((order) => [order.id, order]));
    inboxMessages = messageRows.map((message) => ({
      id: message.id,
      order_id: message.order_id,
      sender: message.sender,
      content: decryptPrivateValue(message.body_ciphertext),
      received_at: message.received_at,
      status: message.status,
      order: orderById.get(message.order_id) ?? null,
    }));
  } catch {
    return NextResponse.json({ error: "Secure message data is temporarily unavailable. Please try again." }, { status: 503 });
  }

  return NextResponse.json({
    profile: profile.data,
    wallet: wallet.data,
    orders: orders.data ?? [],
    messages: inboxMessages,
    notifications: notifications.data ?? [],
    transactions: transactions.data ?? [],
    email: user.email,
  }, { headers: { "Cache-Control": "no-store" } });
}

function normalizeNigeriaPhone(value?: string | null) {
  if (!value?.trim()) return null;
  const compact = value.trim().replace(/[()\s.-]/g, "");
  if (/^0\d{10}$/.test(compact)) return "+234" + compact.slice(1);
  if (/^234\d{10}$/.test(compact)) return "+" + compact;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^[1-9]\d{7,14}$/.test(compact)) return "+" + compact;
  return compact;
}

const profileSchema = z.object({
  display_name: z.string().trim().min(2, "Enter a name with at least two characters.").max(100),
  phone_e164: z.preprocess(
    (value) => normalizeNigeriaPhone(typeof value === "string" ? value : null),
    z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number, e.g. +2348012345678.").nullable(),
  ),
  billing_address_line1: z.string().trim().max(160).nullable().optional(),
  billing_city: z.string().trim().max(80).nullable().optional(),
  billing_state: z.string().trim().max(80).nullable().optional(),
  billing_postal_code: z.string().trim().min(2, "Enter a valid postal code or leave it blank.").max(20).nullable().optional(),
  billing_country: z.string().trim().length(2).default("NG"),
});

export async function PATCH(request: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message || "Check your profile details and try again." }, { status: 400 });
  }

  // The session is verified above. Use the server-only service client so a missing
  // legacy profile row can be created as well as updated without weakening RLS.
  const service = createServiceClient();
  const { error } = await service.from("profiles").upsert({
    id: user.id,
    display_name: parsed.data.display_name,
    phone_e164: parsed.data.phone_e164,
    billing_address_line1: parsed.data.billing_address_line1 || null,
    billing_city: parsed.data.billing_city || null,
    billing_state: parsed.data.billing_state || null,
    billing_postal_code: parsed.data.billing_postal_code || null,
    billing_country: parsed.data.billing_country.toUpperCase(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  if (error) {
    console.error("IceyVault profile save failed:", { code: error.code, message: error.message });
    return NextResponse.json({ error: "We couldn't save your account details. Check the phone number and try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
