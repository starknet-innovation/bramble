# @bramble/wallet-ui

Production side-panel views, typed runtime clients, controllers, transitions and styles, shared with UI Lab.

- **Layer:** `presentation`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/wallet-ui/lab`, `@bramble/wallet-ui/start`.
- **Boundary:** Never reads Chrome storage or imports vault, KMS, RPC submission or hardware transport implementations; the extension injects the Chrome runtime and Ledger capability.

Run `bun run check` in this directory for its type check and tests.
