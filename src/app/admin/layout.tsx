export const dynamic = "force-dynamic";

import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ShieldCheck, LayoutDashboard, Users, ShoppingBag, CreditCard, Store,
  Layers, RotateCcw, BarChart3, ScrollText, Settings, MoreHorizontal, Activity,
} from "lucide-react";
import "./admin.css";

const nav = [
  ["Overview", "/admin/overview", LayoutDashboard],
  ["Customers", "/admin/customers", Users],
  ["Orders", "/admin/orders", ShoppingBag],
  ["Payments & wallet", "/admin/payments", CreditCard],
  ["Supplier connection", "/admin/suppliers", Store],
  ["Catalogue & tiers", "/admin", Layers],
  ["Social supplier", "/admin/sizzle", Activity],
  ["Refunds", "/admin/refunds", RotateCcw],
  ["Profit & loss", "/admin/analytics", BarChart3],
  ["Audit logs", "/admin/audit", ScrollText],
  ["Settings", "/admin/settings", Settings],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect("/account?next=/admin");

  const { data: role } = await auth.from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();

  if (!role) redirect("/dashboard");

  const mobilePrimary = nav.slice(0, 4);
  const mobileMore = nav.slice(4);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <Link href="/" className="admin-brand" aria-label="IceyVault admin home"><Image src="/iceyvault-logo.webp" alt="IceyVault" width={240} height={65} priority /><small>ADMIN</small></Link>
          <details className="admin-mobile-more">
            <summary aria-label="More admin pages"><MoreHorizontal size={21} /></summary>
            <div className="admin-mobile-menu">
              <b>More management</b>
              {mobileMore.map(([label, href, Icon]) => (
                <Link key={href} href={href}><Icon size={17} /><span>{label}</span></Link>
              ))}
            </div>
          </details>
        </div>

        <div className="admin-nav-label">MANAGEMENT</div>
        <nav className="admin-desktop-nav" aria-label="Admin navigation">
          {nav.slice(0, 4).map(([label, href, Icon]) => (
            <Link key={href} href={href} className="admin-nav-link">
              <Icon size={17} /><span>{label}</span>
            </Link>
          ))}
          <details className="admin-more">
            <summary><MoreHorizontal size={18} /> More</summary>
            <div className="admin-more-menu">
              {mobileMore.map(([label, href, Icon]) => (
                <Link key={href} href={href} className="admin-nav-link">
                  <Icon size={17} /><span>{label}</span>
                </Link>
              ))}
            </div>
          </details>
        </nav>
        <div className="admin-sidebar-foot"><ShieldCheck size={16} /> Secure administrator access</div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div><b>IceyVault Control Centre</b><small>Management workspace</small></div>
          <div className="admin-top-right">
            <span className="admin-role">ADMINISTRATOR</span>
            <span className="admin-user">{user.email}</span>
            <Link href="/dashboard">Customer view ↗</Link>
          </div>
        </header>
        <main className="admin-content">{children}</main>
      </div>

      <nav className="admin-mobile-nav" aria-label="Mobile admin navigation">
        {mobilePrimary.map(([label, href, Icon]) => (
          <Link key={href} href={href}>
            <Icon size={19} />
            <span>{label === "Overview" ? "Home" : label === "Customers" ? "Customers" : label === "Payments & wallet" ? "Payments" : label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
