export const dynamic = "force-dynamic";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  LayoutDashboard, ShoppingBag, Wallet, MessageCircle, Bell, LifeBuoy, Settings, LogOut, MoreHorizontal,
} from "lucide-react";
import "./workspace.css";

const nav = [
  ["Overview", "/dashboard", LayoutDashboard],
  ["Browse services", "/dashboard/catalog", ShoppingBag],
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
  const mobilePrimary = nav.slice(0, 4);
  const mobileMore = nav.slice(4);

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
        <details className="workspace-mobile-more">
          <summary aria-label="More account options"><MoreHorizontal size={22}/></summary>
          <div className="workspace-mobile-menu">
            <div className="workspace-mobile-menu-user"><b>{name}</b><small>{user.email}</small></div>
            {mobileMore.map(([label, href, Icon]) => <Link href={href} key={href}><Icon size={17}/>{label}</Link>)}
            <form action="/auth/signout" method="post"><button><LogOut size={17}/>Sign out</button></form>
          </div>
        </details>
      </header>

      <main className="workspace-main">
        <header className="workspace-top">
          <div><b>Customer workspace</b><small>Welcome back, {name}</small></div>
          <span>ACCOUNT ACTIVE</span>
        </header>
        <div className="workspace-content">{children}</div>
      </main>

      <nav className="workspace-mobile-nav" aria-label="Mobile navigation">
        {mobilePrimary.map(([label, href, Icon]) => (
          <Link href={href} key={href}><Icon size={19}/><span>{label === "Overview" ? "Home" : label === "Browse services" ? "Services" : label === "My orders" ? "Orders" : label}</span></Link>
        ))}
      </nav>
    </div>
  );
}