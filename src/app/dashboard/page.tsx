"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {Wallet,ShoppingBag,MessageCircle,ArrowUpRight,Activity,RefreshCw,ShieldCheck,Phone,Users,ChevronRight} from "lucide-react";
type D={wallet:{balance_kobo:number;currency:string}|null;orders:Array<{id:string;status:string;retail_amount_kobo:number;created_at?:string;offer_kind?:string}>;messages:Array<{id:string}>;profile?:{display_name?:string|null}|null};
const money=(v:number)=>"₦"+(v/100).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2});
export default function DashboardPage(){
 const [d,setD]=useState<D>({wallet:null,orders:[],messages:[]}),[loading,setLoading]=useState(true);
 async function load(){setLoading(true);try{const r=await fetch("/api/account/overview",{cache:"no-store"});if(r.ok)setD(await r.json());}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 const cards=[
  {title:"My orders",value:String(d.orders.length),sub:"Track your purchases",href:"/dashboard/orders",Icon:ShoppingBag},
  {title:"SMS inbox",value:String(d.messages.length),sub:"View incoming messages",href:"/dashboard/messages",Icon:MessageCircle}
 ];
 return <>
  <section className="dashboard-wallet-hero">
   <div className="dashboard-wallet-copy">
    <span className="dashboard-wallet-label">WALLET BALANCE <span className="dashboard-wallet-active"><i/> ACTIVE</span></span>
    <strong>{loading?"—":d.wallet?money(d.wallet.balance_kobo):"₦0.00"}</strong>
    <small>NGN · Available balance</small>
    <div className="dashboard-wallet-actions"><Link href="/dashboard/wallet">Fund wallet <ArrowUpRight size={16}/></Link><Link href="/dashboard/wallet">Transactions <Activity size={16}/></Link></div>
   </div>
   <div className="dashboard-wallet-art"><Wallet size={58}/><span>₦</span></div>
  </section>

  <section className="dashboard-shortcuts" aria-label="Quick services">
   <Link href="/dashboard/catalog"><span className="dashboard-shortcut-icon numbers"><Phone size={21}/></span><span><b>Buy numbers</b><small>Virtual numbers for SMS verification</small></span><ChevronRight size={19}/></Link>
   <Link href="/dashboard/social"><span className="dashboard-shortcut-icon social"><Users size={21}/></span><span><b>Social media services</b><small>Explore live services and digital accounts</small></span><ChevronRight size={19}/></Link>
  </section>

  <div className="dashboard-section-heading"><div><h2>Your activity</h2><p>Quick access to your account activity.</p></div><button className="workspace-quiet-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Refresh</button></div>
  <div className="dashboard-stat-grid">{cards.map(({title,value,sub,href,Icon})=><Link key={title} href={href} className="dashboard-stat-card"><span className="dashboard-stat-icon"><Icon size={20}/></span><span className="dashboard-stat-title">{title}</span><strong>{loading?"—":value}</strong><small>{sub} <ArrowUpRight size={13}/></small></Link>)}</div>

  <section className="workspace-panel dashboard-recent-panel">
   <div className="workspace-section-title"><div><h2>Recent orders</h2><p>Keep an eye on your latest purchases.</p></div><Link className="dashboard-view-all" href="/dashboard/orders">View all <ArrowUpRight size={14}/></Link></div>
   {loading?<div className="workspace-empty">Loading your account activity…</div>:d.orders.length?<div className="workspace-list">{d.orders.slice(0,5).map(o=><div className="workspace-list-row" key={o.id}><span className="workspace-list-icon"><Activity size={17}/></span><div className="workspace-list-main"><b>{(o.offer_kind||"Number order").replaceAll("_"," ")} · {o.status.replaceAll("_"," ")}</b><small>{o.created_at?new Date(o.created_at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"}):"Order activity"}</small><Link href={"/dashboard/orders/"+o.id}>View order details</Link></div><strong>{money(o.retail_amount_kobo)}</strong></div>)}</div>:<div className="workspace-empty"><ShoppingBag size={24}/><p>No orders yet. Browse available services to get started.</p><Link className="workspace-primary" href="/dashboard/catalog">Explore numbers <ArrowUpRight size={15}/></Link></div>}
  </section>
  <section className="dashboard-help-strip"><span><ShieldCheck size={19}/></span><div><b>Need a hand?</b><p>Find help with payments, orders or verification messages.</p></div><Link href="/dashboard/support">Get support <ChevronRight size={16}/></Link></section>
 </>;
}
