import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
export const dynamic="force-dynamic";
export async function GET(){
 const s=await createClient();const {data:{user}}=await s.auth.getUser();
 if(!user)return NextResponse.json({error:"Sign in required."},{status:401});
 const [{data:services,error:se},{data:tiers,error:te}]=await Promise.all([
  s.from("smscode_service_catalogue").select("id,service_key,display_name,last_verified_at").eq("supported",true).eq("active",true).order("display_name"),
  s.from("smscode_product_tiers").select("id,service_id,tier_key,tier_label,country_iso2,retail_price_kobo,last_supplier_price_usd,last_inventory_count,last_verified_at").eq("active",true).not("last_verified_at","is",null).order("retail_price_kobo")
 ]);
 if(se||te)return NextResponse.json({error:"Could not load the verified service catalogue."},{status:500});
 const available=(tiers||[]).filter(t=>(t.last_inventory_count??0)>0);
 return NextResponse.json({services:services||[],tiers:available,checkedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store, max-age=0"}});
}