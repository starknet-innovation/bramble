# Vendor-import dataset tooling

Operational scripts for the mainnet vendor-import dataset described in
`docs/VENDOR_IMPORT_DATASET.md`. They are development tooling owned by the
root workspace, like `scripts/`. They run with `bun tools/vendor-dataset/<script>.ts`
from the repository root and are held to the same gates: `tsc`, Biome, file
standards, workspace architecture and knip. Nothing here is bundled into the
extension.

- Seeds are read at run time from the git-ignored `.env.vendor-seeds.local` at
  the repository root. Set `BRAMBLE_DATASET_ENV_FILE` to read another path.
  Seeds are never stored in this repository.
- `manifest/` is the dataset ledger, with one file per fixture group. It records
  every account's provenance, expected import outcome and transaction log
  (addresses and transaction hashes only, no key material). The matrix stages
  rewrite it in place, so run `bun run format` after a stage.
- `verify-dataset.ts` drives the built extension (`bun run build` first)
  through onboarding against live mainnet:
  `BRAMBLE_E2E_LIVE_NETWORK=1 bun tools/vendor-dataset/verify-dataset.ts [out.json]`.
  The `verification*.json` files are dated scorecard snapshots from earlier runs.
- Derivation uses `@scure/bip32`/`@scure/bip39` directly, never Krusty, so the
  dataset stays independent of the wallet code it measures.
