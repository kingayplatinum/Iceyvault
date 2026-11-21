import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country")?.toUpperCase();
  const service = url.searchParams.get("service")?.toLowerCase();
  const supabase = await createClient();
  let query = supabase.from("provider_products")
    .select("id,country_iso2,country_name,service_code,service_name,channel,offer_kind,number_class,term_minutes,currency,retail_amount_kobo,inventory_count,verified_at")
    .eq("active", true)
    .order("country_name", { ascending: true });
  if (country && /^[A-Z]{2}$/.test(country)) query = query.eq("country_iso2", country);
  if (service && /^[a-z0-9_-]{1,60}$/.test(service)) query = query.eq("service_code", service);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Catalogue is temporarily unavailable." }, { status: 503 });
  const products = (data ?? []).map((item) => ({
    ...item,
    available: (item.inventory_count ?? 0) > 0,
    priceKobo: item.retail_amount_kobo,
  }));
  return NextResponse.json({ products, count: products.length, source: "verified_supplier_catalogue" }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
