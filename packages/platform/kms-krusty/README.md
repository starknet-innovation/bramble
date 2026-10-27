# @bramble/kms-krusty

The only adapter from the vault's KMS port to the pinned Krusty WASM package. Validates every KMS input and output and fails closed.

- **Layer:** `platform`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/kms-krusty/adapter`.
- **Boundary:** Owns no account-selection, transaction, storage or UI policy.

Run `bun run check` in this directory for its type check and tests.
