import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const secretKey = process.env.FLW_SECRET_KEY;
  const webhookSecret = process.env.FLW_WEBHOOK_SECRET_HASH;
  const missing = [
    !secretKey && "FLW_SECRET_KEY",
    !webhookSecret && "FLW_WEBHOOK_SECRET_HASH",
  ].filter(Boolean);
  const mode = secretKey?.startsWith("FLWSECK_TEST-") ? "test" : "live";

  if (missing.length) {
    return NextResponse.json({
      configured: false,
      connected: false,
      mode,
      missing,
      message: "Flutterwave Standard V3 credentials are incomplete in this environment.",
    }, { status: 503 });
  }

  try {
    // Read-only account endpoint: validates the V3 secret without initiating a charge.
    const response = await fetch("https://api.flutterwave.com/v3/balances", {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json().catch(() => ({})) as { status?: string; message?: string; data?: Array<{ currency?: string }> };

    if (!response.ok || result.status !== "success") {
      return NextResponse.json({
        configured: true,
        connected: false,
        mode,
        message: response.status === 401
          ? "Flutterwave rejected the V3 secret key. Check that the key is active and belongs to the selected Test or Live mode."
          : result.message || "Flutterwave V3 could not validate the account credentials.",
        providerStatus: response.status,
      }, { status: 502 });
    }

    return NextResponse.json({
      configured: true,
      connected: true,
      mode,
      webhookSecretConfigured: true,
      supportedCurrencies: (result.data || []).map((item) => item.currency).filter(Boolean),
      checkedAt: new Date().toISOString(),
      message: `Flutterwave Standard V3 ${mode} credentials authenticated successfully. No payment was initiated.`,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({
      configured: true,
      connected: false,
      mode,
      message: "Could not reach Flutterwave V3. Check network availability and retry.",
    }, { status: 502 });
  }
}
