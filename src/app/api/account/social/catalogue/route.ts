import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data, error } = await auth.from("sizzle_services")
    .select("id,name,category,service_type,product_kind,description,min_quantity,max_quantity,retail_rate_per_1000_kobo,dripfeed_supported,refill_supported")
    .eq("active", true).gt("retail_rate_per_1000_kobo", 0).order("category").order("name");
  if (error) return NextResponse.json({ error: "Social services are not available yet. The Sizzle database migration may still need to be applied." }, { status: 503 });
  const fresh = await auth.from("sizzle_services").select("id,last_synced_at").eq("active",true);
  const cutoff = Date.now() - 24*60*60*1000;
  const freshIds = new Set((fresh.data ?? []).filter(x => x.last_synced_at && new Date(x.last_synced_at).getTime() >= cutoff).map(x => x.id));
  return NextResponse.json({ services: (data ?? []).filter(x => freshIds.has(x.id)) }, { headers: { "Cache-Control": "no-store" } });
}
