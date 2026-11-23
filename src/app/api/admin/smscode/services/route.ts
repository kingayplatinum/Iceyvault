import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { smscodeRequest } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RemoteService = { id?: number | string; code?: string; name?: string; slug?: string; [key: string]: unknown };

export async function POST() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  try {
    const remote = await smscodeRequest<RemoteService[]>("/catalog/services");
    const rows = remote.data.map((item) => ({
      service_key: String(item.slug ?? item.code ?? item.name ?? item.id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      display_name: String(item.name ?? item.code ?? "Unknown service"),
      sms_code_service_code: String(item.code ?? item.id ?? ""),
      supported: true,
      last_verified_at: new Date().toISOString(),
      verification_note: "Found in live SMSCode service catalogue; product availability still needs tier verification.",
    })).filter((row) => row.service_key.length > 0);
    const { data: existing, error: readError } = await auth.service.from("smscode_service_catalogue").select("id,service_key");
    if (readError) throw readError;
    const known = new Set((existing ?? []).map((row) => row.service_key));
    const matched = rows.filter((row) => known.has(row.service_key));
    for (const row of matched) {
      const { error } = await auth.service.from("smscode_service_catalogue").update({
        display_name: row.display_name, sms_code_service_code: row.sms_code_service_code,
        supported: true, last_verified_at: row.last_verified_at, verification_note: row.verification_note,
        updated_at: row.last_verified_at,
      }).eq("service_key", row.service_key);
      if (error) throw error;
    }
    await auth.service.from("audit_logs").insert({
      actor_user_id: auth.user.id, action: "smscode_service_catalogue_synced",
      entity_type: "smscode_service_catalogue", metadata: { remote_count: rows.length, matched_count: matched.length },
    });
    return NextResponse.json({ remoteCount: rows.length, matchedCount: matched.length, matchedServices: matched.map((row) => row.display_name), note: "Services are not automatically activated. Verify country-specific products and configure tier caps and retail prices first." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not synchronise SMSCode catalogue." }, { status: 502 });
  }
}
