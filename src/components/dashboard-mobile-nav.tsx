"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {Phone,ShoppingBag,LayoutDashboard,Wallet,Users} from "lucide-react";

const items=[
 {label:"Numbers",href:"/dashboard/catalog",Icon:Phone},
 {label:"Logs",href:"/dashboard/orders",Icon:ShoppingBag},
 {label:"Home",href:"/dashboard",Icon:LayoutDashboard},
 {label:"Wallet",href:"/dashboard/wallet",Icon:Wallet},
 {label:"Social",href:"/dashboard/social",Icon:Users},
];
export default function DashboardMobileNav(){
 const pathname=usePathname();
 return <nav className="workspace-mobile-nav" aria-label="Mobile navigation">
  {items.map(({label,href,Icon})=>{
   const active=href==="/dashboard"?pathname==="/dashboard":pathname===href||pathname.startsWith(href+"/");
   return <Link href={href} key={href} className={[active?"is-active":"",label==="Home"?"workspace-mobile-home":""].filter(Boolean).join(" ")} aria-current={active?"page":undefined}>
    {label==="Home"?<span><Icon size={22}/></span>:<Icon size={19}/>}
    {label==="Home"?<small>{label}</small>:<span>{label}</span>}
   </Link>;
  })}
 </nav>;
}
