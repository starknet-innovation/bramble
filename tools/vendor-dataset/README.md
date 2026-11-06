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
  The app-made fixtures in `sepolia-stage-rdy.ts` (S-RDY: TA-09…TA-13; S-XVS:
  TA-26) run only once their phrase is in the seed file
  (`BRAMBLE_DATASET_SEED_S_RDY`, `BRAMBLE_DATASET_SEED_S_XVS`).
  The test-Ledger fixtures (`sepolia-stage-ldg.ts`, S-LDG: TA-32…) derive the
  device's keys from its phrase (`ledgerKeypair`); that phrase must belong to a
  test-only device that has never held real funds.
- `manifest/<network>/` is the dataset ledger, with one file per fixture group. It records
  every account's provenance, expected import outcome and transaction log
  (addresses and transaction hashes only, no key material). The matrix stages
  rewrite it in place, so run `bun run format` after a stage.
- `verify-dataset.ts` drives the built extension (`bun run build` first)
  through onboarding against live mainnet:
  `BRAMBLE_E2E_LIVE_NETWORK=1 bun tools/vendor-dataset/verify-dataset.ts [out.json]`.
  The `verification*.json` files are dated scorecard snapshots from earlier runs.
- `verify-sepolia.ts` is the Sepolia counterpart: one fresh profile onboarded
  with S-BRM, switched to Sepolia, then every in-wallet import path (P2…P8, P10)
  driven against the fixtures and scored against the scope doc's "Now" line per
  TA card (`verify-sepolia-checks.ts`; "Desired" rides along unscored).
  Read-only, about 15 minutes, retries the public node's rate limits:
  `BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia bun tools/vendor-dataset/verify-sepolia.ts [out.json] [previous.json]`.
  Passing a previous scorecard lists the verdicts that changed; keep a release's
  run as a dated `verification-sepolia-*.json`. It exits non-zero when any
  check fails or errors.
- The test Ledger is optional. By default TA-32…TA-37 are skipped, so the run
  needs no device. With `BRAMBLE_SEPOLIA_LEDGER=1` the browser opens visibly and,
  after the other checks, asks you to plug in and unlock the test Ledger, open
  the Starknet app and pick it in the device prompt, once for "Ledger account"
  and once for "Ready Ledger account" (`verify-sepolia-ledger.ts`). The wallet
  reads public keys from the device itself, which is why no seed file can stand
  in for it; nothing is signed. TA-38 (the first-run Ledger screen) stays manual,
  and automating the device with Ledger's emulator is tracked in #861:
  `BRAMBLE_SEPOLIA_LEDGER=1 BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia bun tools/vendor-dataset/verify-sepolia.ts`.
- The nightly (`.github/workflows/nightly.yml`) runs `verify-sepolia.ts`, without
  the Ledger, on the active release branch against the newest committed scorecard, so a failing
  import path blocks the release like any other nightly gate. It reads the seed
  file from the `BRAMBLE_SEPOLIA_SEEDS` repository secret: the Sepolia lines of
  `.env.vendor-seeds.local` pasted whole, with `S-LDG` left out (the runner
  never uses it). Only that one step sees the secret
  (`scripts/workflow-security-policy.ts`). Each run uploads its scorecard and
  a recorded tape as the `sepolia-verification` artifact.
- `BRAMBLE_SEPOLIA_RECORD=<tape.json>` records every network answer of a live
  run; `BRAMBLE_SEPOLIA_REPLAY=<tape.json>` (without `BRAMBLE_E2E_LIVE_NETWORK`)
  replays it fully offline, so a check can be rerun in seconds against the same
  chain state (`sepolia-tape.ts`). A tape holds addresses and node answers only,
  and is refused if it would carry a registered secret. Download a nightly's
  tape to replay a failure locally. Replay still types the seeds into the UI,
  so it runs locally and in the nightly only, never in PR CI.
- Derivation uses `@scure/bip32`/`@scure/bip39` directly, never Krusty, so the
  dataset stays independent of the wallet code it measures.
