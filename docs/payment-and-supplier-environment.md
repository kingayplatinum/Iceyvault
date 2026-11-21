# Payment and supplier environment configuration

All secrets are server-only. Never prefix them with NEXT_PUBLIC_, put them in source control, or send them from browser code.

## Required before Flutterwave test payments

- `FLW_SECRET_KEY`: Flutterwave secret key (use test-mode credentials first).
- `FLW_WEBHOOK_SECRET_HASH`: webhook secret hash configured in Flutterwave dashboard.
- `ICEYVAULT_APP_URL`: canonical HTTPS application origin. Set this after the custom domain is connected; until then the request origin is used for previews.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service-role key for trusted payment settlement and order operations.

Webhook endpoint:
`/api/payments/flutterwave/webhook`

Flutterwave callback:
`/api/payments/flutterwave/callback`

## Fleexa

- `FLEEXA_API_KEY`: Fleexa developer API secret.
- `FLEEXA_BASE_URL`: optional; defaults to `https://fleexa.com.ng/developer`.

Fleexa API pricing is returned in NGN and represents the API/reseller price. Do not apply USD FX conversion to those prices. The supplier wallet is separately funded by IceyVault. See https://fleexa.com.ng/docs and https://fleexa.com.ng/docs/guidelines-transactions.

## Checkout and settlement behavior

- Customer wallet funding is optional; direct order payment and wallet funding are separate payment purposes.
- Checkout amounts are sourced from server-side wallet top-up validation or an existing customer-owned pending order. The browser cannot set an order's price.
- Payment references are generated server-side.
- Redirects and webhooks both verify the transaction with Flutterwave before settlement.
- The settlement RPC requires exact NGN amount and currency match, is service-role-only, and is idempotent.
- Wallet credits use the expected amount from the database, not a value supplied by the browser.
- Direct order payments mark the order paid; supplier provisioning remains a separate trusted workflow and is not yet enabled by this PR.
- Never expose service-role or payment/supplier secrets to the client.
