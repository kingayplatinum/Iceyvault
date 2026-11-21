import {redirect} from "next/navigation";
import Link from "next/link";
import {createClient} from "@/lib/supabase/server";
import "./admin.css";
export const dynamic="force-dynamic";
export default async function AdminLayout({children}:{children:React.ReactNode}){
 const auth=await createClient();const {data:{user}}=await auth.auth.getUser();if(!user)redirect("/account");
 const {data:role}=await auth.from("user_roles").select("role").eq("user_id",user.id).in("role",["admin","super_admin"]).maybeSingle();if(!role)redirect("/dashboard");
 return <div className="admin-frame"><aside className="admin-sidebar"><Link href="/admin" className="admin-brand"><span>i</span> icey<b>vault</b><small>CONTROL ROOM</small></Link><div className="admin-nav-label">MANAGEMENT</div><nav><Link href="/admin">Overview</Link><a href="#customers">Customers</a><a href="#orders">Orders</a><a href="#payments">Payments</a><a href="#providers">Providers</a><a href="#catalogue">Catalogue & pricing</a><a href="#refunds">Refund review</a><a href="#audit">Audit trail</a></nav><div className="admin-sidebar-foot">● Restricted administrator area</div></aside><main className="admin-main"><header className="admin-topbar"><div>IceyVault / <b>Administration</b></div><div className="admin-user"><span>{role.role==="super_admin"?"SUPER ADMIN":"ADMIN"}</span><small>{user.email}</small><Link href="/dashboard">Customer view ↗</Link></div></header>{children}</main></div>;
}