# @bramble/privacy

STRK20 private balances: schemas, the official SDK adapter, note discovery and proving, registration, recipient policy, preparation and proof-boundary submission.

- **Layer:** `features`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/privacy/call-set-signer`, `@bramble/privacy/config`, `@bramble/privacy/fee-bound`, `@bramble/privacy/fee-policy`, `@bramble/privacy/maturity`, `@bramble/privacy/maturity-store`, `@bramble/privacy/official-sdk-budget`, `@bramble/privacy/official-sdk-builder`, `@bramble/privacy/official-sdk-errors`, `@bramble/privacy/official-sdk-maturity`, `@bramble/privacy/official-sdk-preparation`, `@bramble/privacy/official-sdk-readiness`, `@bramble/privacy/official-sdk-results`, `@bramble/privacy/official-sdk-runtime`, `@bramble/privacy/official-sdk-service`, `@bramble/privacy/official-sdk-transfers`, `@bramble/privacy/official-sdk-values`, `@bramble/privacy/paymaster`, `@bramble/privacy/paymaster-typed-data`, `@bramble/privacy/phases`, `@bramble/privacy/relay-claim-slots`, `@bramble/privacy/service`, `@bramble/privacy/shadow-account-copy`, `@bramble/privacy/shadow-account-refusals`.
- **Boundary:** No presentation code or Chrome APIs.

Run `bun run check` in this directory for its type check and tests.
