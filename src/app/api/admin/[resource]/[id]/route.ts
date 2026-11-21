import {NextResponse} from "next/server";
import {requireAdmin,writeAdminAudit} from "@/lib/admin/auth";
export const dynamic="force-dynamic";
export async function PATCH(request:Request,{params}:{params:Promise<{resource:string;id:string}>}){
 const access=await requireAdmin();if("response" in access)return access.response;const {resource,id}=await params;
 if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:"Invalid record ID."},{status:400});
 const body=await request.json().catch(()=>null) as Record<string,unknown>|null;if(!body)return NextResponse.json({error:"Invalid update."},{status:400});
 const {db,user,role}=access;
 if(resource==="providers"){
  if(role!=="super_admin")return NextResponse.json({error:"Only a super administrator may change supplier operating status."},{status:403});
  if(typeof body.status!=="string"||!["draft","testing","active","suspended","retired"].includes(body.status))return NextResponse.json({error:"Unsupported provider status."},{status:400});
  const {data:before}=await db.from("providers").select("id,status").eq("id",id).maybeSingle();if(!before)return NextResponse.json({error:"Provider not found."},{status:404});
  try{await writeAdminAudit(db,user.id,"provider.status_changed","provider",id,{from:before.status,to:body.status});}catch{return NextResponse.json({error:"Audit write failed; no change made."},{status:503});}
  const {error}=await db.from("providers").update({status:body.status}).eq("id",id);if(error)return NextResponse.json({error:"Provider update failed."},{status:500});return NextResponse.json({ok:true});
 }
 if(resource==="products"){
  const update:Record<string,unknown>={};if(typeof body.active==="boolean")update.active=body.active;
  if(body.retail_amount_kobo!==undefined){const n=Number(body.retail_amount_kobo);if(!Number.isSafeInteger(n)||n<1||n>100000000)return NextResponse.json({error:"Retail price must be a valid whole-kobo amount."},{status:400});update.retail_amount_kobo=n;}
  if(!Object.keys(update).length||Object.keys(body).some(k=>!["active","retail_amount_kobo"].includes(k)))return NextResponse.json({error:"Only retail price and visibility can be changed."},{status:400});
  const {data:before}=await db.from("provider_products").select("id,active,retail_amount_kobo").eq("id",id).maybeSingle();if(!before)return NextResponse.json({error:"Product not found."},{status:404});
  try{await writeAdminAudit(db,user.id,"catalogue.product_updated","provider_product",id,{before,after:update});}catch{return NextResponse.json({error:"Audit write failed; no change made."},{status:503});}
  const {error}=await db.from("provider_products").update(update).eq("id",id);if(error)return NextResponse.json({error:"Product update failed."},{status:500});return NextResponse.json({ok:true});
 }
 return NextResponse.json({error:"This resource is read-only in this release."},{status:405});
}