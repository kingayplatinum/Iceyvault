import { NextRequest, NextResponse } from "next/server";
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

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let stage = "country_catalogue";
  let countryName = "";
  let serviceName = "";
  try {
    const body = await request.json().catch(() => ({})) as { mode?: string; countryId?: number };
    const { data: countries } = await smscodeRequest<Country[]>("/catalog/countries");
    const activeCountries = countries.filter((country) =>
      country.active && /^[A-Z]{2}$/i.test(country.code) && Number.isFinite(country.id)
    );

    // Lightweight discovery request. The browser then syncs one country per request,
    // avoiding a single enormous serverless invocation for the entire global catalogue.
    if (body.mode === "discover") {
      return NextResponse.json({
        countries: activeCountries.map(({ id, code, name, emoji }) => ({ id, code: code.toUpperCase(), name, emoji: emoji ?? null })),
        count: activeCountries.length,
      });
    }

    const country = activeCountries.find((item) => item.id === Number(body.countryId));
    if (!country) {
      return NextResponse.json({ error: "The selected country is not active in the live SMSCode catalogue.", stage }, { status: 409 });
    }
    countryName = country.name;

    stage = "country_services";
    const { data: remoteServices } = await smscodeRequest<RemoteService[]>(
      `/catalog/services?country_id=${country.id}`
    );
    const services = remoteServices.filter((service) => service.active && service.code && service.name);
    if (!services.length) {
      return NextResponse.json({
        country: country.name, servicesSynced: 0, productsSeen: 0,
        productsInserted: 0, productsRefreshed: 0, note: "No active services are currently listed for this country.",
      });
    }

    const now = new Date().toISOString();
    const serviceMap = new Map<string, {
      service_key: string; display_name: string; sms_code_service_code: string;
      supported: boolean; active: boolean; last_verified_at: string; verification_note: string; updated_at: string;
    }>();
    for (const service of services) {
      const serviceKey = keyFor(service.name);
      if (!serviceKey) continue;
      serviceMap.set(serviceKey, {
        service_key: serviceKey,
        display_name: service.name,
        sms_code_service_code: service.code,
        supported: true,
        active: false,
        last_verified_at: now,
        verification_note: `Confirmed active in the live SMSCode catalogue for ${country.name}.`,
        updated_at: now,
      });
    }
    const serviceRows = [...serviceMap.values()];

    stage = "save_services";
    const { data: existingServices, error: existingServicesError } = await auth.service
      .from("smscode_service_catalogue")
      .select("service_key,active")
      .in("service_key", serviceRows.map((row) => row.service_key));
    if (existingServicesError) throw existingServicesError;
    const activeByKey = new Map((existingServices ?? []).map((row) => [row.service_key, row.active]));
    const serviceRowsToSave = serviceRows.map((row) => ({
      ...row,
      // Catalogue refreshes must never silently disable a service an admin enabled.
      active: activeByKey.get(row.service_key) ?? false,
    }));
    const { error: serviceError } = await auth.service
      .from("smscode_service_catalogue")
      .upsert(serviceRowsToSave, { onConflict: "service_key", ignoreDuplicates: false });
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

    for (const remoteService of services) {
      serviceName = remoteService.name;
      const serviceKey = keyFor(remoteService.name);
      const stored = serviceByKey.get(serviceKey);
      if (!stored) continue;

      let page = 1;
      let serviceHasStock = false;
      while (true) {
        stage = `products:${country.code}:${remoteService.code}:page:${page}`;
        const params = new URLSearchParams({
          country_id: String(country.id),
          platform_id: String(remoteService.id),
          limit: "1000",
          page: String(page),
        });
        const response = await smscodeRequest<RemoteProduct[]>(`/catalog/products?${params.toString()}`);
        const meta = (response.meta ?? {}) as ProductPageMeta;

        const products = response.data.filter((product) =>
          product.active && Number.isFinite(product.id) &&
          Number.isFinite(product.available) &&
          product.price?.currency === "USD" &&
          Number.isFinite(Number(product.price.amount)) &&
          product.price.canonical_currency === "IDR" &&
          Number.isFinite(product.price.canonical_amount)
        );
        productsSeen += products.length;
        if (products.some((product) => product.available > 0)) serviceHasStock = true;

        const verifiedAt = new Date().toISOString();
        const rows = products.map((product) => ({
          service_id: stored.id,
          tier_key: String(product.id),
          tier_label: product.operator_name ? `${product.name} · ${product.operator_name}` : product.name,
          country_iso2: country.code.toUpperCase(),
          country_name: country.name,
          smscode_product_id: String(product.id),
          smscode_catalog_product_id: product.catalog_product_id == null ? null : String(product.catalog_product_id),
          smscode_operator_id: product.operator_id ?? null,
          max_supplier_price_usd: Number(product.price.amount),
          retail_price_kobo: 0,
          active: false,
          last_supplier_price_usd: Number(product.price.amount),
          last_supplier_price_idr: product.price.canonical_amount,
          last_supplier_fx_rate: Number(meta.fx?.rate) || null,
          last_inventory_count: Math.max(0, product.available),
          last_verified_at: verifiedAt,
          updated_at: verifiedAt,
        }));

        if (rows.length) {
          stage = `save_products:${country.code}:${remoteService.code}:page:${page}`;
          const { data: existing, error: existingError } = await auth.service
            .from("smscode_product_tiers")
            .select("id,tier_key")
            .eq("service_id", stored.id)
            .eq("country_iso2", country.code.toUpperCase());
          if (existingError) throw existingError;
          const existingByKey = new Map((existing ?? []).map((tier) => [tier.tier_key, tier.id]));
          const newRows = rows.filter((row) => !existingByKey.has(row.tier_key));
          if (newRows.length) {
            const { error } = await auth.service.from("smscode_product_tiers").upsert(newRows, {
              onConflict: "service_id,tier_key,country_iso2",
              ignoreDuplicates: true,
            });
            if (error) throw error;
            productsInserted += newRows.length;
          }
          const refreshRows = rows.filter((row) => existingByKey.has(row.tier_key));
          for (let index = 0; index < refreshRows.length; index += 20) {
            const batch = refreshRows.slice(index, index + 20);
            const results = await Promise.all(batch.map((row) =>
              auth.service.from("smscode_product_tiers").update({
                tier_label: row.tier_label,
                country_name: row.country_name,
                smscode_product_id: row.smscode_product_id,
                smscode_catalog_product_id: row.smscode_catalog_product_id,
                smscode_operator_id: row.smscode_operator_id,
                last_supplier_price_usd: row.last_supplier_price_usd,
                last_supplier_price_idr: row.last_supplier_price_idr,
                last_supplier_fx_rate: row.last_supplier_fx_rate,
                last_inventory_count: row.last_inventory_count,
                last_verified_at: row.last_verified_at,
                updated_at: verifiedAt,
              }).eq("id", existingByKey.get(row.tier_key))
            ));
            const failed = results.find((result) => result.error);
            if (failed?.error) throw failed.error;
            productsRefreshed += batch.length;
          }
        }

        // SMSCode meta.count is the number of rows in this page, not a global total.
        // Continue only while the page is full; the API supports page-based pagination.
        if (response.data.length < 1000) break;
        page += 1;
      }
      if (serviceHasStock) servicesWithStock++;
    }

    stage = "audit_log";
    const { error: auditError } = await auth.service.from("audit_logs").insert({
      actor_user_id: auth.user.id,
      action: "smscode_country_catalogue_synced",
      entity_type: "smscode_product_tiers",
      metadata: {
        country: country.code.toUpperCase(),
        services: services.length,
        products_seen: productsSeen,
        products_inserted: productsInserted,
        products_refreshed: productsRefreshed,
      },
    });
    if (auditError) throw auditError;

    return NextResponse.json({
      country: country.name,
      countryCode: country.code.toUpperCase(),
      servicesSynced: services.length,
      productsSeen,
      productsInserted,
      productsRefreshed,
      servicesWithStock,
      note: "Imported products remain inactive with zero NGN retail price. Existing retail prices, supplier caps and activation states are preserved when refreshing the catalogue.",
    });
  } catch (error) {
    const supplierError = error as Error & { status?: number; code?: string; requestId?: string };
    const isSupplierError = error instanceof SmscodeError;
    return NextResponse.json({
      error: supplierError.message || "Could not synchronise the SMSCode catalogue.",
      stage,
      country: countryName || null,
      service: serviceName || null,
      supplierStatus: isSupplierError ? supplierError.status : null,
      supplierCode: isSupplierError ? supplierError.code ?? null : null,
      supplierRequestId: isSupplierError ? supplierError.requestId ?? null : null,
      hint: stage === "country_catalogue" || stage === "country_services"
        ? "Check the SMSCode live country/service catalogue and supplier API token."
        : stage.startsWith("products:")
          ? "The supplier product endpoint failed for the indicated country/service. Use the request ID when contacting SMSCode."
          : "The supplier response was received, but saving catalogue data failed. Check service_role grants, RLS and database constraints.",
    }, { status: 502 });
  }
}
