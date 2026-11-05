# @bramble/qsb

Quantum Safe Bitcoin vault deposits: the QSB coordinator protocol (sign-in challenge check, strict response parsing, the fetch-boundary client and its in-memory session tokens), the vault configuration fingerprint, and the deposit's fee math, coin selection, PSBT build, post-sign verification and reuse scan.

- **Layer:** `features`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/qsb/challenge`, `@bramble/qsb/client`, `@bramble/qsb/coins`, `@bramble/qsb/configuration`, `@bramble/qsb/fees`, `@bramble/qsb/instant`, `@bramble/qsb/origin`, `@bramble/qsb/psbt`, `@bramble/qsb/registration`, `@bramble/qsb/responses`, `@bramble/qsb/reuse`, `@bramble/qsb/sessions`, `@bramble/qsb/transactions`, `@bramble/qsb/vault-responses`.
- **Boundary:** No presentation code or Chrome APIs, and no key: Krusty signs, through the vault service, and nothing here calls `@scure/btc-signer`'s signing. `fetch` and the clock are injected; everything else is pure. Coordinator answers are untrusted and parsed strictly.

Run `bun run check` in this directory for its type check and tests.
