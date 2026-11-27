import { createServiceClient } from "@/lib/supabase/service";
import { sizzleRequest, SizzleService } from "@/lib/sizzle/client";

const MARKUP_MULTIPLIER = 1.5;

function inferProductKind(service: SizzleService): "social" | "digital_account" {
  const text = [service.name, service.category, service.desc].filter(Boolean).join(" ").toLowerCase();
  return /\b(account|accounts|gmail|outlook|yahoo mail|email account|aged profile|verified profile|aged account|social profile)\b/.test(text)
    ? "digital_account"
    : "social";
}

function inferFulfilmentMode(service: SizzleService): "supplier_email" | "manual_review" {
  const text = [service.name, service.category, service.desc].filter(Boolean).join(" ").toLowerCase();
  return /\b(manual|sourced|hand.?made|custom.?sourcing)\b/.test(text) ? "manual_review" : "supplier_email";
}

export async function syncSizzleCatalogue() {
  const remote = await sizzleRequest<SizzleService[]>({ action: "services" });
  if (!Array.isArray(remote)) throw new Error("Sizzle returned an unexpected service catalogue.");

  const db = createServiceClient();
  const now = new Date().toISOString();
  const valid = remote.filter((s) => s.service != null && Number.isFinite(Number(s.rate)) && Number(s.rate) > 0);
  const rows = valid.map((s) => {
    const rate = Number(s.rate);
    const retailKobo = Math.ceil(rate * MARKUP_MULTIPLIER * 100);
    const kind = inferProductKind(s);
    return {
      external_service_id: String(s.service),
      name: String(s.name || "Unnamed Sizzle service"),
      category: String(s.category || "Other"),
      service_type: String(s.type || "default"),
      product_kind: kind,
      fulfilment_mode: inferFulfilmentMode(s),
      rate_per_1000_ngn: rate,
      retail_rate_per_1000_kobo: retailKobo,
      min_quantity: Math.max(1, Math.floor(Number(s.min) || 1)),
      max_quantity: Math.max(1, Math.floor(Number(s.max) || 1)),
      description: s.desc || null,
      dripfeed_supported: s.dripfeed === "1",
      refill_supported: s.refill === "1",
      active: !/subscription/i.test(String(s.type || "")),
      last_synced_at: now,
      updated_at: now,
    };
  }).filter((row) => row.max_quantity >= row.min_quantity);

  const { data: existing, error: existingError } = await db.from("sizzle_services")
    .select("external_service_id,refill_supported")
  if (existingError) throw existingError;
  const previous = new Map((existing ?? []).map((s) => [s.external_service_id, s]));
  for (const row of rows) {
    const old = previous.get(row.external_service_id);
    if (old && !row.refill_supported) row.refill_supported = old.refill_supported;
  }

  for (let i = 0; i < rows.length; i += 250) {
    const { error } = await db.from("sizzle_services").upsert(rows.slice(i, i + 250), { onConflict: "external_service_id" });
    if (error) throw error;
  }

  const liveIds = new Set(rows.map((r) => r.external_service_id));
  const removed = (existing ?? []).map((s) => s.external_service_id).filter((id) => !liveIds.has(id));
  if (removed.length) {
    const { error } = await db.from("sizzle_services").update({ active: false, updated_at: now }).in("external_service_id", removed);
    if (error) throw error;
  }

  return {
    servicesSeen: remote.length,
    servicesSaved: rows.length,
    servicesActivated: rows.filter((r) => r.active).length,
    servicesUnavailable: rows.filter((r) => !r.active).length,
    servicesRemoved: removed.length,
    markupPercent: 50,
    syncedAt: now,
  };
}
