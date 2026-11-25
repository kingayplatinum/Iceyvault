import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { smscodeRequest } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Country = { id: number; code: string; name: string; active: boolean };
type RemoteService = { id: number; code: string; name: string; active: boolean };
type Money = { amount: string; currency: "USD"; canonical_amount: number; canonical_currency: "IDR" };
type RemoteProduct = {
  id: number; name: string; country_id: number; platform_id: number;
  catalog_product_id: number | null; operator_id: number | null;
  operator_name: string | null; available: number; price: Money; active: boolean;
};
const keyFor = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);

export async function POST() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  try {
    const { data: countries } = await smscodeRequest<Country[]>("/catalog/countries");
    const nigeria = countries.find((country) => country.code.toUpperCase() === "NG" && country.active);
    if (!nigeria) return NextResponse.json({ error: "SMSCode does not currently list Nigeria as an active country. No products were changed." }, { status: 409 });
    const { data: countryServices } = await smscodeRequest<RemoteService[]>(`/catalog/services?country_id=${nigeria.id}`);
    const services = countryServices.filter((service) => service.active);
    const serviceRows = services.map((service) => ({
      service_key: keyFor(service.name),
      display_name: service.name,
      sms_code_service_code: service.code,
      supported: true,
      last_verified_at: new Date().toISOString(),
      verification_note: "Confirmed active in the live SMSCode catalogue. Country-specific products are synced separately.",
    })).filter((row) => row.service_key.length > 0);

    const { error: serviceError } = await auth.service
      .from("smscode_service_catalogue")
      .upsert(serviceRows, { onConflict: "service_key", ignoreDuplicates: false });
    if (serviceError) throw serviceError;

    const { data: storedServices, error: readError } = await auth.service
      .from("smscode_service_catalogue")
      .select("id,service_key,sms_code_service_code")
      .in("service_key", serviceRows.map((row) => row.service_key));
    if (readError) throw readError;
    const serviceByCode = new Map((storedServices ?? []).map((row) => [row.sms_code_service_code, row]));

    let productsSeen = 0;
    let productsInserted = 0;
    let productsRefreshed = 0;
    const failures: string[] = [];

    for (const remoteService of services) {
      const stored = serviceByCode.get(remoteService.code);
      if (!stored) continue;
      const params = new URLSearchParams({
        country_id: String(nigeria.id),
        platform_id: String(remoteService.id),
        limit: "1000",
        page: "1",
      });
      const remoteProducts = await smscodeRequest<RemoteProduct[]>(`/catalog/products?${params.toString()}`);
      const validProducts = remoteProducts.data.filter((product) =>
        product.active && Number.isFinite(product.id) && Number.isFinite(product.available) &&
        product.price?.currency === "USD" && Number.isFinite(Number(product.price.amount)) &&
        Number.isFinite(product.price.canonical_amount)
      );
      productsSeen += validProducts.length;
      const now = new Date().toISOString();
      const tierRows = validProducts.map((product) => ({
        service_id: stored.id,
        tier_key: String(product.id),
        tier_label: product.name,
        country_iso2: "NG",
        smscode_product_id: String(product.id),
        smscode_catalog_product_id: product.catalog_product_id == null ? null : String(product.catalog_product_id),
        max_supplier_price_usd: Number(product.price.amount),
        retail_price_kobo: 0,
        active: false,
        last_supplier_price_usd: Number(product.price.amount),
        last_supplier_price_idr: product.price.canonical_amount,
        last_supplier_fx_rate: Number(remoteProducts.meta && (remoteProducts.meta as { fx?: { rate?: number } }).fx?.rate) || null,
        last_inventory_count: Math.max(0, product.available),
        last_verified_at: now,
      }));
      if (!tierRows.length) continue;

      const { data: existing, error: existingError } = await auth.service
        .from("smscode_product_tiers")
        .select("id,tier_key")
        .eq("service_id", stored.id)
        .eq("country_iso2", "NG");
      if (existingError) throw existingError;
      const existingKeys = new Set((existing ?? []).map((tier) => tier.tier_key));
      const newRows = tierRows.filter((tier) => !existingKeys.has(tier.tier_key));
      if (newRows.length) {
        const { error } = await auth.service.from("smscode_product_tiers").upsert(newRows, {
          onConflict: "service_id,tier_key,country_iso2",
          ignoreDuplicates: true,
        });
        if (error) throw error;
        productsInserted += newRows.length;
      }

      const existingByKey = new Map((existing ?? []).map((tier) => [tier.tier_key, tier.id]));
      const refreshRows = tierRows.filter((tier) => existingByKey.has(tier.tier_key));
      for (let index = 0; index < refreshRows.length; index += 20) {
        const batch = refreshRows.slice(index, index + 20);
        const results = await Promise.all(batch.map((tier) =>
          auth.service.from("smscode_product_tiers").update({
            tier_label: tier.tier_label,
            smscode_product_id: tier.smscode_product_id,
            smscode_catalog_product_id: tier.smscode_catalog_product_id,
            last_supplier_price_usd: tier.last_supplier_price_usd,
            last_supplier_price_idr: tier.last_supplier_price_idr,
            last_supplier_fx_rate: tier.last_supplier_fx_rate,
            last_inventory_count: tier.last_inventory_count,
            last_verified_at: tier.last_verified_at,
            updated_at: now,
          }).eq("id", existingByKey.get(tier.tier_key))
        ));
        const failed = results.find((result) => result.error);
        if (failed?.error) throw failed.error;
        productsRefreshed += batch.length;
      }
    }

    await auth.service.from("audit_logs").insert({
      actor_user_id: auth.user.id,
      action: "smscode_nigeria_catalogue_synced",
      entity_type: "smscode_product_tiers",
      metadata: { services: serviceRows.length, products_seen: productsSeen, products_inserted: productsInserted, products_refreshed: productsRefreshed },
    });

    return NextResponse.json({
      country: nigeria.name,
      servicesSynced: serviceRows.length,
      productsSeen,
      productsInserted,
      productsRefreshed,
      note: "Imported products remain inactive with zero retail price. Review supplier caps and NGN retail prices, then verify and activate tiers manually.",
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not synchronise the SMSCode catalogue.",
    }, { status: 502 });
  }
}
