import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const clientId = process.env.FLW_CLIENT_ID;
  const clientSecret = process.env.FLW_CLIENT_SECRET;
  const webhookSecret = process.env.FLW_WEBHOOK_SECRET_HASH;\n  const apiBase = process.env.FLW_API_BASE_URL;
  const missing = [
    !clientId && "FLW_CLIENT_ID",
    !clientSecret && "FLW_CLIENT_SECRET",
    !webhookSecret && "FLW_WEBHOOK_SECRET_HASH",
    !apiBase && "FLW_API_BASE_URL",
  ].filter(Boolean);

  if (missing.length) {
    return NextResponse.json({
      configured: false,
      connected: false,
      mode: "live",
      missing,
      message: "Flutterwave V4 Live credentials or API endpoint are incomplete in this environment.",
    }, { status: 503 });
  }

  try {
    const response = await fetch(
      "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          grant_type: "client_credentials",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      return NextResponse.json({
        configured: true,
        connected: false,
        mode: "live",
        message: "Flutterwave did not issue an access token. Check that the Live Client ID and Client Secret belong to the same active V4 credential set.",
        providerStatus: response.status,
        providerError: result.error_description || result.error || undefined,
      }, { status: 502 });
    }

    return NextResponse.json({
      configured: true,
      connected: true,
      mode: "live",
      tokenType: result.token_type || "Bearer",
      expiresIn: result.expires_in || null,
      webhookSecretConfigured: true,
      checkedAt: new Date().toISOString(),
      message: "Flutterwave Live OAuth authentication succeeded. No payment has been initiated.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({
      configured: true,
      connected: false,
      mode: "live",
      message: "Could not reach Flutterwave authentication. Check network availability and retry.",
    }, { status: 502 });
  }
}
