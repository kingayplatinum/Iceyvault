const BASE_URL = "https://api.smscode.gg/v2";

export class SmscodeError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "SmscodeError";
  }
}

export async function smscodeRequest<T>(path: string, init: RequestInit = {}): Promise<{ data: T; meta?: unknown }> {
  const token = process.env.SMSCODE_TOKEN;
  if (!token) throw new SmscodeError("SMSCode is not configured.", 503, "NOT_CONFIGURED");
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as {
    success?: boolean; data?: T; meta?: unknown; error?: { code?: string; message?: string };
  } | null;
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new SmscodeError(payload?.error?.message ?? "SMSCode request failed.", response.status, payload?.error?.code);
  }
  return { data: payload.data, meta: payload.meta };
}

export async function getSmscodeHealth() {
  const [balance, services] = await Promise.all([
    smscodeRequest<{ balance: { amount: string; currency: string; canonical_amount: number; canonical_currency: string } }>("/balance"),
    smscodeRequest<unknown[]>("/catalog/services"),
  ]);
  return {
    balance: balance.data.balance,
    sampleServiceCount: services.data.length,
    fx: balance.meta ?? null,
  };
}
