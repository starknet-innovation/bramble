# @bramble/multisig

Argent multisig: pinned configuration reads, deployment construction, exact-hash signing-intent validation, signature collection and public repository persistence.

- **Layer:** `features`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/multisig/chain`, `@bramble/multisig/coordination`, `@bramble/multisig/deploy`, `@bramble/multisig/repository`, `@bramble/multisig/signer-account`.
- **Boundary:** No presentation code or Chrome APIs. Multisigs stay out of `AccountRef`.

Run `bun run check` in this directory for its type check and tests.
