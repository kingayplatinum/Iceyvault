import {NextResponse} from "next/server";
import {requireAdmin} from "@/lib/admin/auth";
export const dynamic="force-dynamic";
export async function GET(){
 const access=await requireAdmin();if("response" in access)return access.response;const db=access.db;
 const [customers,wallets,customerRows,orders,payments,paidTotals,products,providers,refunds,recentOrders,recentPayments,providerRows,productRows,refundRows,auditRows,syncRows]=await Promise.all([
 db.from("profiles").select("id",{count:"exact",head:true}),db.from("wallets").select("user_id,balance_kobo"),db.from("profiles").select("id,display_name,phone_e164,country_code,created_at").order("created_at",{ascending:false}).limit(100),
 db.from("orders").select("id",{count:"exact",head:true}),db.from("payment_transactions").select("id",{count:"exact",head:true}),db.from("payment_transactions").select("amount_kobo,status").eq("status","successful"),
 db.from("provider_products").select("id",{count:"exact",head:true}),db.from("providers").select("id,status"),
 db.from("refunds").select("id,status"),db.from("orders").select("id,status,retail_amount_kobo,created_at,user_id,offer_kind").order("created_at",{ascending:false}).limit(12),
 db.from("payment_transactions").select("id,status,amount_kobo,purpose,created_at,user_id,gateway_reference").order("created_at",{ascending:false}).limit(12),
 db.from("providers").select("id,code,display_name,status,supports_sms,supports_voice,supports_rentals,supports_webhooks,updated_at").order("display_name"),
 db.from("provider_products").select("id,country_name,country_iso2,service_name,service_code,channel,offer_kind,retail_amount_kobo,wholesale_amount_minor,inventory_count,verified_at,active,provider_id").order("country_name").limit(100),
 db.from("refunds").select("id,status,amount_kobo,reason,created_at,user_id,order_id").order("created_at",{ascending:false}).limit(50),
 db.from("audit_logs").select("id,actor_user_id,action,entity_type,entity_id,metadata,created_at").order("created_at",{ascending:false}).limit(50),
 db.from("provider_sync_runs").select("id,provider_id,sync_type,status,started_at,completed_at,products_seen,products_created,products_updated,products_deactivated,error_summary").order("started_at",{ascending:false}).limit(10)
 ]);
 const all=[customers,wallets,customerRows,orders,payments,paidTotals,products,providers,refunds,recentOrders,recentPayments,providerRows,productRows,refundRows,auditRows,syncRows];if(all.some(x=>x.error))return NextResponse.json({error:"Admin data unavailable. Verify deployed schema and service permissions."},{status:503});
 const totalBalance=(wallets.data??[]).reduce((s,w)=>s+Number(w.balance_kobo||0),0);
 return NextResponse.json({metrics:{customers:customers.count??0,orders:orders.count??0,payments:payments.count??0,products:products.count??0,activeProviders:(providers.data??[]).filter(p=>p.status==="active").length,walletLiabilityKobo:totalBalance,grossPaidKobo:(paidTotals.data??[]).reduce((s,p)=>s+Number(p.amount_kobo||0),0),pendingRefunds:(refunds.data??[]).filter(r=>r.status==="pending").length},customersList:(customerRows.data??[]).map(c=>({...c,walletBalanceKobo:(wallets.data??[]).find(w=>w.user_id===c.id)?.balance_kobo??0})),recentOrders:recentOrders.data??[],recentPayments:recentPayments.data??[],providers:providerRows.data??[],products:productRows.data??[],refunds:refundRows.data??[],audit:auditRows.data??[],syncRuns:syncRows.data??[]},{headers:{"Cache-Control":"private, no-store"}});
}