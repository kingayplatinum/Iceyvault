import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  LayoutDashboard, ShoppingBag, Wallet, MessageCircle, Bell, LifeBuoy, Settings, LogOut, MoreHorizontal, Users, Phone,
} from "lucide-react";
import DashboardMobileNav from "@/components/dashboard-mobile-nav";
import "./workspace.css";

const nav = [
  ["Overview", "/dashboard", LayoutDashboard],
  ["Virtual numbers", "/dashboard/catalog", Phone],
  ["Social media", "/dashboard/social", Users],
  ["My orders", "/dashboard/orders", ShoppingBag],
  ["Wallet", "/dashboard/wallet", Wallet],
  ["SMS inbox", "/dashboard/messages", MessageCircle],
  ["Notifications", "/dashboard/notifications", Bell],
  ["Support", "/dashboard/support", LifeBuoy],
  ["Settings", "/dashboard/settings", Settings],
] as const;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?next=/dashboard");
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const name = profile?.display_name || user.email?.split("@")[0] || "Customer";

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link href="/" className="workspace-brand" aria-label="IceyVault home"><Image src="/iceyvault-logo.webp" alt="IceyVault" width={240} height={65} priority /></Link>
        <div className="workspace-sidebar-caption">CUSTOMER WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(([label, href, Icon]) => (
            <Link href={href} key={href}><Icon size={17}/><span>{label}</span></Link>
          ))}
        </nav>
        <div className="workspace-account">
          <div className="workspace-avatar">{name.slice(0, 1).toUpperCase()}</div>
          <div className="workspace-account-copy"><b>{name}</b><small>{user.email}</small></div>
          <form action="/auth/signout" method="post"><button aria-label="Sign out"><LogOut size={16}/></button></form>
        </div>
      </aside>

      <header className="workspace-mobile-header">
        <Link href="/" className="workspace-brand" aria-label="IceyVault home"><Image src="/iceyvault-logo.webp" alt="IceyVault" width={240} height={65} priority /></Link>
        <div className="workspace-mobile-header-actions">
          <Link href="/dashboard/wallet" className="workspace-mobile-balance"><Wallet size={15}/> Wallet</Link>
          <details className="workspace-mobile-more">
            <summary aria-label="More account options"><MoreHorizontal size={22}/></summary>
            <div className="workspace-mobile-menu">
              <div className="workspace-mobile-menu-user"><b>{name}</b><small>{user.email}</small></div>
              {nav.filter(([, href]) => !["/dashboard","/dashboard/catalog","/dashboard/orders","/dashboard/wallet"].includes(href)).map(([label, href, Icon]) => <Link href={href} key={href}><Icon size={17}/>{label}</Link>)}
              <form action="/auth/signout" method="post"><button><LogOut size={17}/>Sign out</button></form>
            </div>
          </details>
        </div>
      </header>

      <main className="workspace-main">
        <header className="workspace-top">
          <div><b>Customer workspace</b><small>Welcome back, {name}</small></div>
          <span>ACCOUNT ACTIVE</span>
        </header>
        <div className="workspace-content">{children}</div>
      </main>

      <DashboardMobileNav />
      <Link href="/dashboard/support" className="workspace-support-fab" aria-label="Open customer support"><LifeBuoy size={21}/></Link>
    </div>
  );
}
