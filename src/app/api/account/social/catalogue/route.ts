import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncSizzleCatalogue } from "@/lib/sizzle/sync";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  try {
    // Pull the supplier's current live catalogue on every customer catalogue request.
    await syncSizzleCatalogue();
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "The live Sizzle catalogue could not be refreshed. No stale services are being offered.",
    }, { status: 503 });
  }

  const service = createServiceClient();
  const { data, error } = await service.from("sizzle_services")
    .select("id,name,category,service_type,product_kind,description,min_quantity,max_quantity,retail_rate_per_1000_kobo,dripfeed_supported,refill_supported")
    .eq("active", true).gt("retail_rate_per_1000_kobo", 0).order("category").order("name");
  if (error) return NextResponse.json({ error: "Could not load the refreshed Sizzle catalogue." }, { status: 503 });
  return NextResponse.json({ services: data ?? [], markupPercent: 50, syncedLive: true }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
