"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, RefreshCw, ShoppingBag, Users, UserRoundPlus, RotateCcw } from "lucide-react";

type Service = { id:string; name:string; category:string; service_type:string; product_kind:"social"|"digital_account"; description:string|null; min_quantity:number; max_quantity:number; retail_rate_per_1000_kobo:number; dripfeed_supported:boolean; refill_supported:boolean };
type Order = { id:string; product_kind:string; status:string; quantity:number; retail_amount_kobo:number; provider_order_ref:string|null; created_at:string; remains:number|null; start_count:number|null; service:{name:string;category:string}|null; refill_supported:boolean };
const money=(v:number)=>"₦"+(v/100).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2});
export default function SocialMarketplace(){
 const [services,setServices]=useState<Service[]>([]),[orders,setOrders]=useState<Order[]>([]);
 const [kind,setKind]=useState<"social"|"digital_account">("social"),[category,setCategory]=useState("all"),[selected,setSelected]=useState("");
 const [quantity,setQuantity]=useState("1000"),[link,setLink]=useState(""),[email,setEmail]=useState(""),[comments,setComments]=useState("");
 const [runs,setRuns]=useState(""),[interval,setInterval]=useState("0");
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState("");
 const current=services.find(s=>s.id===selected)||null;
 const categories=useMemo(()=>Array.from(new Set(services.filter(s=>s.product_kind===kind).map(s=>s.category))).sort(),[services,kind]);
 const visible=services.filter(s=>s.product_kind===kind&&(category==="all"||s.category===category));
 const commentCount=comments.split(/\r?\n/).filter(x=>x.trim()).length;
 const orderTotal=current?Math.ceil(current.retail_rate_per_1000_kobo*(current.service_type==="custom_comments"?commentCount:Number(quantity)||0)/1000):0;
 async function load(){
  setLoading(true);
  try{
   const [a,b]=await Promise.all([fetch("/api/account/social/catalogue",{cache:"no-store"}),fetch("/api/account/social/orders",{cache:"no-store"})]);
   const aj=await a.json(),bj=await b.json();
   if(!a.ok)throw new Error(aj.error||"Could not load social services.");
   setServices(aj.services||[]);setOrders(bj.orders||[]);
   if(!selected&&aj.services?.length)setSelected(aj.services.find((s:Service)=>s.product_kind==="social")?.id||aj.services[0].id);
  }catch(e){setNotice(e instanceof Error?e.message:"Social marketplace is unavailable.");}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[]);
 useEffect(()=>{const first=visible[0];if(!visible.some(s=>s.id===selected))setSelected(first?.id||"");},[kind,category,services]);
 useEffect(()=>{if(current)setQuantity(String(current.min_quantity));},[selected]);
 async function buy(){
  if(!current)return;
  const qty=current.service_type==="custom_comments"?commentCount:Number(quantity);
  if(current.product_kind==="social"&&!/^https?:\/\//i.test(link)){setNotice("Enter a valid public profile or post URL.");return;}
  if(current.product_kind==="digital_account"&&!/^\S+@\S+\.\S+$/.test(email)){setNotice("Enter the email address for account delivery.");return;}
  if(qty<current.min_quantity||qty>current.max_quantity){setNotice("Quantity must be between "+current.min_quantity+" and "+current.max_quantity+".");return;}
  if(current.service_type==="custom_comments"&&!commentCount){setNotice("Enter at least one comment, one per line.");return;}
  setBusy(true);setNotice("Reserving your order and contacting Sizzle Social…");
  try{
   const key=crypto.randomUUID();
   const r=await fetch("/api/account/social/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({serviceId:current.id,quantity:qty,idempotencyKey:key,targetLink:link,destinationEmail:email,comments,runs:runs?Number(runs):undefined,interval:Number(interval)})});
   const j=await r.json();
   if(!r.ok&&r.status!==202)throw new Error(j.error||"Order could not be placed.");
   setNotice(j.message||"Your order has been submitted. Check My social orders for updates.");
   setLink("");setComments("");setRuns("");
   await load();
  }catch(e){setNotice(e instanceof Error?e.message:"Order request failed.");}
  finally{setBusy(false);}
 }
 async function refreshOrder(id:string){
  try{const r=await fetch("/api/account/social/orders/"+id,{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not refresh order.");setOrders(old=>old.map(o=>o.id===id?{...o,...j.order}:o));}
  catch(e){setNotice(e instanceof Error?e.message:"Could not refresh order.");}
 }
 async function refill(id:string){
  setBusy(true);try{const r=await fetch("/api/account/social/orders/"+id,{method:"POST"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Refill request failed.");setNotice("Refill request "+j.refillId+" was submitted.");}catch(e){setNotice(e instanceof Error?e.message:"Refill request failed.");}finally{setBusy(false);}
 }
 return <div className="social-market">
  <header className="workspace-page-heading"><div><span className="workspace-eyebrow">SOCIAL MARKETPLACE</span><h1>Social media services</h1><p>Purchase social media services and digital accounts using your IceyVault wallet.</p></div><button className="workspace-quiet-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
  <div className="social-kind-tabs"><button className={kind==="social"?"selected":""} onClick={()=>{setKind("social");setCategory("all");}}><Users size={17}/> Followers & engagement</button><button className={kind==="digital_account"?"selected":""} onClick={()=>{setKind("digital_account");setCategory("all");}}><UserRoundPlus size={17}/> Digital accounts</button></div>
  <section className="workspace-panel">
   <div className="workspace-section-title"><div><h2>{kind==="social"?"Choose a social service":"Browse digital accounts"}</h2><p>Only services approved and priced by IceyVault administrators appear here.</p></div><span className="workspace-count">{visible.length}</span></div>
   {categories.length>1?<div className="social-categories"><button className={category==="all"?"selected":""} onClick={()=>setCategory("all")}>All</button>{categories.map(c=><button key={c} className={category===c?"selected":""} onClick={()=>setCategory(c)}>{c}</button>)}</div>:null}
   {loading?<div className="workspace-empty">Loading supplier catalogue…</div>:!visible.length?<div className="workspace-empty"><ShoppingBag size={25}/><p>No {kind==="social"?"social media services":"digital accounts"} are currently published. Please check back later.</p></div>:<div className="social-service-grid">{visible.map(s=><button key={s.id} className={"social-service-card "+(selected===s.id?"selected":"")} onClick={()=>setSelected(s.id)}><span>{s.product_kind==="digital_account"?<UserRoundPlus size={18}/>:<Users size={18}/>}</span><b>{s.name}</b><small>{s.category} · {s.min_quantity.toLocaleString()}–{s.max_quantity.toLocaleString()}</small></button>)}</div>}
  </section>
  {current?<section className="workspace-panel">
   <div className="workspace-section-title"><div><h2>{current.name}</h2><p>{current.description||"Supplier service provided through Sizzle Social."}</p></div><span className="workspace-secure">Verified catalogue</span></div>
   {current.product_kind==="digital_account"?<label className="workspace-field"><span>Delivery email</span><input className="workspace-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label>:<label className="workspace-field"><span>Target profile / post URL</span><input className="workspace-input" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://instagram.com/yourprofile"/></label>}
   {current.service_type==="custom_comments"?<label className="workspace-field social-spaced"><span>Comments (one per line)</span><textarea className="workspace-input social-textarea" value={comments} onChange={e=>setComments(e.target.value)} placeholder={"Amazing!\nLove this post!"}/><small>{commentCount} comments · quantity is calculated from the number of lines.</small></label>:<label className="workspace-field social-spaced"><span>{current.product_kind==="digital_account"?"Number of accounts":"Quantity"}</span><input className="workspace-input" type="number" min={current.min_quantity} max={current.max_quantity} value={quantity} onChange={e=>setQuantity(e.target.value)}/><small>Minimum {current.min_quantity.toLocaleString()} · Maximum {current.max_quantity.toLocaleString()}</small></label>}
   {current.dripfeed_supported&&current.product_kind==="social"?<div className="social-dripfeed"><label className="workspace-field"><span>Drip-feed runs (optional)</span><input className="workspace-input" type="number" min="1" max="1000" value={runs} onChange={e=>setRuns(e.target.value)} placeholder="Leave blank for standard delivery"/></label><label className="workspace-field"><span>Interval</span><select className="workspace-input" value={interval} onChange={e=>setInterval(e.target.value)}>{[0,5,10,15,30,60,90].map(v=><option key={v} value={v}>{v===0?"No delay":v+" minutes"}</option>)}</select></label></div>:null}
   <div className="social-checkout"><div><small>Estimated total</small><strong>{money(orderTotal)}</strong><small>Based on the configured retail rate; final supplier charge may vary.</small></div><button className="workspace-primary" onClick={()=>void buy()} disabled={busy||orderTotal<=0}>{busy?"Processing…":"Place order" } <ArrowUpRight size={16}/></button></div>
  </section>:null}
  {notice?<div className="workspace-notice">{notice}</div>:null}
  <section className="workspace-panel">
   <div className="workspace-section-title"><div><h2>My social orders</h2><p>Track your purchases and request eligible refills.</p></div><span className="workspace-count">{orders.length}</span></div>
   {orders.length?<div className="workspace-list">{orders.map(o=><div className="workspace-list-row" key={o.id}><span className="workspace-list-icon">{o.product_kind==="digital_account"?<UserRoundPlus size={17}/>:<Users size={17}/>}</span><div className="workspace-list-main"><b>{o.service?.name||"Social service"} · {o.status.replaceAll("_"," ")}</b><small>{o.quantity.toLocaleString()} units · {new Date(o.created_at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"})}</small><small>{o.provider_order_ref?"Supplier order "+o.provider_order_ref:"Awaiting supplier confirmation"}</small><div className="social-order-actions"><button onClick={()=>void refreshOrder(o.id)}><RefreshCw size={13}/> Refresh status</button>{o.refill_supported&&o.provider_order_ref?<button onClick={()=>void refill(o.id)} disabled={busy}><RotateCcw size={13}/> Request refill</button>:null}</div></div><strong>{money(o.retail_amount_kobo)}</strong></div>)}</div>:<div className="workspace-empty">Your social media purchases will appear here.</div>}
  </section>
 </div>;
}
