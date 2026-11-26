import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SERVICE_KEYS = [
  "whatsapp", "telegram", "facebook", "google", "signal", "textfree", "google_voice",
];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const params = request.nextUrl.searchParams;
  const country = (params.get("country") || "US").toUpperCase();
  const requestedService = params.get("service");

  const { data: services, error: serviceError } = await auth.service
    .from("smscode_service_catalogue")
    .select("id,service_key,display_name,sms_code_service_code,supported,active,last_verified_at,verification_note")
    .in("service_key", ALLOWED_SERVICE_KEYS)
    .order("display_name");
  if (serviceError) return NextResponse.json({ error: "Could not load the approved service catalogue." }, { status: 500 });

  const serviceIds = (services ?? []).map((service) => service.id);
  if (!serviceIds.length) return NextResponse.json({ services: [], tiers: [], countries: [], totalTiers: 0 });

  // Country metadata is fetched only for the seven approved services, not the global supplier catalogue.
  const countryRows: Array<{ country_iso2: string; country_name: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await auth.service
      .from("smscode_product_tiers")
      .select("country_iso2,country_name")
      .in("service_id", serviceIds)
      .order("country_iso2")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: "Could not load approved service countries." }, { status: 500 });
    countryRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const countryMap = new Map<string, { code: string; name: string }>();
  for (const row of countryRows) {
    if (row.country_iso2) countryMap.set(row.country_iso2, { code: row.country_iso2, name: row.country_name || row.country_iso2 });
  }

  let tierQuery = auth.service
    .from("smscode_product_tiers")
    .select("id,service_id,tier_key,tier_label,country_iso2,country_name,smscode_product_id,smscode_catalog_product_id,smscode_operator_id,max_supplier_price_usd,retail_price_kobo,active,last_supplier_price_usd,last_inventory_count,last_verified_at", { count: "exact" })
    .in("service_id", serviceIds)
    .eq("country_iso2", country);
  if (requestedService && serviceIds.includes(requestedService)) tierQuery = tierQuery.eq("service_id", requestedService);

  const tiers: unknown[] = [];
  const pageSize = 500;
  let expectedTotal = 0;
  for (let from = 0; ; from += pageSize) {
    const { data, error, count } = await tierQuery
      .order("service_id")
      .order("tier_key")
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: "Could not load the selected country's approved products." }, { status: 500 });
    if (from === 0) expectedTotal = count ?? 0;
    tiers.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  if (tiers.length !== expectedTotal) {
    return NextResponse.json({ error: "Product list pagination was incomplete. Refresh and try again.", expected: expectedTotal, received: tiers.length }, { status: 502 });
  }

  return NextResponse.json({
    services: services ?? [],
    tiers,
    countries: [...countryMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totalTiers: expectedTotal,
    scope: "approved-seven-services",
  }, { headers: { "Cache-Control": "no-store" } });
}
