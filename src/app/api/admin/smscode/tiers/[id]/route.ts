import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin";
import { refreshSmscodeTier } from "@/lib/smscode/refresh-tier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  tier_label: z.string().trim().min(1).max(100).optional(),
  smscode_product_id: z.string().trim().max(160).nullable().optional(),
  smscode_catalog_product_id: z.string().trim().max(160).nullable().optional(),
  smscode_operator_id: z.number().int().positive().nullable().optional(),
  max_supplier_price_usd: z.number().finite().nonnegative().max(100000).optional(),
  retail_price_kobo: z.number().int().nonnegative().max(100000000000).optional(),
  active: z.boolean().optional(),
}).strict();

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) return NextResponse.json({ error: "Invalid tier update." }, { status: 400 });
  if (parsed.data.active === true) {
    try {
      const refreshed = await refreshSmscodeTier(auth.service, id);
      if (!refreshed.active || refreshed.available <= 0) return NextResponse.json({ error: "SMSCode currently reports this product as unavailable or out of stock. The tier was not activated." }, { status: 409 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh live supplier stock before activation." }, { status: 502 });
    }
    const { data: current } = await auth.service.from("smscode_product_tiers").select("service_id,smscode_product_id,smscode_catalog_product_id,retail_price_kobo,max_supplier_price_usd,last_supplier_price_usd,last_inventory_count,last_verified_at").eq("id", id).maybeSingle();
    if (!current) return NextResponse.json({ error: "Tier not found." }, { status: 404 });
    const { data: service } = await auth.service.from("smscode_service_catalogue").select("id,supported,active").eq("id", current.service_id).maybeSingle();
    const productId = parsed.data.smscode_product_id ?? current.smscode_product_id;const catalogProductId = parsed.data.smscode_catalog_product_id ?? current.smscode_catalog_product_id;const retailPrice = parsed.data.retail_price_kobo ?? current.retail_price_kobo;const supplierCap = parsed.data.max_supplier_price_usd ?? current.max_supplier_price_usd;
    if (!service?.supported || !productId || !catalogProductId || retailPrice <= 0 || supplierCap < (current.last_supplier_price_usd ?? 0) || (current.last_inventory_count ?? 0) <= 0 || !current.last_verified_at || new Date(current.last_verified_at).getTime() < Date.now() - 24 * 60 * 60 * 1000) return NextResponse.json({ error: "A tier needs a verified supplier catalogue product, recently refreshed stock, a supplier cap that covers the live cost and a positive NGN retail price before activation." }, { status: 409 });
  }
  const { data, error } = await auth.service.from("smscode_product_tiers").update({ ...parsed.data, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update tier." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Tier not found." }, { status: 404 });
  if (parsed.data.active === true) {
    const { data: tierService } = await auth.service.from("smscode_product_tiers").select("service_id").eq("id", id).maybeSingle();
    if (tierService?.service_id) {
      const { data: service } = await auth.service.from("smscode_service_catalogue").select("id,active,supported").eq("id", tierService.service_id).maybeSingle();
      if (service?.supported && !service.active) {
        const { error: enableError } = await auth.service.from("smscode_service_catalogue").update({ active: true, updated_at: new Date().toISOString() }).eq("id", service.id);
        if (enableError) return NextResponse.json({ error: "Tier was saved, but its parent service could not be enabled. Retry activation." }, { status: 500 });
      }
    }
  }
  await auth.service.from("audit_logs").insert({ actor_user_id: auth.user.id, action: "smscode_tier_updated", entity_type: "smscode_product_tier", entity_id: id, metadata: parsed.data });
  return NextResponse.json({ tier: data });
}
