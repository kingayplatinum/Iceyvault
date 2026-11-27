import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sizzleRequest } from "@/lib/sizzle/client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({error:"Sign in required."},{status:401});
  const {id}=await context.params;
  const service=createServiceClient();
  const {data:order}=await service.from("sizzle_orders").select("id,user_id,metadata").eq("id",id).eq("user_id",user.id).maybeSingle();
  if(!order)return NextResponse.json({error:"Order not found."},{status:404});
  const refillId=(order.metadata as Record<string,unknown>|null)?.refill_id;
  if(!refillId)return NextResponse.json({error:"No refill request is recorded for this order."},{status:404});
  try{
    const result=await sizzleRequest<{status?:string;message?:string}>({action:"refill_status",refill:String(refillId)});
    const metadata={...(order.metadata as Record<string,unknown>),refill_status:result.status??"unknown",refill_checked_at:new Date().toISOString()};
    await service.from("sizzle_orders").update({metadata,updated_at:new Date().toISOString()}).eq("id",id);
    return NextResponse.json({refillId,status:result.status??"unknown",message:result.message??null});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not refresh refill status."},{status:502});}
}
