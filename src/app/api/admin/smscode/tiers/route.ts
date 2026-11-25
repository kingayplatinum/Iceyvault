import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tierSchema = z.object({
  service_id: z.string().uuid(),
  tier_key: z.string().trim().min(1).max(64),
  tier_label: z.string().trim().min(1).max(100),
  country_iso2: z.string().trim().length(2).default("NG"),
  smscode_product_id: z.string().trim().max(160).nullable().optional(),
  smscode_catalog_product_id: z.string().trim().max(160).nullable().optional(),
  smscode_operator_id: z.number().int().positive().nullable().optional(),
  max_supplier_price_usd: z.number().finite().nonnegative().max(100000),
  retail_price_kobo: z.number().int().nonnegative().max(100000000000),
  active: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const parsed = tierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid tier configuration.", details: parsed.error.flatten() }, { status: 400 });
  const { data: service, error: serviceError } = await auth.service
    .from("smscode_service_catalogue").select("id,supported,active").eq("id", parsed.data.service_id).maybeSingle();
  if (serviceError || !service) return NextResponse.json({ error: "Service not found." }, { status: 404 });
  if (parsed.data.active && (!service.supported || !service.active || !parsed.data.smscode_product_id)) {
    return NextResponse.json({ error: "A tier can only be activated after its SMSCode product has been verified and the service enabled." }, { status: 409 });
  }
  const { data, error } = await auth.service.from("smscode_product_tiers").insert(parsed.data).select().single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "That tier already exists for this country." : "Could not save tier." }, { status: error.code === "23505" ? 409 : 500 });
  await auth.service.from("audit_logs").insert({ actor_user_id: auth.user.id, action: "smscode_tier_created", entity_type: "smscode_product_tier", entity_id: data.id, metadata: { service_id: data.service_id, tier_key: data.tier_key, active: data.active } });
  return NextResponse.json({ tier: data }, { status: 201 });
}
