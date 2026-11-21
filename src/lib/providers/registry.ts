import { MockProvider } from "./mock-provider";
import { ProviderNotConfiguredError, type ProviderAdapter, type ProviderEnvironment } from "./types";

const mockProvider = new MockProvider();

/** Supplier adapters are selected only on the server. Mock is the safe default. */
export function getProviderAdapter(code = process.env.ICEYVAULT_PROVIDER ?? "mock", environment: ProviderEnvironment = (process.env.ICEYVAULT_PROVIDER_ENV as ProviderEnvironment) ?? "mock"): ProviderAdapter {
  if (environment === "mock" && code === "mock") return mockProvider;
  throw new ProviderNotConfiguredError(code);
}

export function getMockProviderAdapter(): ProviderAdapter {
  return mockProvider;
}
