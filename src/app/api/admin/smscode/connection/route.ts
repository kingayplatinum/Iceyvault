import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSmscodeHealth, SmscodeError } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  if (!process.env.SMSCODE_TOKEN) return NextResponse.json({ configured: false, connected: false, message: "Add SMSCODE_TOKEN to Vercel server-side environment variables." });
  try {
    const health = await getSmscodeHealth();
    return NextResponse.json({ configured: true, connected: true, ...health });
  } catch (error) {
    const status = error instanceof SmscodeError ? error.status : 502;
    return NextResponse.json({ configured: true, connected: false, message: error instanceof Error ? error.message : "SMSCode connection failed.", supplierStatus: status }, { status: status >= 500 ? 502 : 424 });
  }
}
