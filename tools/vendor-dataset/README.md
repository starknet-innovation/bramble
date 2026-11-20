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
  The send-suite accounts (`sepolia-stage-txn.ts`, S-TXN: TX-00…TX-10, issue
  976) are the only Sepolia accounts the nightly sends from: one deployed
  account per signing shape, plus TX-00, the bank for its throwaway deploy
  accounts. They run only once `BRAMBLE_DATASET_SEED_S_TXN` is in the seed
  file, and re-running `matrix-stage-sepolia.ts TX` tops each one back up.
- `manifest/<network>/` is the dataset ledger, with one file per fixture group. It records
  every account's provenance, expected import outcome and transaction log
  (addresses and transaction hashes only, no key material). The matrix stages
  rewrite it in place, so run `bun run format` after a stage.
- `verify-dataset.ts` drives the built extension (`bun run build` first)
  through onboarding against live mainnet:
  `BRAMBLE_E2E_LIVE_NETWORK=1 bun tools/vendor-dataset/verify-dataset.ts [out.json] [seed filter]`.
  The filter is a substring of a seed variable (for example `GAPS`) and runs only
  the matching seeds; `BRAMBLE_DATASET_HEADED=1` shows the browser. When a scan
  dies, the seed's status keeps the browser's last page errors, console errors
  and crash or worker-exit events. The `verification*.json` files are dated
  scorecard snapshots from earlier runs.
- `verify-sepolia.ts` is the Sepolia counterpart: one fresh profile onboarded
  with S-BRM, switched to Sepolia, then every in-wallet import path (P2…P8, P10)
  driven against the fixtures and scored against the scope doc's "Now" line per
  TA card (`verify-sepolia-checks.ts`; "Desired" rides along unscored).
  Sends nothing, about 20 minutes, retries the public node's rate limits:
  `BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia bun tools/vendor-dataset/verify-sepolia.ts [out.json] [previous.json]`.
  Passing a previous scorecard lists the verdicts that changed; keep a release's
  run as a dated `verification-sepolia-*.json`. It exits non-zero when any
  check fails or errors.
- `verify-sepolia-sends.ts` (`bun run verify:sepolia:sends`, issue 976) sends
  a dust STRK self-transfer from every S-TXN account through the built
  extension and checks each on-chain: a successful receipt, the exact amount
  moved to self, a balance drop of exactly the fee, and the Activity row. A
  broadcast firewall lets the wallet send only from the account under check,
  so the import fixtures are never sent from. Accounts on a release the wallet
  does not sign for (TX-05 Argent 0.3.1, TX-06 Argent 0.5.0, TX-08 Braavos
  1.1.0) are checked the other way: Home shows "Read only", the allowlist stays
  empty and the nonce does not move. TX-10 is skipped until the wallet can
  import an sncast-shaped account (TA-07). About 0.25 testnet STRK a run;
  exits non-zero when any check fails.
- `verify-sepolia-deploys.ts` (`bun run verify:sepolia:deploys`, issue 976)
  checks a first deploy of every account type the wallet deploys, on a phrase
  generated for the run and never printed or stored. TX-00 funds its accounts
  and gets what is left swept back. D7: Add account → Regular account makes an
  unfunded account whose Deploy screen asks for STRK. D1–D3: the first send
  deploys OZ, Argent 0.4 on Bramble's ladder and Argent 0.4 on Ready's. D4: an
  explicit Deploy, self-paid while Sepolia's relay offers no sponsorship. D5:
  an undeployed Braavos shows "Not deployed" until its explicit Deploy, then
  sends. Each address must match the dataset's own derivation. About 2
  testnet STRK a run, in fees and the sweep's reserve left as dust; a case that
  fails before deploying strands its 1 STRK float.
- `verify-sepolia.ts` also checks that Send is refused for TA-08, TA-20, TA-29
  and TA-12 (path `SEND`, `verify-sepolia-refusals.ts`): last in the run, it
  imports each from its scan and checks Home from the account. The whole run
  sits behind a broadcast firewall that allows no sender, so a send attempt is
  aborted and counted, and any broadcast during the import cards fails the run.
  A replay skips these cards, since they read each account's nonce live.
