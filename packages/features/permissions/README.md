# @bramble/permissions

Phishing and blocklist decisions, the live phishing feed and its cache, and the history of origins a user has connected.

- **Layer:** `features`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/permissions/blocklist`, `@bramble/permissions/origin-history`, `@bramble/permissions/phishing-feed`, `@bramble/permissions/phishing-feed-cache`.
- **Boundary:** No presentation code or Chrome APIs; the background wires storage and fetch.

Run `bun run check` in this directory for its type check and tests.
