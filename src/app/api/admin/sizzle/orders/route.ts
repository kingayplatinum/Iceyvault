import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;
  const status = request.nextUrl.searchParams.get("status");
  let query = admin.service.from("sizzle_orders")
    .select("id,user_id,service_id,provider_order_ref,product_kind,status,quantity,retail_amount_kobo,destination_email,target_link,created_at,updated_at")
    .order("created_at",{ascending:false}).limit(100);
  if (status) query = query.eq("status",status);
  const { data, error } = await query;
  if (error) return NextResponse.json({error:"Could not load Sizzle order records."},{status:500});
  const serviceIds=[...new Set((data??[]).map(x=>x.service_id))];
  const userIds=[...new Set((data??[]).map(x=>x.user_id))];
  const [services,profiles]=await Promise.all([
    serviceIds.length?admin.service.from("sizzle_services").select("id,name,category").in("id",serviceIds):Promise.resolve({data:[]}),
    userIds.length?admin.service.from("profiles").select("id,display_name").in("id",userIds):Promise.resolve({data:[]})
  ]);
  const serviceMap=new Map((services.data??[]).map(x=>[x.id,x]));
  const profileMap=new Map((profiles.data??[]).map(x=>[x.id,x]));
  return NextResponse.json({orders:(data??[]).map(x=>({...x,service:serviceMap.get(x.service_id)??null,customer:profileMap.get(x.user_id)??null}))},{headers:{"Cache-Control":"no-store"}});
}
