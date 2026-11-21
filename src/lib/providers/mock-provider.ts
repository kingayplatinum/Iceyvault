import type { ProviderAdapter, ProviderProduct, ProviderQuote, ProvisionRequest, ProvisionResult } from "./types";

const catalogue: ProviderProduct[] = [
  { externalProductId: "mock-us-whatsapp", countryIso2: "US", countryName: "United States", serviceCode: "whatsapp", serviceName: "WhatsApp", channel: "sms", offerKind: "sms_activation", numberClass: "standard", currency: "USD", wholesaleAmountMinor: 18, inventoryCount: 12, metadata: { source: "mock", fixture: true } },
  { externalProductId: "mock-gb-whatsapp", countryIso2: "GB", countryName: "United Kingdom", serviceCode: "whatsapp", serviceName: "WhatsApp", channel: "sms", offerKind: "sms_activation", numberClass: "standard", currency: "USD", wholesaleAmountMinor: 22, inventoryCount: 7, metadata: { source: "mock", fixture: true } },
  { externalProductId: "mock-us-telegram", countryIso2: "US", countryName: "United States", serviceCode: "telegram", serviceName: "Telegram", channel: "sms", offerKind: "sms_activation", numberClass: "standard", currency: "USD", wholesaleAmountMinor: 20, inventoryCount: 0, metadata: { source: "mock", fixture: true } },
];

export class MockProvider implements ProviderAdapter {
  readonly code = "mock";
  readonly displayName = "IceyVault Mock Supplier";
  readonly capabilities = ["sms", "rentals", "webhooks"] as const;

  async healthCheck() { return { ok: true, checkedAt: new Date().toISOString(), message: "Mock adapter ready; no external supplier is contacted." }; }
  async listProducts() { return catalogue.map((item) => structuredClone(item)); }
  async quote(product: ProviderProduct): Promise<ProviderQuote> {
    const current = catalogue.find((item) => item.externalProductId === product.externalProductId);
    return { product, available: Boolean(current && (current.inventoryCount ?? 0) > 0), checkedAt: new Date().toISOString(), wholesaleAmountMinor: current?.wholesaleAmountMinor ?? null, providerReference: current?.externalProductId };
  }
  async provision(request: ProvisionRequest): Promise<ProvisionResult> {
    const quote = await this.quote(request.product);
    if (!quote.available) return { providerOrderReference: `mock-failed-${request.orderId}`, status: "failed", metadata: { reason: "mock_inventory_unavailable", simulated: true } };
    return { providerOrderReference: `mock-${request.idempotencyKey}`, status: "active", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), metadata: { simulated: true, note: "No real number was purchased or reserved." } };
  }
  async getOrder(providerOrderReference: string): Promise<ProvisionResult> {
    return { providerOrderReference, status: providerOrderReference.includes("failed") ? "failed" : "active", metadata: { simulated: true } };
  }
}
