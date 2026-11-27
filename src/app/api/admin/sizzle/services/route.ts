import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { syncSizzleCatalogue } from "@/lib/sizzle/sync";
import { SizzleError } from "@/lib/sizzle/client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;
  try { await syncSizzleCatalogue(); } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh the live Sizzle catalogue." }, { status: 502 });
  }
  const { data, error } = await admin.service.from("sizzle_services")
    .select("id,external_service_id,name,category,service_type,product_kind,fulfilment_mode,rate_per_1000_ngn,retail_rate_per_1000_kobo,min_quantity,max_quantity,description,dripfeed_supported,refill_supported,active,last_synced_at")
    .order("category").order("name");
  if (error) return NextResponse.json({ error: "Could not load Sizzle catalogue. Apply the Sizzle database migration first." }, { status: 500 });
  return NextResponse.json({ services: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;
  try {
    const result = await syncSizzleCatalogue();
    await admin.service.from("audit_logs").insert({
      actor_user_id: admin.user.id,
      action: "sizzle_catalogue_auto_refreshed",
      entity_type: "sizzle_services",
      metadata: result,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not refresh Sizzle catalogue.",
      supplierStatus: error instanceof SizzleError ? error.status : null,
    }, { status: 502 });
  }
}
