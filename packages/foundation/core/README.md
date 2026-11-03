# @bramble/core

Pure, environment-independent primitives: bounded JSON parsing, errors, identifiers, normalized origins, HTML text helpers, network-error classification and service URL validation.

- **Layer:** `foundation`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/core/errors`, `@bramble/core/hex`, `@bramble/core/html`, `@bramble/core/http-json`, `@bramble/core/ids`, `@bramble/core/json`, `@bramble/core/network-error`, `@bramble/core/origin`, `@bramble/core/service-url`.
- **Boundary:** No browser, DOM, storage, network, hardware, clock, entropy or third-party runtime dependency. Not a general `shared` barrel: every export needs several consumers.

Run `bun run check` in this directory for its type check and tests.
