import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).in("role", ["admin", "super_admin"]).maybeSingle();
  if (!role) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

  const tables = ["profiles", "orders", "wallets", "wallet_transactions", "payment_transactions", "messages", "refunds", "notifications", "audit_logs", "smscode_service_catalogue", "smscode_product_tiers"] as const;
  const counts = await Promise.all(tables.map(async (table) => {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    return [table, error ? null : count] as const;
  }));
  const data = Object.fromEntries(counts);
  const failed = counts.filter(([, value]) => value === null).map(([key]) => key);
  const [{ data: recentOrders }, { data: recentPayments }, { data: recentAudit }, { data: services }, { data: tiers }] = await Promise.all([
    supabase.from("orders").select("id,status,retail_amount_kobo,currency,created_at").order("created_at", { ascending: false }).limit(6),
    supabase.from("payment_transactions").select("id,gateway,status,amount_kobo,currency,created_at").order("created_at", { ascending: false }).limit(6),
    supabase.from("audit_logs").select("id,action,entity_type,created_at").order("created_at", { ascending: false }).limit(6),
    supabase.from("smscode_service_catalogue").select("id,display_name,supported,active,last_verified_at").order("display_name"),
    supabase.from("smscode_product_tiers").select("id,tier_label,active,max_supplier_price_usd,retail_price_kobo,last_inventory_count,last_verified_at").order("created_at", { ascending: false }).limit(12)
  ]);
  return NextResponse.json({
    database: "connected",
    partial: failed.length > 0,
    unavailableTables: failed,
    counts: data,
    recentOrders: recentOrders ?? [],
    recentPayments: recentPayments ?? [],
    recentAudit: recentAudit ?? [],
    services: services ?? [],
    tiers: tiers ?? [],
    checkedAt: new Date().toISOString()
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
