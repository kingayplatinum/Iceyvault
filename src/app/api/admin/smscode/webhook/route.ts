import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { smscodeRequest } from "@/lib/smscode/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const token = process.env.SMSCODE_TOKEN;
  const secret = process.env.SMSCODE_WEBHOOK_SECRET;
  if (!token || !secret) {
    return NextResponse.json({ error: "SMSCODE_TOKEN and SMSCODE_WEBHOOK_SECRET must be configured in Vercel before enabling supplier webhooks." }, { status: 503 });
  }
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://iceyvault.vercel.app";
  const webhookUrl = new URL("/api/webhooks/smscode", origin).toString();
  try {
    const result = await smscodeRequest<{ webhook_url: string } & Record<string, unknown>>("/webhook", {
      method: "PATCH",
      body: JSON.stringify({ webhook_url: webhookUrl, webhook_secret: secret }),
    });
    await auth.service.from("audit_logs").insert({
      actor_user_id: auth.user.id,
      action: "smscode_webhook_configured",
      entity_type: "provider",
      metadata: { webhook_url: webhookUrl },
    });
    return NextResponse.json({ configured: true, webhookUrl: result.data.webhook_url || webhookUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not configure SMSCode webhook." }, { status: 502 });
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  if (!process.env.SMSCODE_TOKEN) return NextResponse.json({ configured: false });
  try {
    const result = await smscodeRequest<{ webhook_url?: string }>("/webhook");
    return NextResponse.json({ configured: Boolean(result.data.webhook_url), webhookUrl: result.data.webhook_url || null });
  } catch {
    return NextResponse.json({ configured: false, error: "Could not read supplier webhook configuration." }, { status: 502 });
  }
}
