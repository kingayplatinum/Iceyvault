const BASE_URL = "https://app.sizzlesocial.ng/api/v1";

export class SizzleError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "SizzleError";
  }
}

type SizzleEnvelope = { error?: string; message?: string; status?: string };

export async function sizzleRequest<T>(params: Record<string, string | number>): Promise<T> {
  const key = process.env.SIZZLE_API_KEY;
  if (!key) throw new SizzleError("Sizzle Social is not configured. Add SIZZLE_API_KEY to the server environment.", 503, "NOT_CONFIGURED");
  const body = new URLSearchParams({ key, ...Object.fromEntries(Object.entries(params).map(([k,v]) => [k, String(v)])) });
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new SizzleError("Sizzle Social returned an invalid response.", response.status || 502, "INVALID_RESPONSE"); }
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : (payload as SizzleEnvelope)?.error || (payload as SizzleEnvelope)?.message;
    throw new SizzleError(message || "Sizzle Social request failed.", response.status, "HTTP_ERROR");
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as SizzleEnvelope;
    if (p.status === "error" || p.error) throw new SizzleError(p.error || p.message || "Sizzle Social rejected the request.", 502, "SUPPLIER_ERROR");
  }
  return payload as T;
}

export type SizzleService = {
  service: string;
  name: string;
  category: string;
  rate: string;
  min: string;
  max: string;
  type: string;
  desc?: string;
  dripfeed?: string;
  refill?: string;
};

export async function getSizzleHealth() {
  const [balance, services] = await Promise.all([
    sizzleRequest<{ status: string; balance: string; currency: string }>({ action: "balance" }),
    sizzleRequest<SizzleService[]>({ action: "services" }),
  ]);
  return { balance: balance.balance, currency: balance.currency, serviceCount: Array.isArray(services) ? services.length : 0 };
}
