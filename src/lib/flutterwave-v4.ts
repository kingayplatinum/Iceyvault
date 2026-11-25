type FlutterwaveEnvelope<T> = { status?: string; message?: string; data?: T; error?: { message?: string; code?: string } };

let cachedToken: { value: string; expiresAt: number } | null = null;

function getApiBase(): URL {
  const raw = process.env.FLW_API_BASE_URL;
  if (!raw) throw new Error("FLW_API_BASE_URL is not configured. Set the Flutterwave V4 API base URL for this environment.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || !["api.flutterwave.com", "developersandbox-api.flutterwave.com"].includes(url.hostname)) {
    throw new Error("FLW_API_BASE_URL must use an approved HTTPS Flutterwave API host.");
  }
  return new URL(url.pathname.endsWith("/") ? url.pathname : url.pathname + "/", url.origin);
}

export async function getFlutterwaveAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.value;
  const clientId = process.env.FLW_CLIENT_ID;
  const clientSecret = process.env.FLW_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Flutterwave V4 client credentials are not configured.");
  const response = await fetch("https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!response.ok || !body?.access_token) throw new Error("Flutterwave V4 authentication failed.");
  cachedToken = { value: body.access_token, expiresAt: now + Math.max(60, body.expires_in ?? 300) * 1000 };
  return body.access_token;
}

export async function flutterwaveV4Request<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const token = await getFlutterwaveAccessToken();
  const base = getApiBase();
  const url = new URL(path.replace(/^\/+/, ""), base);
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as FlutterwaveEnvelope<T> | null;
  if (!response.ok || payload?.status === "failed" || payload?.data === undefined) {
    const message = payload?.error?.message || payload?.message || `Flutterwave V4 request failed (${response.status}).`;
    const error = new Error(message) as Error & { status?: number; providerCode?: string };
    error.status = response.status;
    error.providerCode = payload?.error?.code;
    throw error;
  }
  return { data: payload.data, status: response.status };
}
