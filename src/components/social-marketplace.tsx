"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, RefreshCw, ShoppingBag, Users, UserRoundPlus, RotateCcw, Search, Instagram, Facebook, Youtube, Music2, MessageCircle, Globe2 } from "lucide-react";

type Service = { id:string; name:string; category:string; service_type:string; product_kind:"social"|"digital_account"; description:string|null; min_quantity:number; max_quantity:number; retail_rate_per_1000_kobo:number; dripfeed_supported:boolean; refill_supported:boolean };
type Order = { id:string; product_kind:string; status:string; quantity:number; retail_amount_kobo:number; provider_order_ref:string|null; created_at:string; remains:number|null; start_count:number|null; service:{name:string;category:string}|null; refill_supported:boolean };
type Group = { id:string; label:string; count:number };
const money=(v:number)=>"₦"+(v/100).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2});
const platformFor=(service:Service)=>{
 const value=(service.name+" "+service.category+" "+(service.description||"")).toLowerCase();
 if(/instagram|\binsta\b/.test(value))return "Instagram";
 if(/facebook|\bfb\b/.test(value))return "Facebook";
 if(/tiktok|tik tok/.test(value))return "TikTok";
 if(/youtube|\byoutube\b/.test(value))return "YouTube";
 if(/twitter|\bx\.com|\btwitter\b/.test(value))return "X / Twitter";
 if(/telegram/.test(value))return "Telegram";
 if(/whatsapp/.test(value))return "WhatsApp";
 if(/discord/.test(value))return "Discord";
 if(/spotify/.test(value))return "Spotify";
 if(/linkedin/.test(value))return "LinkedIn";
 if(/threads/.test(value))return "Threads";
 if(/pinterest/.test(value))return "Pinterest";
 if(/snapchat/.test(value))return "Snapchat";
 if(/twitch/.test(value))return "Twitch";
 if(/soundcloud/.test(value))return "SoundCloud";
 return "Other services";
};
const PlatformIcon=({name}:{name:string})=>{
 const props={size:17,strokeWidth:1.8};
 if(name==="Instagram")return <Instagram {...props}/>;
 if(name==="Facebook")return <Facebook {...props}/>;
 if(name==="YouTube")return <Youtube {...props}/>;
 if(name==="TikTok")return <Music2 {...props}/>;
 if(name==="Telegram"||name==="WhatsApp")return <MessageCircle {...props}/>;
 return <Globe2 {...props}/>;
};
export default function SocialMarketplace(){
 const [services,setServices]=useState<Service[]>([]),[orders,setOrders]=useState<Order[]>([]);
 const [kind,setKind]=useState<"social"|"digital_account">("social"),[group,setGroup]=useState("all"),[search,setSearch]=useState(""),[selected,setSelected]=useState("");
 const [quantity,setQuantity]=useState("1000"),[link,setLink]=useState(""),[email,setEmail]=useState(""),[comments,setComments]=useState("");
 const [runs,setRuns]=useState(""),[interval,setInterval]=useState("0");
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState("");
 const current=services.find(s=>s.id===selected)||null;
 const groups=useMemo<Group[]>(()=>{
  const counts=new Map<string,number>();
  services.filter(s=>s.product_kind===kind).forEach(s=>{const label=kind==="digital_account"?"Digital accounts":platformFor(s);counts.set(label,(counts.get(label)||0)+1);});
  return Array.from(counts,([label,count])=>({id:label,label,count})).sort((a,b)=>a.label.localeCompare(b.label));
 },[services,kind]);
 const visible=useMemo(()=>services.filter(s=>{
  if(s.product_kind!==kind)return false;
  const platform=kind==="digital_account"?"Digital accounts":platformFor(s);
  if(group!=="all"&&platform!==group)return false;
  const q=search.trim().toLowerCase();
  return !q||(s.name+" "+s.category+" "+(s.description||"")).toLowerCase().includes(q);
 }),[services,kind,group,search]);
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
 useEffect(()=>{const first=visible[0];if(!visible.some(s=>s.id===selected))setSelected(first?.id||"");},[kind,group,search,services]);
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
   setNotice(j.message||"Your order has been submitted. Check My orders for updates.");
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
  setBusy(true);try{const r=await fetch("/api/account/social/orders/"+id+"/refill",{method:"POST"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Refill request failed.");setNotice("Refill request "+j.refillId+" was submitted.");}catch(e){setNotice(e instanceof Error?e.message:"Refill request failed.");}finally{setBusy(false);}
 }
 return <div className="social-market">
  <header className="workspace-page-heading"><div><span className="workspace-eyebrow">SOCIAL MARKETPLACE</span><h1>Social media services</h1><p>Find the right service by platform, compare options and order in a few steps.</p></div><button className="workspace-quiet-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={15} className={loading?"workspace-spin":""}/> Refresh</button></header>
  <div className="social-kind-tabs"><button className={kind==="social"?"selected":""} onClick={()=>{setKind("social");setGroup("all");setSearch("");}}><Users size={17}/> Social media</button><button className={kind==="digital_account"?"selected":""} onClick={()=>{setKind("digital_account");setGroup("all");setSearch("");}}><UserRoundPlus size={17}/> Digital accounts</button></div>
  <section className="workspace-panel social-catalogue-panel">
   <div className="workspace-section-title"><div><h2>{kind==="social"?"Explore by platform":"Browse digital accounts"}</h2><p>Live Sizzle catalogue · all displayed prices include IceyVault’s 50% markup.</p></div><span className="workspace-count">{visible.length} products</span></div>
   <label className="social-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={kind==="social"?"Search Instagram followers, Facebook likes, TikTok views…":"Search digital accounts…"}/>{search?<button onClick={()=>setSearch("")} aria-label="Clear search">×</button>:null}</label>
   {kind==="social"&&groups.length>1?<div className="social-platform-groups"><button className={group==="all"?"selected":""} onClick={()=>setGroup("all")}><Globe2 size={16}/><span>All platforms</span><small>{services.filter(s=>s.product_kind==="social").length}</small></button>{groups.map(g=><button key={g.id} className={group===g.id?"selected":""} onClick={()=>setGroup(g.id)}><PlatformIcon name={g.label}/><span>{g.label}</span><small>{g.count}</small></button>)}</div>:null}
   {loading?<div className="workspace-empty">Loading the live supplier catalogue…</div>:!visible.length?<div className="workspace-empty"><ShoppingBag size={25}/><p>{search?"No products match your search. Try another keyword or platform.":"No products are currently available in this group."}</p></div>:<div className="social-service-grid">{visible.map(s=><button type="button" key={s.id} className={"social-service-card "+(selected===s.id?"selected":"")} onClick={()=>setSelected(s.id)}><span className="social-service-icon">{kind==="digital_account"?<UserRoundPlus size={18}/>:<PlatformIcon name={platformFor(s)}/>}</span><span className="social-service-platform">{kind==="digital_account"?"Digital account":platformFor(s)}</span><b>{s.name}</b><small>{s.min_quantity.toLocaleString()}–{s.max_quantity.toLocaleString()} {kind==="digital_account"?"accounts":"units"}</small><strong>{money(Math.ceil(s.retail_rate_per_1000_kobo/1000))}<small>{kind==="digital_account"?" / account":" / unit"}</small></strong></button>)}</div>}
  </section>
  {current?<section className="workspace-panel social-order-panel">
   <div className="workspace-section-title"><div><span className="workspace-eyebrow">ORDER DETAILS</span><h2>{current.name}</h2><p>{current.description||"Supplier service provided through Sizzle Social."}</p></div><span className="workspace-secure">Live service</span></div>
   {current.product_kind==="digital_account"?<label className="workspace-field"><span>Delivery email</span><input className="workspace-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label>:<label className="workspace-field"><span>Target profile / post URL</span><input className="workspace-input" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://instagram.com/yourprofile"/></label>}
   {current.service_type==="custom_comments"?<label className="workspace-field social-spaced"><span>Comments (one per line)</span><textarea className="workspace-input social-textarea" value={comments} onChange={e=>setComments(e.target.value)} placeholder={"Amazing!\nLove this post!"}/><small>{commentCount} comments · quantity is calculated from the number of lines.</small></label>:<label className="workspace-field social-spaced"><span>{current.product_kind==="digital_account"?"Number of accounts":"Quantity"}</span><input className="workspace-input" type="number" min={current.min_quantity} max={current.max_quantity} value={quantity} onChange={e=>setQuantity(e.target.value)}/><small>Minimum {current.min_quantity.toLocaleString()} · Maximum {current.max_quantity.toLocaleString()}</small></label>}
   {current.dripfeed_supported&&current.product_kind==="social"?<div className="social-dripfeed"><label className="workspace-field"><span>Drip-feed runs (optional)</span><input className="workspace-input" type="number" min="1" max="1000" value={runs} onChange={e=>setRuns(e.target.value)} placeholder="Leave blank for standard delivery"/></label><label className="workspace-field"><span>Interval</span><select className="workspace-input" value={interval} onChange={e=>setInterval(e.target.value)}>{[0,5,10,15,30,60,90].map(v=><option key={v} value={v}>{v===0?"No delay":v+" minutes"}</option>)}</select></label></div>:null}
   <div className="social-checkout"><div><small>Estimated total</small><strong>{money(orderTotal)}</strong><small>Final amount is confirmed before your wallet is charged.</small></div><button className="workspace-primary" onClick={()=>void buy()} disabled={busy||orderTotal<=0}>{busy?"Processing…":"Place order"} <ArrowUpRight size={16}/></button></div>
  </section>:null}
  {notice?<div className="workspace-notice" role="status">{notice}</div>:null}
  <section className="workspace-panel">
   <div className="workspace-section-title"><div><h2>My social orders</h2><p>Track your purchases and request eligible refills.</p></div><span className="workspace-count">{orders.length}</span></div>
   {orders.length?<div className="workspace-list">{orders.map(o=><div className="workspace-list-row" key={o.id}><span className="workspace-list-icon">{o.product_kind==="digital_account"?<UserRoundPlus size={17}/>:<Users size={17}/>}</span><div className="workspace-list-main"><b>{o.service?.name||"Social service"} · {o.status.replaceAll("_"," ")}</b><small>{o.quantity.toLocaleString()} units · {new Date(o.created_at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"})}</small><small>{o.provider_order_ref?"Supplier order "+o.provider_order_ref:"Awaiting supplier confirmation"}</small><div className="social-order-actions"><button onClick={()=>void refreshOrder(o.id)}><RefreshCw size={13}/> Refresh status</button>{o.refill_supported&&o.provider_order_ref?<button onClick={()=>void refill(o.id)} disabled={busy}><RotateCcw size={13}/> Request refill</button>:null}</div></div><strong>{money(o.retail_amount_kobo)}</strong></div>)}</div>:<div className="workspace-empty">Your social media purchases will appear here.</div>}
  </section>
 </div>;
}
