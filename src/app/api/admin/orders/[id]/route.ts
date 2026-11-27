import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { decryptPrivateValue } from "@/lib/crypto-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const { data: order, error } = await auth.service.from("orders")
    .select("id,user_id,status,retail_amount_kobo,currency,created_at,updated_at,fulfilled_at,expires_at,number_id,offer_kind")
    .eq("id", id).maybeSingle();
  if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const [providerResult, numberResult, messagesResult, tierResult] = await Promise.all([
    auth.service.from("provider_orders").select("provider_order_ref,status,supplier_cost_usd,wholesale_amount_minor,wholesale_currency,last_provider_response").eq("order_id", id).maybeSingle(),
    order.number_id ? auth.service.from("numbers").select("e164_ciphertext,e164_last4,country_iso2,service_code,status").eq("id", order.number_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    auth.service.from("messages").select("id,sender,body_ciphertext,received_at,status").eq("order_id", id).order("received_at", { ascending: false }).limit(30),
    order.smscode_tier_id ? auth.service.from("smscode_product_tiers").select("tier_label,country_iso2,retail_price_kobo").eq("id", order.smscode_tier_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (providerResult.error || numberResult.error || messagesResult.error || tierResult.error) {
    return NextResponse.json({ error: "Could not load complete order details." }, { status: 500 });
  }

  let phoneNumber: string | null = null;
  let messages: Array<{ id: string; sender: string | null; content: string; received_at: string }> = [];
  try {
    if (numberResult.data?.e164_ciphertext) phoneNumber = decryptPrivateValue(numberResult.data.e164_ciphertext);
    messages = (messagesResult.data ?? []).map((message) => ({
      id: message.id, sender: message.sender,
      content: decryptPrivateValue(message.body_ciphertext), received_at: message.received_at,
    }));
  } catch {
    return NextResponse.json({ error: "Secure order data could not be decrypted." }, { status: 503 });
  }
  return NextResponse.json({
    order, provider: providerResult.data, number: numberResult.data ? { ...numberResult.data, phoneNumber } : null,
    tier: tierResult.data, messages,
  }, { headers: { "Cache-Control": "no-store" } });
}
