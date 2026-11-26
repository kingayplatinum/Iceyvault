import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const { data: services, error: serviceError } = await auth.service
    .from("smscode_service_catalogue")
    .select("id,service_key,display_name,sms_code_service_code,supported,active,last_verified_at,verification_note")
    .order("display_name");
  if (serviceError) return NextResponse.json({ error: "Could not load service catalogue." }, { status: 500 });

  const tiers: unknown[] = [];
  const countryMap = new Map<string, { code: string; name: string }>();
  const pageSize = 1000;
  let expectedTotal = 0;
  for (let from = 0; ; from += pageSize) {
    const { data, error, count } = await auth.service
      .from("smscode_product_tiers")
      .select("id,service_id,tier_key,tier_label,country_iso2,country_name,smscode_product_id,smscode_catalog_product_id,smscode_operator_id,max_supplier_price_usd,retail_price_kobo,active,last_supplier_price_usd,last_inventory_count,last_verified_at", { count: "exact" })
      .order("country_iso2")
      .order("service_id")
      .order("tier_key")
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: "Could not load imported supplier products." }, { status: 500 });
    if (from === 0) expectedTotal = count ?? 0;
    for (const tier of data ?? []) {
      const row = tier as { country_iso2?: string; country_name?: string | null };
      if (row.country_iso2) countryMap.set(row.country_iso2, {
        code: row.country_iso2,
        name: row.country_name || row.country_iso2,
      });
    }
    tiers.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  if (tiers.length !== expectedTotal) {
    return NextResponse.json({ error: "Supplier catalogue pagination was incomplete. Refresh and try again.", expected: expectedTotal, received: tiers.length }, { status: 502 });
  }

  const countries = [...countryMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ services: services ?? [], tiers, countries, totalTiers: tiers.length }, {
    headers: { "Cache-Control": "no-store" },
  });
}
