import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createServiceClient} from "@/lib/payments/flutterwave";
export const dynamic="force-dynamic";
export async function GET(){
 const auth=await createClient();
 const {data:{user},error}=await auth.auth.getUser();
 if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401});
 const {data:role,error:roleError}=await createServiceClient().from("user_roles").select("role").eq("user_id",user.id).in("role",["admin","super_admin"]).maybeSingle();
 if(roleError)return NextResponse.json({error:"Workspace could not be verified."},{status:503});
 return NextResponse.json({role:role?.role??null},{headers:{"Cache-Control":"private, no-store"}});
}