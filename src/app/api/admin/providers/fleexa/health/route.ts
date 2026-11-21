import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FleexaApiError, getFleexaBalance, getFleexaProfile, getFleexaSms4Apps, isFleexaConfigured } from "@/lib/providers/fleexa-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data: role } = await supabase.from("user_roles").select("role")
    .eq("user_id", user.id).in("role", ["admin", "super_admin"]).maybeSingle();
  if (!role) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  if (!isFleexaConfigured()) return NextResponse.json({ configured: false, message: "Set FLEEXA_API_KEY as a server-only encrypted environment variable." }, { status: 503 });

  try {
    const [profile, balance, apps] = await Promise.all([
      getFleexaProfile(),
      getFleexaBalance(),
      getFleexaSms4Apps(),
    ]);
    return NextResponse.json({
      configured: true,
      connected: true,
      checks: {
        profile: "ok",
        balance: { status: "ok", currency: balance.currency, balance: balance.balance, bonusBalance: balance.bonus_balance ?? null },
        smsCatalogue: { status: "ok", serviceCount: Array.isArray(apps) ? apps.length : 0 },
      },
      profile,
      note: "Read-only checks only. No supplier purchase was made.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof FleexaApiError ? error.status : 502;
    return NextResponse.json({
      configured: true,
      connected: false,
      error: error instanceof Error ? error.message : "Fleexa connection failed.",
    }, { status: status === 401 || status === 403 ? 502 : status });
  }
}
