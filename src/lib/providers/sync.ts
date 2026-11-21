import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { ProviderAdapter } from "./types";

export async function syncProviderCatalogue(adapter: ProviderAdapter) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Server-side Supabase service credentials are not configured.");
  const db = createSupabaseClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: provider, error: providerError } = await db.from("providers").upsert({
    code: adapter.code,
    display_name: adapter.displayName,
    status: "testing",
    supports_sms: adapter.capabilities.includes("sms"),
    supports_voice: adapter.capabilities.includes("voice"),
    supports_rentals: adapter.capabilities.includes("rentals"),
    supports_webhooks: adapter.capabilities.includes("webhooks"),
  }, { onConflict: "code" }).select("id").single();
  if (providerError || !provider) throw new Error(providerError?.message ?? "Unable to register provider.");

  const { data: run, error: runError } = await db.from("provider_sync_runs").insert({
    provider_id: provider.id, sync_type: "catalogue", status: "running",
  }).select("id").single();
  if (runError || !run) throw new Error(runError?.message ?? "Unable to start supplier sync.");

  try {
    const products = await adapter.listProducts();
    let created = 0;
    let updated = 0;
    for (const product of products) {
      const { data: existing } = await db.from("provider_products").select("id")
        .eq("provider_id", provider.id)
        .eq("external_product_id", product.externalProductId)
        .eq("country_iso2", product.countryIso2)
        .eq("service_code", product.serviceCode)
        .eq("offer_kind", product.offerKind).maybeSingle();
      const { error } = await db.from("provider_products").upsert({
        provider_id: provider.id,
        external_product_id: product.externalProductId,
        country_iso2: product.countryIso2,
        country_name: product.countryName,
        service_code: product.serviceCode,
        service_name: product.serviceName,
        channel: product.channel,
        offer_kind: product.offerKind,
        number_class: product.numberClass ?? null,
        term_minutes: product.termMinutes ?? null,
        currency: product.currency,
        wholesale_amount_minor: product.wholesaleAmountMinor,
        retail_amount_kobo: null,
        inventory_count: product.inventoryCount,
        verified_at: new Date().toISOString(),
        active: false,
        metadata: { ...product.metadata, environment: "mock", requires_review: true },
      }, { onConflict: "provider_id,external_product_id,country_iso2,service_code,offer_kind" });
      if (error) throw new Error(error.message);
      if (existing) updated += 1; else created += 1;
    }
    const { error: finishError } = await db.from("provider_sync_runs").update({
      status: "succeeded", completed_at: new Date().toISOString(),
      products_seen: products.length, products_created: created, products_updated: updated,
      metadata: { adapter: adapter.code, environment: "mock", catalogue_is_inactive: true },
    }).eq("id", run.id);
    if (finishError) throw new Error(finishError.message);
    return { providerId: provider.id, runId: run.id, productsSeen: products.length, productsCreated: created, productsUpdated: updated };
  } catch (error) {
    await db.from("provider_sync_runs").update({
      status: "failed", completed_at: new Date().toISOString(),
      error_summary: error instanceof Error ? error.message.slice(0, 500) : "Unknown supplier sync error",
    }).eq("id", run.id);
    throw error;
  }
}
