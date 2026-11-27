"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Data = {
  order: { id:string; user_id:string; status:string; retail_amount_kobo:number; currency:string; created_at:string; updated_at:string; fulfilled_at:string|null; expires_at:string|null; number_id:string|null; offer_kind:string };
  provider: { provider_order_ref:string; status:string; supplier_cost_usd:number|null; wholesale_amount_minor:number|null; wholesale_currency:string|null; last_provider_response:unknown }|null;
  number: { phoneNumber:string|null; e164_last4:string; country_iso2:string; service_code:string|null; status:string }|null;
  tier: { tier_label:string; country_iso2:string; retail_price_kobo:number }|null;
  messages:Array<{id:string;sender:string|null;content:string;received_at:string}>;
};
const money=(k:number,c:string)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:c||"NGN"}).format((k||0)/100);
const when=(v:string)=>new Date(v).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"});
export default function AdminOrderDetail({id}:{id:string}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true);
 async function load(){try{const r=await fetch("/api/admin/orders/"+encodeURIComponent(id),{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not load order");setData(j);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load order");}finally{setBusy(false);}}
 useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),10000);return()=>window.clearInterval(timer);},[id]);
 const card:React.CSSProperties={background:"white",border:"1px solid #e5e7ef",borderRadius:14,padding:18,marginTop:14};
 return <main style={{maxWidth:900,margin:"28px auto",padding:"0 18px 40px",color:"#171923"}}>
  <Link href="/admin/orders" style={{color:"#6d5bd0",fontSize:13}}>← Back to orders</Link>
  <h1 style={{margin:"16px 0 6px"}}>Order details</h1>
  <p style={{color:"#737789",fontSize:13}}>Supplier fulfilment, customer payment and verification messages. Automatically refreshes.</p>
  {busy&&!data?<p>Loading order…</p>:null}{error?<p role="alert" style={{...card,color:"#b42318"}}>{error}</p>:null}
  {data?<>
   <section style={card}><div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><b>Order {data.order.id.slice(0,8)}</b><b>{data.order.status.replaceAll("_"," ")}</b></div>
    <p>Customer ID: {data.order.user_id}</p><h2 style={{fontSize:28}}>{data.number?.phoneNumber||"Number not yet linked"}</h2>
    <p>Purchase: {money(data.order.retail_amount_kobo,data.order.currency)} · Created {when(data.order.created_at)}</p>
    <p>Service: {data.tier?.tier_label||data.number?.service_code||"SMS activation"} · Country: {data.tier?.country_iso2||data.number?.country_iso2||"—"}</p>
    {data.order.expires_at?<p>Expires: {when(data.order.expires_at)}</p>:null}
   </section>
   <section style={card}><h2>Supplier fulfilment</h2><p>SMSCode reference: {data.provider?.provider_order_ref||"Not linked"}</p><p>Supplier status: {data.provider?.status||"Pending"}</p><p>Supplier cost: {data.provider?.supplier_cost_usd==null?"—":"$"+Number(data.provider.supplier_cost_usd).toFixed(4)}</p></section>
   <section style={card}><h2>Verification messages ({data.messages.length})</h2>{data.messages.length?data.messages.map(m=><article key={m.id} style={{borderTop:"1px solid #eceef3",padding:"12px 0"}}><b>{m.sender||"SMS"}</b><small style={{float:"right"}}>{when(m.received_at)}</small><pre style={{whiteSpace:"pre-wrap",font:"inherit",background:"#f7f7fb",padding:12,borderRadius:9}}>{m.content}</pre></article>):<p>No verification messages stored yet. This page refreshes automatically.</p>}</section>
  </>:null}
 </main>
}
