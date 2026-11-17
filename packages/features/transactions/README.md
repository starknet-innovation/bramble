# @bramble/transactions

Activity and transaction history, allowance discovery, route and fee checks, AVNU quote and call adaptation, Ledger call verification and explorer parsing.

- **Layer:** `features`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/transactions/activity`, `@bramble/transactions/alerts`, `@bramble/transactions/allowance-discovery`, `@bramble/transactions/allowance-scan`, `@bramble/transactions/allowance-store`, `@bramble/transactions/allowances`, `@bramble/transactions/avnu`, `@bramble/transactions/avnu-route`, `@bramble/transactions/fee-funds`, `@bramble/transactions/ledger-verify`, `@bramble/transactions/outside-execution-calls`, `@bramble/transactions/outside-execution-terms`, `@bramble/transactions/paid-recipients`, `@bramble/transactions/relay-signatures`, `@bramble/transactions/send-routes`, `@bramble/transactions/starkscan`, `@bramble/transactions/starkscan-parsers`, `@bramble/transactions/starkscan-types`, `@bramble/transactions/starkscan-wallet`, `@bramble/transactions/tx-history`, `@bramble/transactions/tx-history-scan`, `@bramble/transactions/verify`, `@bramble/transactions/verify-decode`, `@bramble/transactions/verify-selectors`.
- **Boundary:** No presentation code or Chrome APIs.

Run `bun run check` in this directory for its type check and tests.
