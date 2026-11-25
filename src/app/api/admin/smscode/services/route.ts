import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { smscodeRequest, SmscodeError } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Country = { id: number; code: string; name: string; active: boolean; dial_code?: string; emoji?: string };
type RemoteService = { id: number; code: string; name: string; active: boolean };
type Money = { amount: string; currency: "USD"; canonical_amount: number; canonical_currency: "IDR" };
type RemoteProduct = {
  id: number; name: string; country_id: number; platform_id: number;
  catalog_product_id: number | null; operator_id: number | null;
  operator_name: string | null; available: number; price: Money; active: boolean;
};
type ProductPageMeta = { page?: number; limit?: number; count?: number; fx?: { rate?: number } };

const keyFor = (name: string) => name.toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);

export async function POST() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let stage = "country_catalogue";
  let currentCountry = "";
  let currentService = "";
  try {
    const { data: allCountries } = await smscodeRequest<Country[]>("/catalog/countries");
    const countries = allCountries.filter((country) =>
      country.active && /^[A-Z]{2}$/i.test(country.code) && Number.isFinite(country.id)
    );
    if (!countries.length) {
      return NextResponse.json({
        error: "SMSCode returned no active countries. No catalogue records were changed.",
        stage,
      }, { status: 409 });
    }

    stage = "discover_services";
    const countryServices: Array<{ country: Country; service: RemoteService; serviceKey: string }> = [];
    const uniqueServices = new Map<string, {
      service_key: string; display_name: string; sms_code_service_code: string;
      supported: boolean; last_verified_at: string; verification_note: string; updated_at: string;
    }>();

    for (const country of countries) {
      currentCountry = country.name;
      const { data } = await smscodeRequest<RemoteService[]>(
        `/catalog/services?country_id=${country.id}`
      );
      for (const service of data.filter((item) => item.active && item.code && item.name)) {
        const serviceKey = keyFor(service.name);
        if (!serviceKey) continue;
        countryServices.push({ country, service, serviceKey });
        uniqueServices.set(serviceKey, {
          service_key: serviceKey,
          display_name: service.name,
          sms_code_service_code: service.code,
          supported: true,
          last_verified_at: new Date().toISOString(),
          verification_note: "Confirmed active in the live SMSCode catalogue.",
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (!countryServices.length) {
      return NextResponse.json({
        error: "SMSCode returned no active services for its active countries. No products were changed.",
        stage,
      }, { status: 409 });
    }

    stage = "save_services";
    const serviceRows = [...uniqueServices.values()];
    const { error: serviceError } = await auth.service
      .from("smscode_service_catalogue")
      .upsert(serviceRows, { onConflict: "service_key", ignoreDuplicates: false });
    if (serviceError) throw serviceError;

    const { data: storedServices, error: readError } = await auth.service
      .from("smscode_service_catalogue")
      .select("id,service_key")
      .in("service_key", serviceRows.map((row) => row.service_key));
    if (readError) throw readError;
    const serviceByKey = new Map((storedServices ?? []).map((row) => [row.service_key, row]));

    let productsSeen = 0;
    let productsInserted = 0;
    let productsRefreshed = 0;
    let servicesWithStock = 0;
    let countryServicePairsSynced = 0;

    for (const entry of countryServices) {
      const { country, service, serviceKey } = entry;
      currentCountry = country.name;
      currentService = service.name;
      const stored = serviceByKey.get(serviceKey);
      if (!stored) continue;

      let page = 1;
      let expectedCount = Number.POSITIVE_INFINITY;
      let serviceHasStock = false;

      while ((page - 1) * 1000 < expectedCount) {
        stage = `products:${country.code}:${service.code}:page:${page}`;
        const params = new URLSearchParams({
          country_id: String(country.id),
          platform_id: String(service.id),
          limit: "1000",
          page: String(page),
        });
        const remoteProducts = await smscodeRequest<RemoteProduct[]>(
          `/catalog/products?${params.toString()}`
        );
        const meta = (remoteProducts.meta ?? {}) as ProductPageMeta;
        expectedCount = Number.isFinite(meta.count)
          ? Number(meta.count)
          : (page - 1) * 1000 + remoteProducts.data.length;

        const validProducts = remoteProducts.data.filter((product) =>
          product.active && Number.isFinite(product.id) &&
          Number.isFinite(product.available) &&
          product.price?.currency === "USD" &&
          Number.isFinite(Number(product.price.amount)) &&
          product.price.canonical_currency === "IDR" &&
          Number.isFinite(product.price.canonical_amount)
        );

        productsSeen += validProducts.length;
        if (validProducts.some((product) => product.available > 0)) serviceHasStock = true;

        const now = new Date().toISOString();
        const tierRows = validProducts.map((product) => ({
          service_id: stored.id,
          tier_key: String(product.id),
          tier_label: product.operator_name
            ? `${product.name} · ${product.operator_name}`
            : product.name,
          country_iso2: country.code.toUpperCase(),
          country_name: country.name,
          smscode_product_id: String(product.id),
          smscode_catalog_product_id: product.catalog_product_id == null
            ? null : String(product.catalog_product_id),
          smscode_operator_id: product.operator_id ?? null,
          max_supplier_price_usd: Number(product.price.amount),
          retail_price_kobo: 0,
          active: false,
          last_supplier_price_usd: Number(product.price.amount),
          last_supplier_price_idr: product.price.canonical_amount,
          last_supplier_fx_rate: Number(meta.fx?.rate) || null,
          last_inventory_count: Math.max(0, product.available),
          last_verified_at: now,
          updated_at: now,
        }));

        if (tierRows.length) {
          stage = `save_products:${country.code}:${service.code}:page:${page}`;
          const { data: existing, error: existingError } = await auth.service
            .from("smscode_product_tiers")
            .select("id,tier_key")
            .eq("service_id", stored.id)
            .eq("country_iso2", country.code.toUpperCase());
          if (existingError) throw existingError;
          const existingByKey = new Map((existing ?? []).map((tier) => [tier.tier_key, tier.id]));
          const newRows = tierRows.filter((tier) => !existingByKey.has(tier.tier_key));
          if (newRows.length) {
            const { error } = await auth.service.from("smscode_product_tiers").upsert(newRows, {
              onConflict: "service_id,tier_key,country_iso2",
              ignoreDuplicates: true,
            });
            if (error) throw error;
            productsInserted += newRows.length;
          }

          const refreshRows = tierRows.filter((tier) => existingByKey.has(tier.tier_key));
          for (let index = 0; index < refreshRows.length; index += 20) {
            const batch = refreshRows.slice(index, index + 20);
            const results = await Promise.all(batch.map((tier) =>
              auth.service.from("smscode_product_tiers").update({
                tier_label: tier.tier_label,
                country_name: tier.country_name,
                smscode_product_id: tier.smscode_product_id,
                smscode_catalog_product_id: tier.smscode_catalog_product_id,
                smscode_operator_id: tier.smscode_operator_id,
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

        if (remoteProducts.data.length < 1000) break;
        page += 1;
      }

      if (serviceHasStock) servicesWithStock++;
      countryServicePairsSynced++;
    }

    stage = "audit_log";
    const { error: auditError } = await auth.service.from("audit_logs").insert({
      actor_user_id: auth.user.id,
      action: "smscode_full_catalogue_synced",
      entity_type: "smscode_product_tiers",
      metadata: {
        countries: countries.length,
        country_service_pairs: countryServicePairsSynced,
        unique_services: serviceRows.length,
        products_seen: productsSeen,
        products_inserted: productsInserted,
        products_refreshed: productsRefreshed,
      },
    });
    if (auditError) throw auditError;

    return NextResponse.json({
      countriesSynced: countries.length,
      servicesSynced: serviceRows.length,
      countryServicePairsSynced,
      productsSeen,
      productsInserted,
      productsRefreshed,
      servicesWithStock,
      note: "All imported supplier products remain inactive and have zero NGN retail price until reviewed and configured. Existing retail prices, supplier caps and activation states were preserved during refresh.",
    });
  } catch (error) {
    const supplierError = error as Error & { status?: number; code?: string; requestId?: string };
    const isSupplierError = error instanceof SmscodeError;
    return NextResponse.json({
      error: supplierError.message || "Could not synchronise the SMSCode catalogue.",
      stage,
      country: currentCountry || null,
      service: currentService || null,
      supplierStatus: isSupplierError ? supplierError.status : null,
      supplierCode: isSupplierError ? supplierError.code ?? null : null,
      supplierRequestId: isSupplierError ? supplierError.requestId ?? null : null,
      hint: stage === "country_catalogue" || stage === "discover_services"
        ? "Check the live SMSCode country and service catalogue and the supplier API token."
        : stage.startsWith("products:")
          ? "The supplier product endpoint failed for the indicated country/service. Use the request ID when contacting SMSCode."
          : "The supplier response was received, but saving catalogue data failed. Check service_role table grants, RLS and database constraints.",
    }, { status: 502 });
  }
}
