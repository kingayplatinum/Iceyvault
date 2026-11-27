import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin";
const schema = z.object({
  product_kind: z.enum(["social","digital_account"]).optional(),
  fulfilment_mode: z.enum(["supplier_email","manual_review"]).optional(),
  retail_rate_per_1000_kobo: z.number().int().nonnegative().max(100000000000).optional(),
  active: z.boolean().optional(),
}).strict();
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !Object.keys(parsed.data ?? {}).length) return NextResponse.json({ error: "Invalid service update." }, { status: 400 });
  const { data: current, error: readError } = await admin.service.from("sizzle_services").select("id,retail_rate_per_1000_kobo,last_synced_at").eq("id", id).maybeSingle();
  if (readError || !current) return NextResponse.json({ error: "Service not found. Apply the Sizzle migration first." }, { status: 404 });
  const nextRate = parsed.data.retail_rate_per_1000_kobo ?? current.retail_rate_per_1000_kobo;
  if (parsed.data.active === true && (!nextRate || !current.last_synced_at || new Date(current.last_synced_at).getTime() < Date.now()-24*60*60*1000)) return NextResponse.json({ error: "Set a positive NGN retail rate and sync the supplier catalogue within the last 24 hours before activation." }, { status: 409 });
  const { data, error } = await admin.service.from("sizzle_services").update({ ...parsed.data, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Could not update Sizzle service." }, { status: 500 });
  await admin.service.from("audit_logs").insert({ actor_user_id: admin.user.id, action: "sizzle_service_updated", entity_type: "sizzle_service", entity_id: id, metadata: parsed.data });
  return NextResponse.json({ service: data });
}
