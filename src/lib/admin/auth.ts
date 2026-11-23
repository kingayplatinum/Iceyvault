import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/payments/flutterwave";
export async function requireAdmin() {
 const auth=await createClient(); const {data:{user},error}=await auth.auth.getUser();
 if(error||!user)return {response:NextResponse.json({error:"Authentication required."},{status:401})} as const;
 const {data:role,error:roleError}=await auth.from("user_roles").select("role").eq("user_id",user.id).in("role",["admin","super_admin"]).maybeSingle();
 if(roleError||!role)return {response:NextResponse.json({error:"Administrator access required."},{status:403})} as const;
 try{return {user,role:role.role as "admin"|"super_admin",db:createServiceClient()} as const;}catch{return {response:NextResponse.json({error:"Admin data service is not configured. Add SUPABASE_SERVICE_ROLE_KEY to Vercel production and preview environments."},{status:503})} as const;}
}
export async function writeAdminAudit(db:ReturnType<typeof createServiceClient>,actorId:string,action:string,entityType:string,entityId:string,metadata:Record<string,unknown>={}) {
 const {error}=await db.from("audit_logs").insert({actor_user_id:actorId,action,entity_type:entityType,entity_id:entityId,metadata});
 if(error)throw new Error("Audit write failed.");
}