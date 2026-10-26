# @bramble/store

The `KeyValueStore` port, namespaced-key and JSON guards, deny-by-default storage capabilities, mutation serialization and an in-memory implementation.

- **Layer:** `platform`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/store/access`, `@bramble/store/kv`, `@bramble/store/mutation`.
- **Boundary:** Knows no wallet feature records and no Chrome API; features own their record types and repositories.

Run `bun run check` in this directory for its type check and tests.
