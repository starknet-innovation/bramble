# @bramble/ledger-browser

The pinned Ledger dependencies and browser transports (WebHID, WebUSB, WebBLE), the Buffer boundary and device lifecycle.

- **Layer:** `platform`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/ledger-browser/broker-server`, `@bramble/ledger-browser/connector`, `@bramble/ledger-browser/grant-session`, `@bramble/ledger-browser/grant-transport`, `@bramble/ledger-browser/grant-window`, `@bramble/ledger-browser/transport`, `@bramble/ledger-browser/webhid`.
- **Boundary:** Owns no transaction authorization policy.

Run `bun run check` in this directory for its type check and tests.
