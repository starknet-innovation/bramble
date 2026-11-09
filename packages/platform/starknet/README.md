# @bramble/starknet

Generic Starknet RPC transport, timeout and failover, RPC response validation, call and value serialization, fee and resource primitives, and signer adaptation.

- **Layer:** `platform`. See [Modular architecture](../../../docs/MODULAR_ARCHITECTURE.md#package-responsibilities) for what each layer may depend on.
- **Entry points:** `@bramble/starknet/account-contracts`, `@bramble/starknet/class-hash-verify`, `@bramble/starknet/declare`, `@bramble/starknet/deployment`, `@bramble/starknet/fee-bounds`, `@bramble/starknet/multisig-invoke`, `@bramble/starknet/provider`, `@bramble/starknet/rpc`, `@bramble/starknet/rpc-assets`, `@bramble/starknet/rpc-diagnostics`, `@bramble/starknet/rpc-submit`, `@bramble/starknet/rpc-transport`, `@bramble/starknet/signature-verify`, `@bramble/starknet/snip12-merkle`, `@bramble/starknet/snip12-scalars`, `@bramble/starknet/snip12-vocabulary`, `@bramble/starknet/stark-name`, `@bramble/starknet/typed-data`.
- **Boundary:** Depends on signing and domain contracts, never the concrete vault or Krusty adapter. Protocol-specific behaviour belongs to the feature packages.

Run `bun run check` in this directory for its type check and tests.
