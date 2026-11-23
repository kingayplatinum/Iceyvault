import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.service
    .from("smscode_service_catalogue")
    .select("id,service_key,display_name,sms_code_service_code,supported,active,last_verified_at,verification_note")
    .order("display_name");
  if (error) return NextResponse.json({ error: "Could not load service catalogue." }, { status: 500 });
  const { data: tiers, error: tierError } = await auth.service
    .from("smscode_product_tiers")
    .select("id,service_id,tier_key,tier_label,country_iso2,smscode_product_id,smscode_catalog_product_id,max_supplier_price_usd,retail_price_kobo,active,last_supplier_price_usd,last_inventory_count,last_verified_at")
    .order("service_id").order("tier_key");
  if (tierError) return NextResponse.json({ error: "Could not load product tiers." }, { status: 500 });
  return NextResponse.json({ services: data ?? [], tiers: tiers ?? [] });
}
