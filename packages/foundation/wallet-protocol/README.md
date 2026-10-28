# @bramble/wallet-protocol

The single source of truth for the dapp provider bridge: methods, events, requests, results, runtime decoders, resource budgets and method security metadata.

- **Layer:** `foundation`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/wallet-protocol/add-chain`, `@bramble/wallet-protocol/bridge`, `@bramble/wallet-protocol/declare`, `@bramble/wallet-protocol/deployment`, `@bramble/wallet-protocol/events`, `@bramble/wallet-protocol/extension-responses`, `@bramble/wallet-protocol/fee-estimate`, `@bramble/wallet-protocol/invoke`, `@bramble/wallet-protocol/invoke-limits`, `@bramble/wallet-protocol/methods`, `@bramble/wallet-protocol/privacy-blocker`, `@bramble/wallet-protocol/request-params`, `@bramble/wallet-protocol/results`, `@bramble/wallet-protocol/rpc-errors`, `@bramble/wallet-protocol/runtime-message`, `@bramble/wallet-protocol/strk20`, `@bramble/wallet-protocol/strk20-batch`, `@bramble/wallet-protocol/strk20-bridge`, `@bramble/wallet-protocol/submission-unknown`, `@bramble/wallet-protocol/typed-data-params`, `@bramble/wallet-protocol/versions`, `@bramble/wallet-protocol/watch-asset`.
- **Boundary:** Contains no handler implementation; the dapp-reachable and approval-surface method sets are derived from its registry.

Run `bun run check` in this directory for its type check and tests.