- `sepolia-bank-runway.ts` reads the S-TXN balances (no seed needed) and exits
  non-zero with "Sepolia bank low" when the bank or a sender is short; refill
  with `matrix-stage-sepolia.ts TX`.
- The test Ledger is optional. By default TA-32…TA-37 are skipped, so the run
  needs no device. With `BRAMBLE_SEPOLIA_LEDGER=1` the browser opens visibly and,
  after the other checks, asks you to plug in and unlock the test Ledger, open
  the Starknet app and pick it in the device prompt, once for "Ledger account"
  and once for "Ready Ledger account" (`verify-sepolia-ledger.ts`). The wallet
  reads public keys from the device itself, which is why no seed file can stand
  in for it; nothing is signed. TA-38 (the first-run Ledger screen) stays manual
  here; the offline Speculos suite in `tests/e2e/ledger/` (see its README)
  drives first-run import and blind-sign with the public test phrase (#861):
  `BRAMBLE_SEPOLIA_LEDGER=1 BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia bun tools/vendor-dataset/verify-sepolia.ts`.
- The nightly (`.github/workflows/nightly.yml`) runs `verify-sepolia.ts`, without
  the Ledger, on the active release branch against the newest committed
  scorecard, so a failing import path blocks the release like any other nightly
  gate. The `BRAMBLE_SEPOLIA_SEEDS` repository secret has been set since
  2026-11-10; if it is ever removed, the gate is skipped and the summary lists
  it under "Not run", never as passed. A second gate, "Sepolia sends and
  deploys", runs `sepolia-bank-runway.ts`, then the send and deploy runs, from
  the `BRAMBLE_SEPOLIA_TXN_SEED` repository secret: the S-TXN phrase alone,
  seen by that one step and written to a one-line seed file it removes when it
  ends. Unset, that gate is listed under "Not run" too. The import gate reads
  the seed file from the `BRAMBLE_SEPOLIA_SEEDS` repository
  secret, which holds only the eleven lines the runner reads:
  `BRAMBLE_DATASET_SEED_S_{BRM,SCR,BRV,RDY,XVS,W15,W18,W21}` and
  `BRAMBLE_DATASET_KEY_K_{OZ,ROT_A,SNC}`. Leave everything else out, the
  Ledger seed and the guardian, 2FA and rotation keys included. Only that one
  step sees the secret, and it masks each value in the log
  (`scripts/workflow-sepolia-policy.ts` holds it there). The secret reaches
  whatever code is on the release branch, so release branches must stay
  protected. It records no tape and uploads nothing, since the repository is
  public; the verdicts are in the job log and summary.
- `BRAMBLE_SEPOLIA_RECORD=<tape.json>` records the network answers of a live
  run; `BRAMBLE_SEPOLIA_REPLAY=<tape.json>` (without `BRAMBLE_E2E_LIVE_NETWORK`)
  replays it fully offline against the same chain state (`sepolia-tape.ts`):
  about 90 seconds instead of the live run's 20 minutes, because a replay has
  no rate limit to pace around. It tolerates the wallet taking a different
  path than the live run did (another RPC endpoint, another block), and lists
  any request the tape cannot answer. A replay reproduces what the wallet did
  with that chain state, so a wallet regression shows; a live failure caused
  by the node (a rate limit, a failover) does not, since a replay serves
  successful answers first.
- A tape holds addresses and node answers only. The privacy service (any
  `/strk20/` path) is never recorded, because its requests carry the account's
  viewing key; secret-named request fields are stored as `[omitted]`; and a
  tape that still carries a seed, key or secret-named field is not written.
  Record and replay are local-only, and a tape stays on the machine that made
  it; never commit or upload one. Replay with
  `BRAMBLE_DATASET_NETWORK=sepolia BRAMBLE_SEPOLIA_REPLAY=tape.json bun tools/vendor-dataset/verify-sepolia.ts`.
- Derivation uses `@scure/bip32`/`@scure/bip39` directly, never Krusty, so the
  dataset stays independent of the wallet code it measures.
