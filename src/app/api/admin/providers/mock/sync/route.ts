import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMockProviderAdapter } from "@/lib/providers";
import { syncProviderCatalogue } from "@/lib/providers/sync";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data: role } = await supabase.from("user_roles").select("role")
    .eq("user_id", user.id).in("role", ["admin", "super_admin"]).maybeSingle();
  if (!role) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

  try {
    const result = await syncProviderCatalogue(getMockProviderAdapter());
    return NextResponse.json({ ok: true, ...result, note: "Mock catalogue synced as inactive test data; nothing is customer-visible or purchasable." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier sync failed.";
    const status = message.includes("credentials are not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
