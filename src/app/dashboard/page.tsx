"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {Wallet,ShoppingBag,MessageCircle,ArrowUpRight,Activity,RefreshCw,ShieldCheck,Phone,Users} from "lucide-react";
type D={wallet:{balance_kobo:number;currency:string}|null;orders:Array<{id:string;status:string;retail_amount_kobo:number;created_at?:string}>;messages:Array<{id:string}>};
const money=(v:number)=>"₦"+(v/100).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2});
export default function DashboardPage(){
 const [d,setD]=useState<D>({wallet:null,orders:[],messages:[]}),[loading,setLoading]=useState(true);
 async function load(){setLoading(true);try{const r=await fetch("/api/account/overview",{cache:"no-store"});if(r.ok)setD(await r.json());}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 const cards=[
  {title:"Wallet balance",value:d.wallet?money(d.wallet.balance_kobo):"₦0.00",sub:"Fund wallet and view transactions",href:"/dashboard/wallet",Icon:Wallet},
  {title:"My orders",value:String(d.orders.length),sub:"Track number activations",href:"/dashboard/orders",Icon:ShoppingBag},
  {title:"SMS inbox",value:String(d.messages.length),sub:"View verification messages",href:"/dashboard/messages",Icon:MessageCircle}
 ];
 return <>
  <section className="workspace-panel dashboard-welcome">
   <span className="workspace-eyebrow">YOUR ICEYVAULT</span>
   <h1>Your number services, in one place.</h1>
   <p>Manage your wallet, verified number services, activations and SMS messages from one secure workspace.</p>
   <Link className="workspace-primary dashboard-browse" href="/dashboard/catalog">Browse services <ArrowUpRight size={16}/></Link>
  </section>
  <div className="dashboard-stat-grid">{cards.map(({title,value,sub,href,Icon})=><Link key={title} href={href} className="dashboard-stat-card"><span className="dashboard-stat-icon"><Icon size={20}/></span><span className="dashboard-stat-title">{title}</span><strong>{loading?"—":value}</strong><small>{sub} <ArrowUpRight size={13}/></small></Link>)}</div>
  <section className="workspace-panel">
   <div className="workspace-section-title"><div><h2>Recent activity</h2><p>Your latest number orders and wallet activity.</p></div><button className="workspace-quiet-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Refresh</button></div>
   {loading?<div className="workspace-empty">Loading your account activity…</div>:d.orders.length?<div className="workspace-list">{d.orders.slice(0,5).map(o=><div className="workspace-list-row" key={o.id}><span className="workspace-list-icon"><Activity size={17}/></span><div className="workspace-list-main"><b>{o.status.replaceAll("_"," ")}</b><small>{o.created_at?new Date(o.created_at).toLocaleString("en-NG"):"Order activity"}</small><Link href={"/dashboard/orders/"+o.id}>View order</Link></div><strong>{money(o.retail_amount_kobo)}</strong></div>)}</div>:<div className="workspace-empty"><ShoppingBag size={24}/><p>No orders yet. Browse services when verified products are available.</p></div>}
  </section>
  <section className="dashboard-trust"><ShieldCheck size={20}/><div><b>Protected wallet and order activity</b><p>Wallet funding is confirmed server-side. Supplier numbers are published only after catalogue verification, pricing and stock checks.</p></div></section>
 </>;
}