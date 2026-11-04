# @bramble/ledger-protocol

Ledger public-key and signature types, errors, broker command codecs, and connection and signing state machines.

- **Layer:** `platform`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/ledger-protocol/broker`, `@bramble/ledger-protocol/client`, `@bramble/ledger-protocol/device-transition`, `@bramble/ledger-protocol/errors`, `@bramble/ledger-protocol/session`.
- **Boundary:** Owns no transaction authorization policy.

Run `bun run check` in this directory for its type check and tests.
