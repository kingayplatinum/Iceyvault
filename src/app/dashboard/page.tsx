"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, CircleHelp,
  Clock3, CreditCard, LayoutDashboard, LifeBuoy, LockKeyhole, Menu,
  MessageCircle, Plus, Settings, ShieldCheck, Smartphone, Wallet,
} from "lucide-react";
import "./dashboard.css";

const navItems = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "My orders", icon: Smartphone, active: false },
  { label: "Wallet", icon: Wallet, active: false },
  { label: "Messages", icon: MessageCircle, active: false },
];

export default function DashboardPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileName, setProfileName] = useState("Account");
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Array<{id:string;direction:string;amount_kobo:number;description:string|null;created_at:string}>>([]);
  useEffect(() => { let active=true; const supabase=createClient(); (async()=>{ const {data:{user}}=await supabase.auth.getUser(); if(!user){window.location.assign("/account");return;} if(active){setProfileName(user.user_metadata?.name || user.email?.split("@")[0] || "Account");} const [{data:wallet},{data:ledger}]=await Promise.all([supabase.from("wallets").select("balance_kobo").eq("user_id",user.id).maybeSingle(),supabase.from("wallet_transactions").select("id,direction,amount_kobo,description,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(5)]); if(active){setBalance(wallet?.balance_kobo ?? 0);setTransactions(ledger ?? []);} })(); return()=>{active=false;}; }, []);
  return (
    <main className="dash-shell">
      <aside className={menuOpen ? "dash-sidebar dash-sidebar-open" : "dash-sidebar"}>
        <Link href="/" className="dash-brand"><span className="dash-brand-mark">i</span><span>icey<span>vault</span></span></Link>
        <div className="dash-workspace-label">WORKSPACE</div>
        <nav className="dash-nav" aria-label="Dashboard navigation">
          {navItems.map(({label,icon:Icon,active}) => <a key={label} href={active ? "#overview" : "#coming-soon"} className={active ? "dash-nav-item active" : "dash-nav-item"} onClick={(e)=>{if(!active)e.preventDefault();setMenuOpen(false);}}><Icon size={17}/>{label}{!active && <span className="dash-soon">Soon</span>}</a>)}
        </nav>
        <div className="dash-sidebar-bottom">
          <a href="#coming-soon" className="dash-nav-item" onClick={e=>e.preventDefault()}><Settings size={17}/>Settings<span className="dash-soon">Soon</span></a>
          <a href="#coming-soon" className="dash-nav-item" onClick={e=>e.preventDefault()}><LifeBuoy size={17}/>Help centre</a>
          <div className="dash-profile"><div className="dash-avatar">{profileName.slice(0,1).toUpperCase()}</div><div><b>{profileName}</b><small>Verified account</small></div><span className="dash-profile-dots">•••</span></div>
        </div>
      </aside>
      {menuOpen && <button className="dash-scrim" aria-label="Close menu" onClick={()=>setMenuOpen(false)}/>}
      <section className="dash-main" id="overview">
        <header className="dash-topbar">
          <button className="dash-mobile-toggle" aria-label="Open menu" onClick={()=>setMenuOpen(true)}><Menu size={19}/></button>
          <div className="dash-breadcrumb"><span>Workspace</span><ArrowRight size={13}/><b>Overview</b></div>
          <div className="dash-top-actions"><span className="dash-preview-tag"><span/> LIVE ACCOUNT</span><button aria-label="Notifications" className="dash-icon-button"><Bell size={17}/></button><div className="dash-avatar small">{profileName.slice(0,1).toUpperCase()}</div></div>
        </header>
        <div className="dash-content">
          <div className="dash-welcome-row"><div><div className="dash-kicker">YOUR ICEYVAULT</div><h1>Welcome to your vault, {profileName.split(" ")[0]}.</h1><p>Your account overview, wallet and number activity will live here.</p></div><Link href="/#services" className="dash-primary"><Plus size={16}/> Explore services</Link></div>
          
          <div className="dash-metrics">
            <article className="dash-metric"><div className="dash-metric-head"><span>Wallet balance</span><span className="dash-metric-icon purple"><Wallet size={17}/></span></div><div className="dash-metric-value">{balance===null?"Loading…":new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN"}).format(balance/100)}</div><small>NGN wallet · Available balance</small><div className="dash-metric-foot"><LockKeyhole size={13}/> Secure wallet ledger · Funding not yet enabled</div></article>
            <article className="dash-metric"><div className="dash-metric-head"><span>Active numbers</span><span className="dash-metric-icon mint"><Smartphone size={17}/></span></div><div className="dash-metric-value">—</div><small>No active numbers</small><div className="dash-metric-foot">Available after provider setup</div></article>
            <article className="dash-metric"><div className="dash-metric-head"><span>Open orders</span><span className="dash-metric-icon blue"><Clock3 size={17}/></span></div><div className="dash-metric-value">—</div><small>No orders to display</small><div className="dash-metric-foot">Order tracking not connected</div></article>
          </div>
          <div className="dash-grid">
            <section className="dash-panel dash-wallet-panel"><div className="dash-panel-head"><div><h2>Wallet activity</h2><p>Recent account transactions</p></div><a href="#coming-soon">View all <ArrowUpRight size={14}/></a></div>{transactions.length===0?<div className="dash-empty"><div className="dash-empty-icon"><CreditCard size={21}/></div><b>No transactions yet</b><span>Your wallet transactions will appear here after a verified transaction.</span></div>:<div className="dash-transaction-list">{transactions.map(tx=><div key={tx.id} className="dash-transaction"><span>{tx.description || (tx.direction==="credit"?"Wallet credit":"Wallet debit")}</span><b>{tx.direction==="credit"?"+":"−"}{new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN"}).format(tx.amount_kobo/100)}</b><small>{new Date(tx.created_at).toLocaleString()}</small></div>)}</div>}</section>
            <section className="dash-panel dash-quick-panel"><div className="dash-panel-head"><div><h2>Quick actions</h2><p>Common things you can do</p></div></div><Link href="/#services" className="dash-quick-action"><span className="quick-icon purple"><Plus size={17}/></span><span><b>Browse number services</b><small>Explore countries and platforms</small></span><ArrowRight size={15}/></Link><div className="dash-quick-action disabled"><span className="quick-icon mint"><ArrowDownToLine size={17}/></span><span><b>Add funds</b><small>Available when wallet is enabled</small></span><LockKeyhole size={14}/></div><div className="dash-quick-action disabled"><span className="quick-icon blue"><MessageCircle size={17}/></span><span><b>View messages</b><small>Provider inbox not connected</small></span><LockKeyhole size={14}/></div></section>
          </div>
          <section className="dash-panel dash-orders-panel"><div className="dash-panel-head"><div><h2>Recent orders</h2><p>Track your latest number activations and rentals</p></div><span className="dash-muted-label">NO LIVE DATA</span></div><div className="dash-table-head"><span>ORDER</span><span>SERVICE</span><span>STATUS</span><span>DATE</span><span>AMOUNT</span></div><div className="dash-order-empty"><Smartphone size={18}/> Your orders will appear here when account services are active.</div></section>
          <footer className="dash-footer"><span>© {new Date().getFullYear()} IceyVault</span><span><ShieldCheck size={13}/> Secure account workspace · Preview mode</span><a href="mailto:support@iceyvault.com"><CircleHelp size={13}/> Need help?</a></footer>
        </div>
      </section>
    </main>
  );
}
