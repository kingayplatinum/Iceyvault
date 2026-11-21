import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/payments/flutterwave";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await createClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in to create an order." }, { status: 401 });
  const body = await request.json().catch(() => null) as { productId?: string; idempotencyKey?: string } | null;
  if (!body?.productId || !body.idempotencyKey || body.idempotencyKey.length < 16 || body.idempotencyKey.length > 120) {
    return NextResponse.json({ error: "A product ID and valid idempotency key are required." }, { status: 400 });
  }
  const db = createServiceClient();
  const { data: existing } = await db.from("orders").select("id,status,retail_amount_kobo")
    .eq("user_id", user.id).eq("idempotency_key", body.idempotencyKey).maybeSingle();
  if (existing) return NextResponse.json({ order: existing, reused: true });
  const { data: product, error: productError } = await db.from("provider_products")
    .select("id,offer_kind,retail_amount_kobo,inventory_count,verified_at,active")
    .eq("id", body.productId).eq("active", true).maybeSingle();
  if (productError || !product || !product.retail_amount_kobo || product.retail_amount_kobo <= 0) {
    return NextResponse.json({ error: "This service is not currently available for purchase." }, { status: 404 });
  }
  const verifiedAt = product.verified_at ? new Date(product.verified_at).getTime() : 0;
  if (!product.inventory_count || product.inventory_count < 1 || Date.now() - verifiedAt > 90_000) {
    return NextResponse.json({ error: "Availability is not current. Refresh the catalogue and try again." }, { status: 409 });
  }
  const { data: order, error } = await db.from("orders").insert({
    user_id: user.id, provider_product_id: product.id, offer_kind: product.offer_kind,
    status: "pending_payment", retail_amount_kobo: product.retail_amount_kobo, currency: "NGN",
    idempotency_key: body.idempotencyKey, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  }).select("id,status,retail_amount_kobo,expires_at").single();
  if (error || !order) return NextResponse.json({ error: "Could not create your order." }, { status: 500 });
  return NextResponse.json({ order, reused: false }, { status: 201 });
}
