import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSizzleHealth, SizzleError } from "@/lib/sizzle/client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;
  if (!process.env.SIZZLE_API_KEY) return NextResponse.json({ configured: false, connected: false, message: "Add SIZZLE_API_KEY to Vercel server-side environment variables." });
  try { return NextResponse.json({ configured: true, connected: true, ...(await getSizzleHealth()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const status = error instanceof SizzleError ? error.status : 502;
    return NextResponse.json({ configured: true, connected: false, message: error instanceof Error ? error.message : "Sizzle connection failed.", supplierStatus: status }, { status: status >= 500 ? 502 : 424 });
  }
}
