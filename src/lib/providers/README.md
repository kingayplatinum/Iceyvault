# IceyVault supplier engine (Phase 3)

- Provider adapters normalize supplier catalogues, quotes, provisioning, order lookups and health checks.
- The mock adapter is deterministic and safe for development. Its products are fixtures only and must never be presented as live inventory.
- The registry defaults to mock mode. Any non-mock selection fails closed until a real adapter and server-side credentials are deliberately configured.
- Currency conversion requires an explicit verified FX rate; the pricing helper does not fetch or invent exchange rates.
- Customer catalogue API reads only active rows protected by the existing public-active RLS policy.
- Supplier sync and provisioning must execute in trusted server code with a service-role client, strict role checks, idempotency, and audit logging. Never expose supplier credentials or service-role keys to browser code.
- Do not debit wallets from browser calls. A future order orchestration service must authorize the order, reserve inventory, debit atomically, provision idempotently, and refund/reconcile failures.
