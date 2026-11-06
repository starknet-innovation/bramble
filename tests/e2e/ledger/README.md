# Ledger E2E on Speculos (issue 861)

Drives the built extension's Ledger import and blind-sign paths against Ledger's
Speculos emulator. It is the offline suite: Speculos is seeded with the
repository's public test phrase (`IMPORT_MNEMONIC`), never S-LDG or any secret.

## Run it

Needs Docker and network access for the first build.

```bash
bun run build
bun run vendor:ledger-app          # builds app-starknet 2.4.3 for nanosp, flex, stax
# First time only: review the printed SHA-256s and record them in
# scripts/ledger-app-pins.ts (LEDGER_APP_BINARIES) in a reviewed commit.
bun run test:e2e:ledger            # nanosp and flex; or: bun run test:e2e:ledger stax
```

`test:e2e:ledger` refuses a binary whose hash is not recorded or does not
match, starts the digest-pinned Speculos image on loopback ports, and runs
`ledger.speculos.ts` under `playwright.ledger.config.ts`; there an unreachable
emulator fails every test. Without Docker or a vendored binary the runner prints
`NOT RUN (skipped, no test passed)` with the reason and runs nothing; set
`BRAMBLE_SPECULOS_REQUIRED=1` to make that a failure. The default
`bun run test:e2e` (and `ci.yml`) does not match `*.speculos.ts`; it runs only
`hid-bridge-reach.e2e.ts`, which needs no emulator.

## In CI

`.github/workflows/ledger-e2e.yml` runs the suite on a GitHub-hosted
`ubuntu-latest` runner (Docker included) for pull requests and pushes into
`main` and `release/**` that touch Ledger code, nightly at 04:30 UTC, and on
manual dispatch. It holds no repository secret and a read-only token, so fork
pull requests run it as they are. It builds the extension, builds the pinned
app for `nanosp` and `flex`, runs `BRAMBLE_SPECULOS_REQUIRED=1 bun run
test:e2e:ledger`, and then requires each model's Playwright JSON report to show
tests that ran and passed, none skipped (`scripts/ledger-e2e-results.ts`). On
failure it keeps the Playwright traces (`test-results/ledger-<model>/`) for 7
days; they show only the wallet driven with the public test phrase.
`scripts/ledger-e2e-workflow-policy.ts` pins these controls.

While a tested model's hash is `null`, the job fails in its first step and
says to record the hashes. That red run is intended: it must never report
green without running the suite.

## Recording the app hashes

Hashes change only when `APP_STARKNET_REVISION` or `LEDGER_APP_BUILDER_IMAGE`
in `scripts/ledger-app-pins.ts` changes. A new Speculos image does not change
them. When either changes, the hashes go back to `null` in the same pull
request, and the procedure runs again:

1. A maintainer with write access dispatches record mode: Actions, Ledger E2E,
   Run workflow, `record_hashes` ticked, on the branch that carries the pins
   (`gh workflow run ledger-e2e.yml --ref <branch> -f record_hashes=true`). It
   builds every model, prints each ELF's SHA-256 to the job summary, and runs
   no test. The test job is skipped in that run.
2. That maintainer reproduces the hashes with an independent local build
   (`bun run vendor:ledger-app` with Docker) and opens a pull request that sets
   `LEDGER_APP_BINARIES` to them, linking the record run.
3. A second maintainer reviews it: same commit and builder digest as the
   record run, and both builds agree byte for byte. A mismatch is not
   recorded; it is investigated.
4. Once merged, the workflow's test mode runs the suite against those hashes,
   and `vendor:ledger-app` fails on any build that does not match.

## What it covers

- First-run Ledger onboarding through the grant tab: the LedgerW OZ account
  (TA-32 shape) is imported, and the argentx Argent account (TA-33 shape) is
  derived and listed. Offline, a Ready account cannot be imported (no on-chain
  activity), so argentx is checked as derived only.
- A dapp SNIP-12 signature: the hash the wallet shows equals the hash on the
  device screen, and a signature comes back.
- Refusals: Blind signing off on the device, and the user rejecting on the
  device. Both show the existing copy.
- Nano S+ (`/button`) and Flex (`/finger`); Stax is supported but not default.

## How it works

- `hid-shim.ts` replaces `navigator.hid` (Ledger vendor id, usage page `0xFFA0`)
  in every page of the context via `addInitScript`, including the grant tab
  opened later. WebUSB is hidden in those pages. `hid-bridge-reach.e2e.ts`
  proves the reach; no CDP fallback was needed.
- `hid-bridge.ts` relays output reports through `exposeBinding`, reassembles
  them with the pinned `@ledgerhq/hw-transport-webhid` framing, and forwards
  APDUs to Speculos on TCP 9999 (`speculos.ts`).
- `dashboard.ts` stands in for the dashboard (`B0 A7`, `E0 01`, `E0 D8`, with a
  disconnect and reconnect). Its replies come from the testkit captures and are
  pinned by `dashboard.test.ts`.
- `scripts/check-test-bridge-boundary.ts` (in `check`) fails if anything in
  `apps/` or `packages/` imports or names this folder.

## Not covered

Chrome's real device chooser and user-activation rule, WebUSB and Bluetooth,
real reconnect identity (the fake returns the same device object), and the real
dashboard and firmware. The physical test Ledger check before release stays
(`RELEASING.md`).
