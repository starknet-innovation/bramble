# @bramble/vault

The encrypted vault: envelopes, versioned schemas and migrations, account-secret custody, the unlock-aware vault service, origin grants and the `KmsPort` it requires.

- **Layer:** `platform`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/vault/account-secrets`, `@bramble/vault/accounts`, `@bramble/vault/encrypted-store`, `@bramble/vault/kms-port`, `@bramble/vault/migrations`, `@bramble/vault/network-account`, `@bramble/vault/origin-grants`, `@bramble/vault/reveal`, `@bramble/vault/schema`, `@bramble/vault/service`, `@bramble/vault/service-types`, `@bramble/vault/shadow-account-scopes`, `@bramble/vault/store-migration`, `@bramble/vault/strk20-viewing-key`, `@bramble/vault/vault-account`.
- **Boundary:** Privileged. Never included in page, content, UI Lab, Terminal or ordinary UI bundles.

Run `bun run check` in this directory for its type check and tests.
