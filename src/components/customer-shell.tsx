"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Store, Smartphone, Wallet, MessageCircle, Bell, LifeBuoy, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import "./customer-shell.css";

const links=[
  {href:"/dashboard",label:"Overview",Icon:LayoutDashboard},
  {href:"/dashboard/catalog",label:"Browse services",Icon:Store},
  {href:"/dashboard/orders",label:"My orders",Icon:Smartphone},
  {href:"/dashboard/wallet",label:"Wallet",Icon:Wallet},
  {href:"/dashboard/messages",label:"SMS inbox",Icon:MessageCircle},
  {href:"/dashboard/notifications",label:"Notifications",Icon:Bell},
  {href:"/dashboard/support",label:"Support",Icon:LifeBuoy},
];
export default function CustomerShell({children,title}:{children:React.ReactNode;title:string}){
 const path=usePathname(); const [name,setName]=useState("Account"); const [email,setEmail]=useState("");
 useEffect(()=>{let live=true;const supabase=createClient();supabase.auth.getUser().then(async({data:{user}})=>{if(!user){window.location.assign("/account");return;}const {data:role,error}=await supabase.from("user_roles").select("role").eq("user_id",user.id).in("role",["admin","super_admin"]).maybeSingle();if(!live)return;if(!error&&role){window.location.replace("/admin");return;}setName(user.user_metadata?.name||user.email?.split("@")[0]||"Account");setEmail(user.email||"");});return()=>{live=false;};},[]);
 async function signOut(){await createClient().auth.signOut();window.location.assign("/");}
 return <main className="customer-layout"><aside className="customer-sidebar"><Link href="/" className="customer-brand"><span>i</span>icey<b>vault</b></Link><div className="customer-side-label">YOUR WORKSPACE</div><nav>{links.map(({href,label,Icon})=><Link key={href} href={href} className={path===href?"active":""}><Icon size={17}/>{label}</Link>)}</nav><div className="customer-side-bottom"><div className="customer-user"><span>{name.slice(0,1).toUpperCase()}</span><div><b>{name}</b><small>{email}</small></div></div><button onClick={signOut}><LogOut size={16}/> Sign out</button></div></aside><section className="customer-main"><header className="customer-topbar"><span>Workspace / <b>{title}</b></span><span className="customer-secure">● SECURE ACCOUNT</span></header><div className="customer-content">{children}<footer className="customer-footer">© {new Date().getFullYear()} IceyVault <span>Secure customer workspace</span></footer></div></section></main>;
}
