# Vendor-import dataset tooling

Operational scripts for the mainnet vendor-import dataset described in
`docs/VENDOR_IMPORT_DATASET.md`. They are development tooling owned by the
root workspace, like `scripts/`. They run with `bun tools/vendor-dataset/<script>.ts`
from the repository root and are held to the same gates: `tsc`, Biome, file
standards, workspace architecture and knip. Nothing here is bundled into the
extension.

- `BRAMBLE_DATASET_NETWORK` picks the chain: `mainnet` (default) or `sepolia`.
  It sets the RPC node, chain id, token addresses, deployer and manifest folder.
- Seeds and keys, mainnet and Sepolia alike, are read at run time from the
  git-ignored `.env.vendor-seeds.local` at the repository root and shared
  through the password manager. Set `BRAMBLE_DATASET_ENV_FILE` to read another
  path. They are never stored in this repository. `sepolia-seeds.ts` maps each
  Sepolia seed's scope-doc id (`S-BRM`, …) to its variable.
- The Sepolia deployer is TA-01, Bramble's account 0 on `S-BRM` with salt 0. Print its address with
  `BRAMBLE_DATASET_NETWORK=sepolia bun tools/vendor-dataset/deployer-address.ts`,
  fund it from the faucet, then run `deploy-deployer.ts` the same way.
- `matrix-stage-sepolia.ts` builds the scripted TA fixtures from those seeds
  and keys (one `sepolia-stage-*.ts` file per seed group, sharing
  `sepolia-fixtures.ts`). It is idempotent; pass a TA id to run one fixture:
  `BRAMBLE_DATASET_NETWORK=sepolia bun tools/vendor-dataset/matrix-stage-sepolia.ts TA-08`.
  The S-RDY fixtures (TA-09…TA-13, `sepolia-stage-rdy.ts`) run only once the
  Ready-made seed is in the seed file as `BRAMBLE_DATASET_SEED_S_RDY`.
- `manifest/<network>/` is the dataset ledger, with one file per fixture group. It records
  every account's provenance, expected import outcome and transaction log
  (addresses and transaction hashes only, no key material). The matrix stages
  rewrite it in place, so run `bun run format` after a stage.
- `verify-dataset.ts` drives the built extension (`bun run build` first)
  through onboarding against live mainnet:
  `BRAMBLE_E2E_LIVE_NETWORK=1 bun tools/vendor-dataset/verify-dataset.ts [out.json]`.
  The `verification*.json` files are dated scorecard snapshots from earlier runs.
- Derivation uses `@scure/bip32`/`@scure/bip39` directly, never Krusty, so the
  dataset stays independent of the wallet code it measures.
