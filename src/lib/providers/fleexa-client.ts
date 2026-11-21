const BASE_URL = process.env.FLEEXA_BASE_URL ?? "https://fleexa.com.ng/developer";

export class FleexaApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "FleexaApiError";
  }
}

export function isFleexaConfigured() {
  return Boolean(process.env.FLEEXA_API_KEY);
}

async function request<T>(path: string): Promise<T> {
  const apiKey = process.env.FLEEXA_API_KEY;
  if (!apiKey) throw new Error("FLEEXA_API_KEY is not configured on the server.");
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as
    | { success?: boolean; message?: string; error_code?: string; error?: string; data?: T }
    | null;
  if (!response.ok || payload?.success === false) {
    throw new FleexaApiError(
      payload?.message ?? payload?.error ?? `Fleexa returned HTTP ${response.status}.`,
      response.status,
      payload?.error_code,
    );
  }
  return (payload?.data ?? payload) as T;
}

/** Read-only account diagnostics. Never invokes a purchase or wallet debit. */
export async function getFleexaProfile() {
  return request<Record<string, unknown>>("/profile");
}

export async function getFleexaBalance() {
  return request<{ balance: string; bonus_balance?: string; currency: string }>("/balance");
}

/** Catalogue discovery only; quantity is indicative and stock is confirmed at purchase. */
export async function getFleexaSms4Apps() {
  return request<Array<Record<string, unknown>>>("/sms4/apps");
}

export async function getFleexaSms4Prices(serviceName: string) {
  const safeName = encodeURIComponent(serviceName);
  return request<Array<Record<string, unknown>>>(`/sms4/prices?serviceName=${safeName}`);
}
