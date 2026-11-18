"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Bell, CircleHelp,
  Clock3, CreditCard, LayoutDashboard, LifeBuoy, LockKeyhole, Menu,
  MessageCircle, Plus, Settings, ShieldCheck, Smartphone, Wallet, X,
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
          <div className="dash-profile"><div className="dash-avatar">G</div><div><b>Guest preview</b><small>Account not connected</small></div><span className="dash-profile-dots">•••</span></div>
        </div>
      </aside>
      {menuOpen && <button className="dash-scrim" aria-label="Close menu" onClick={()=>setMenuOpen(false)}/>}
      <section className="dash-main" id="overview">
        <header className="dash-topbar">
          <button className="dash-mobile-toggle" aria-label="Open menu" onClick={()=>setMenuOpen(true)}><Menu size={19}/></button>
          <div className="dash-breadcrumb"><span>Workspace</span><ArrowRight size={13}/><b>Overview</b></div>
          <div className="dash-top-actions"><span className="dash-preview-tag"><span/> DEMO PREVIEW</span><button aria-label="Notifications" className="dash-icon-button"><Bell size={17}/></button><div className="dash-avatar small">G</div></div>
        </header>
        <div className="dash-content">
          <div className="dash-welcome-row"><div><div className="dash-kicker">YOUR ICEYVAULT</div><h1>Welcome to your vault.</h1><p>Your account overview, wallet and number activity will live here.</p></div><Link href="/#services" className="dash-primary"><Plus size={16}/> Explore services</Link></div>
          <div className="dash-demo-notice"><ShieldCheck size={18}/><div><b>This is a dashboard preview</b><span>No real account, wallet balance, orders or messages are connected yet. Demo values are not financial records.</span></div></div>
          <div className="dash-metrics">
            <article className="dash-metric"><div className="dash-metric-head"><span>Wallet balance</span><span className="dash-metric-icon purple"><Wallet size={17}/></span></div><div className="dash-metric-value">₦0.00</div><small>NGN wallet · Demo value</small><div className="dash-metric-foot"><LockKeyhole size={13}/> Funding not enabled</div></article>
            <article className="dash-metric"><div className="dash-metric-head"><span>Active numbers</span><span className="dash-metric-icon mint"><Smartphone size={17}/></span></div><div className="dash-metric-value">—</div><small>No active numbers</small><div className="dash-metric-foot">Available after provider setup</div></article>
            <article className="dash-metric"><div className="dash-metric-head"><span>Open orders</span><span className="dash-metric-icon blue"><Clock3 size={17}/></span></div><div className="dash-metric-value">—</div><small>No orders to display</small><div className="dash-metric-foot">Order tracking not connected</div></article>
          </div>
          <div className="dash-grid">
            <section className="dash-panel dash-wallet-panel"><div className="dash-panel-head"><div><h2>Wallet activity</h2><p>Recent account transactions</p></div><a href="#coming-soon">View all <ArrowUpRight size={14}/></a></div><div className="dash-empty"><div className="dash-empty-icon"><CreditCard size={21}/></div><b>No transactions yet</b><span>Your verified wallet activity will appear here once payments are connected.</span></div></section>
            <section className="dash-panel dash-quick-panel"><div className="dash-panel-head"><div><h2>Quick actions</h2><p>Common things you can do</p></div></div><a href="/#services" className="dash-quick-action"><span className="quick-icon purple"><Plus size={17}/></span><span><b>Browse number services</b><small>Explore countries and platforms</small></span><ArrowRight size={15}/></a><div className="dash-quick-action disabled"><span className="quick-icon mint"><ArrowDownToLine size={17}/></span><span><b>Add funds</b><small>Available when wallet is enabled</small></span><LockKeyhole size={14}/></div><div className="dash-quick-action disabled"><span className="quick-icon blue"><MessageCircle size={17}/></span><span><b>View messages</b><small>Provider inbox not connected</small></span><LockKeyhole size={14}/></div></section>
          </div>
          <section className="dash-panel dash-orders-panel"><div className="dash-panel-head"><div><h2>Recent orders</h2><p>Track your latest number activations and rentals</p></div><span className="dash-muted-label">NO LIVE DATA</span></div><div className="dash-table-head"><span>ORDER</span><span>SERVICE</span><span>STATUS</span><span>DATE</span><span>AMOUNT</span></div><div className="dash-order-empty"><Smartphone size={18}/> Your orders will appear here when account services are active.</div></section>
          <footer className="dash-footer"><span>© {new Date().getFullYear()} IceyVault</span><span><ShieldCheck size={13}/> Secure account workspace · Preview mode</span><a href="mailto:support@iceyvault.com"><CircleHelp size={13}/> Need help?</a></footer>
        </div>
      </section>
    </main>
  );
}
