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
`bun run test:e2e` (and CI) does not match `*.speculos.ts`; it runs only
`hid-bridge-reach.e2e.ts`, which needs no emulator.

## What it covers

- First-run Ledger onboarding through the grant tab: the LedgerW OZ account
  (TA-32 shape) is imported, and the argentx Argent account (TA-33 shape) is
  derived and listed. Offline, a Ready account cannot be imported (no on-chain
  activity), so argentx is checked as derived only.
- A dapp SNIP-12 signature: the hash the wallet shows equals the hash on the
  device screen, and a signature comes back.
- Refusals: Blind signing off on the device, and the user rejecting on the
  device. The app answers both with 0x6985, so both show the copy that
  covers either cause, after one hash APDU.
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
