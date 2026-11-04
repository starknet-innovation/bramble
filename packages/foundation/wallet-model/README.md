# @bramble/wallet-model

Public account, network, token, address-book, preference, passphrase-policy, Ledger-path and signing values, with their pure parsers and smart constructors.

- **Layer:** `foundation`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/wallet-model/account-families`, `@bramble/wallet-model/accounts`, `@bramble/wallet-model/avnu-route`, `@bramble/wallet-model/custom-network`, `@bramble/wallet-model/ledger-path`, `@bramble/wallet-model/networks`, `@bramble/wallet-model/nostr`, `@bramble/wallet-model/passphrase`, `@bramble/wallet-model/passphrase-strength`, `@bramble/wallet-model/preferences`, `@bramble/wallet-model/recovery`, `@bramble/wallet-model/signing`, `@bramble/wallet-model/vault-recovery`.
- **Boundary:** No persistent vault envelopes or feature-owned records. Argent multisigs never enter `AccountRef`.

Run `bun run check` in this directory for its type check and tests.
