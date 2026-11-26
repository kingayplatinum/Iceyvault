import { smscodeRequest } from "@/lib/smscode/client";
import { createServiceClient } from "@/lib/supabase/service";

type Db = ReturnType<typeof createServiceClient>;
type Country = { id: number; code: string; active: boolean };
type SupplierService = { id: number; code: string; name: string; active: boolean };
type Product = {
  id: number; name: string; catalog_product_id: number | null; operator_id: number | null;
  operator_name: string | null; available: number; active: boolean;
  price: { amount: string; currency: string; canonical_amount?: number; canonical_currency?: string };
};

export async function refreshSmscodeTier(db: Db, tierId: string) {
  const { data: tier, error: tierError } = await db.from("smscode_product_tiers")
    .select("id,service_id,country_iso2,smscode_product_id,tier_key")
    .eq("id", tierId).maybeSingle();
  if (tierError || !tier?.smscode_product_id) throw new Error("This tier has no supplier product ID. Sync its service catalogue first.");

  const { data: service, error: serviceError } = await db.from("smscode_service_catalogue")
    .select("sms_code_service_code").eq("id", tier.service_id).maybeSingle();
  if (serviceError || !service?.sms_code_service_code) throw new Error("The service is not mapped to an SMSCode platform.");

  const { data: countries } = await smscodeRequest<Country[]>("/catalog/countries");
  const country = countries.find((item) => item.active && item.code.toUpperCase() === tier.country_iso2.toUpperCase());
  if (!country) throw new Error("SMSCode does not currently list this country as active.");

  const { data: remoteServices } = await smscodeRequest<SupplierService[]>(`/catalog/services?country_id=${country.id}`);
  const remoteService = remoteServices.find((item) => item.active && item.code === service.sms_code_service_code);
  if (!remoteService) throw new Error("SMSCode does not currently offer this service in the selected country.");

  // SMSCode permits up to 10,000 products per page. The previous 20 x 1,000
  // ceiling missed valid product IDs later in large country/service catalogues.
  const pageSize = 10000;
  for (let page = 1; page <= 100; page++) {
    const params = new URLSearchParams({ country_id: String(country.id), platform_id: String(remoteService.id), limit: String(pageSize), page: String(page) });
    const response = await smscodeRequest<Product[]>(`/catalog/products?${params.toString()}`);
    const product = response.data.find((item) => String(item.id) === String(tier.smscode_product_id));
    if (product) {
      const now = new Date().toISOString();
      const supplierCost = Number(product.price?.amount);
      if (product.price?.currency !== "USD" || !Number.isFinite(supplierCost) || !Number.isFinite(product.available)) {
        throw new Error("SMSCode returned an invalid price or inventory quote for this product.");
      }
      const { error } = await db.from("smscode_product_tiers").update({
        tier_label: product.operator_name ? `${product.name} · ${product.operator_name}` : product.name,
        smscode_catalog_product_id: product.catalog_product_id == null ? null : String(product.catalog_product_id),
        smscode_operator_id: product.operator_id ?? null,
        last_supplier_price_usd: supplierCost,
        last_inventory_count: Math.max(0, product.available),
        last_verified_at: now,
        updated_at: now,
      }).eq("id", tierId);
      if (error) throw new Error("Supplier data was refreshed but could not be saved to the product tier.");
      return { available: Math.max(0, product.available), supplierCost, active: product.active };
    }
    if (response.data.length < pageSize) break;
  }
  throw new Error("SMSCode did not return this exact supplier product after checking the current catalogue pages. It may have been withdrawn or replaced; refresh this country/service and select a currently listed product. Existing pricing has been left unchanged.");
}
