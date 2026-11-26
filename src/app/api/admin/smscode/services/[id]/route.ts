import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin";
import { refreshSmscodeTier } from "@/lib/smscode/refresh-tier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const parsed = z.object({ active: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid service status." }, { status: 400 });

  const { data: service } = await auth.service.from("smscode_service_catalogue")
    .select("id,supported,display_name").eq("id", id).maybeSingle();
  if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });

  if (parsed.data.active) {
    if (!service.supported) return NextResponse.json({ error: "This service has not been confirmed in the SMSCode catalogue." }, { status: 409 });

    // Refresh a small set of individually priced tiers from SMSCode now, rather than
    // requiring an admin to run a full catalogue import just to enable a service.
    const { data: candidates, error: candidatesError } = await auth.service.from("smscode_product_tiers")
      .select("id")
      .eq("service_id", id)
      .not("smscode_product_id", "is", null)
      .not("smscode_catalog_product_id", "is", null)
      .gt("retail_price_kobo", 0)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (candidatesError) return NextResponse.json({ error: "Could not inspect configured product tiers." }, { status: 500 });

    let refreshedAvailable = false;
    const refreshErrors: string[] = [];
    for (const candidate of candidates ?? []) {
      try {
        const result = await refreshSmscodeTier(auth.service, candidate.id);
        if (result.active && result.available > 0) {
          const { data: tier } = await auth.service.from("smscode_product_tiers")
            .select("max_supplier_price_usd,last_supplier_price_usd,retail_price_kobo")
            .eq("id", candidate.id).maybeSingle();
          if (tier && tier.retail_price_kobo > 0 && Number(tier.max_supplier_price_usd) >= result.supplierCost) {
            refreshedAvailable = true;
            break;
          }
        }
      } catch (error) {
        refreshErrors.push(error instanceof Error ? error.message : "Supplier refresh failed.");
      }
    }

    if (!refreshedAvailable) {
      const detail = refreshErrors[0] || "No configured tier currently has available stock within its supplier price cap.";
      return NextResponse.json({
        error: "Could not enable " + service.display_name + ". Configure an individual retail price and supplier cap for at least one tier with live stock. " + detail,
      }, { status: 409 });
    }
  }

  const { data, error } = await auth.service.from("smscode_service_catalogue")
    .update({ active: parsed.data.active, updated_at: new Date().toISOString() })
    .eq("id", id).select("id,active").single();
  if (error) return NextResponse.json({ error: "Could not update service." }, { status: 500 });

  await auth.service.from("audit_logs").insert({
    actor_user_id: auth.user.id,
    action: "smscode_service_status_changed",
    entity_type: "smscode_service_catalogue",
    entity_id: id,
    metadata: { active: parsed.data.active },
  });
  return NextResponse.json({ service: data });
}
