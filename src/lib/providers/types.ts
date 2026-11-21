export type OfferKind = "sms_activation" | "private_rental" | "business_line";
export type ProviderEnvironment = "mock" | "test" | "live";
export type ProviderCapability = "sms" | "voice" | "rentals" | "webhooks";

export interface ProviderProduct {
  externalProductId: string;
  countryIso2: string;
  countryName: string;
  serviceCode: string;
  serviceName: string;
  channel: string;
  offerKind: OfferKind;
  numberClass?: string | null;
  termMinutes?: number | null;
  currency: string;
  wholesaleAmountMinor: number | null;
  inventoryCount: number | null;
  metadata: Record<string, unknown>;
}

export interface ProviderQuote {
  product: ProviderProduct;
  available: boolean;
  checkedAt: string;
  wholesaleAmountMinor: number | null;
  providerReference?: string;
}

export interface ProvisionRequest {
  product: ProviderProduct;
  orderId: string;
  idempotencyKey: string;
}

export interface ProvisionResult {
  providerOrderReference: string;
  status: "pending" | "active" | "failed";
  expiresAt?: string | null;
  metadata: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly capabilities: readonly ProviderCapability[];
  healthCheck(): Promise<{ ok: boolean; checkedAt: string; message?: string }>;
  listProducts(): Promise<ProviderProduct[]>;
  quote(product: ProviderProduct): Promise<ProviderQuote>;
  provision(request: ProvisionRequest): Promise<ProvisionResult>;
  getOrder(providerOrderReference: string): Promise<ProvisionResult>;
  cancel?(providerOrderReference: string): Promise<void>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Provider "${provider}" is not configured. Live supplier credentials are required before provisioning.`);
    this.name = "ProviderNotConfiguredError";
  }
}
