# Vendor-import dataset tooling (working copies)

Operational scripts for building the mainnet vendor-import dataset described in
`docs/VENDOR_IMPORT_DATASET.md`, checkpointed here for durability. They are not
yet wired into the workspace or its gates: they run from a standalone Bun
project with pinned `starknet`, `@scure/bip32`, `@scure/bip39`,
`@scure/starknet` (see each file's imports), and read seeds from
`.env.vendor-seeds.local` at run time — seeds are never stored in this repo.
`manifest.json` is the dataset ledger: every account's provenance, expected
import outcome, and transaction log (addresses and tx hashes only; no key
material). Proper workspace integration happens in its own reviewed PR.
