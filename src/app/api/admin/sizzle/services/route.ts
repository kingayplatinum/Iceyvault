import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { sizzleRequest, SizzleError, SizzleService } from "@/lib/sizzle/client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,90);

export async function GET() {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;
  const { data, error } = await admin.service.from("sizzle_services")
    .select("id,external_service_id,name,category,service_type,product_kind,fulfilment_mode,rate_per_1000_ngn,retail_rate_per_1000_kobo,min_quantity,max_quantity,description,dripfeed_supported,refill_supported,active,last_synced_at")
    .order("category").order("name");
  if (error) return NextResponse.json({ error: "Could not load Sizzle catalogue. Apply the Sizzle database migration first." }, { status: 500 });
  return NextResponse.json({ services: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;
  try {
    const remote = await sizzleRequest<SizzleService[]>({ action: "services" });
    if (!Array.isArray(remote)) return NextResponse.json({ error: "Sizzle returned an unexpected service catalogue." }, { status: 502 });
    const now = new Date().toISOString();
    const { data: existing, error: readError } = await admin.service.from("sizzle_services")
      .select("external_service_id,product_kind,fulfilment_mode,retail_rate_per_1000_kobo,active")
      .in("external_service_id", remote.map(s => String(s.service)));
    if (readError) throw readError;
    const previous = new Map((existing ?? []).map(row => [row.external_service_id, row]));
    const rows = remote.map(s => {
      const old = previous.get(String(s.service));
      const kind = old?.product_kind || "social";
      return {
        external_service_id: String(s.service), name: s.name, category: s.category || "Other",
        service_type: s.type || "default", rate_per_1000_ngn: Number(s.rate),
        min_quantity: Math.max(1, Number(s.min) || 1), max_quantity: Math.max(1, Number(s.max) || 1),
        description: s.desc || null, dripfeed_supported: s.dripfeed === "1",
        refill_supported: typeof s.refill === "string" ? s.refill === "1" : old?.refill_supported ?? false, product_kind: kind,
        fulfilment_mode: old?.fulfilment_mode || "supplier_email",
        retail_rate_per_1000_kobo: old?.retail_rate_per_1000_kobo ?? 0,
        active: old?.active ?? false, last_synced_at: now, updated_at: now,
      };
    }).filter(row => Number.isFinite(row.rate_per_1000_ngn) && row.rate_per_1000_ngn >= 0);
    for (let i=0;i<rows.length;i+=250) {
      const { error } = await admin.service.from("sizzle_services").upsert(rows.slice(i,i+250), { onConflict: "external_service_id" });
      if (error) throw error;
    }
    await admin.service.from("audit_logs").insert({ actor_user_id: admin.user.id, action: "sizzle_catalogue_synced", entity_type: "sizzle_services", metadata: { seen: remote.length, saved: rows.length } });
    return NextResponse.json({ servicesSeen: remote.length, servicesSaved: rows.length, note: "New services remain inactive with zero retail pricing. Classify digital-account services and configure retail pricing before publishing." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync Sizzle catalogue.", supplierStatus: error instanceof SizzleError ? error.status : null }, { status: 502 });
  }
}
