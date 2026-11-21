import { createClient } from "@supabase/supabase-js";

const FLW_API = "https://api.flutterwave.com/v3";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server-side Supabase service credentials are not configured.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function flutterwaveRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.FLW_SECRET_KEY;
  if (!key) throw new Error("FLW_SECRET_KEY is not configured on the server.");
  const response = await fetch(`${FLW_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as T & { status?: string; message?: string } | null;
  if (!response.ok || payload?.status !== "success") {
    throw new Error(payload?.message ?? `Flutterwave request failed with HTTP ${response.status}.`);
  }
  return payload as T;
}

export async function verifyFlutterwaveTransaction(transactionId: string) {
  if (!/^\d+$/.test(transactionId)) throw new Error("Invalid Flutterwave transaction ID.");
  return flutterwaveRequest<{status:string;data:{id:number;tx_ref:string;amount:number;currency:string;status:string;charged_amount?:number;customer?:{email?:string}}}>(`/transactions/${transactionId}/verify`);
}
