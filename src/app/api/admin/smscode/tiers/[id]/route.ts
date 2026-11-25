import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  tier_label: z.string().trim().min(1).max(100).optional(),
  smscode_product_id: z.string().trim().max(160).nullable().optional(),
  smscode_catalog_product_id: z.string().trim().max(160).nullable().optional(),
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
    const { data: current } = await auth.service.from("smscode_product_tiers").select("service_id,smscode_product_id,smscode_catalog_product_id,retail_price_kobo,last_inventory_count,last_verified_at").eq("id", id).maybeSingle();
    if (!current) return NextResponse.json({ error: "Tier not found." }, { status: 404 });
    const { data: service } = await auth.service.from("smscode_service_catalogue").select("supported,active").eq("id", current.service_id).maybeSingle();
    const productId = parsed.data.smscode_product_id ?? current.smscode_product_id;const catalogProductId = parsed.data.smscode_catalog_product_id ?? current.smscode_catalog_product_id;const retailPrice = parsed.data.retail_price_kobo ?? current.retail_price_kobo;
    if (!service?.supported || !service.active || !productId) return NextResponse.json({ error: "Verify and enable the service and attach a confirmed SMSCode product before activating this tier." }, { status: 409 });
  }
  const { data, error } = await auth.service.from("smscode_product_tiers").update({ ...parsed.data, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update tier." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Tier not found." }, { status: 404 });
  await auth.service.from("audit_logs").insert({ actor_user_id: auth.user.id, action: "smscode_tier_updated", entity_type: "smscode_product_tier", entity_id: id, metadata: parsed.data });
  return NextResponse.json({ tier: data });
}
