# Phase 5 — Admin dashboard

## Implemented
- Restricted admin workspace at /admin; server-side role checks for admin and super_admin.
- Server-only admin API; service-role credentials never reach the browser.
- Overview metrics for customer profiles, orders, payment records, providers, catalogue, wallet liability and pending refunds.
- Read-only order, payment, refund and audit views.
- Supplier sync history.
- Super-admin-only provider status control.
- Catalogue retail-price and active-visibility controls.
- Audit records for administrative changes.

## Safety boundaries
- No direct wallet balance edits, payment status edits, payment reversals, refunds, customer role changes or live supplier purchases.
- Those operations need purpose-built transactional and idempotent workflows.
- No admin roles currently exist in the connected database. A verified owner must provision the first super_admin out of band. This implementation does not promote any user.
- Validate deployed provider enum values before changing provider status.
