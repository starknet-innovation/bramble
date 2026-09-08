---
layout: default
title: Architecture and internals
permalink: /architecture/
---

# Bramble — Architecture & Internals

The deep tour: how the extension is wired, the pinned account/multisig class hashes, the dApp provider surface, storage migrations, and the design system. For a quick overview and setup, see the [README](../README.md).

---

## Status

This repository starts with the extension shell, strict checks, encrypted storage primitives,
permissioned store access, migration tests, and a Krusty KMS WASM adapter boundary.

Krusty KMS is required for wallet cryptography. Its upstream README currently marks the project
experimental and not suitable for production or security-critical use, so this repo does not add a
local signing fallback.

## Architecture

- `apps/extension/src/background` owns privileged state, approvals, unlock sessions, and vault service wiring.
- `apps/extension/src/content` and `apps/extension/src/provider` bridge page requests to the background without exposing signing
  or vault operations to dapps.
- `packages/platform/vault/src` owns encrypted persistence, permission checks, schema validation, and migrations.
- `packages/platform/kms-krusty` adapts Krusty KMS and rejects invalid inputs or WASM outputs at
  the boundary.
- `packages/platform/ledger-browser` owns the Window-only Web Bluetooth/WebUSB/WebHID transport and
  hardware interaction. The service worker never opens a device, and the side panel never decides
  what transaction may be broadcast.
- `packages/presentation/ui-kit/src` defines the design system: the replaceable color skin contract plus the shared scale
  tokens (spacing, radius, type, motion, control metrics) consumed by side panel styling.

## Tokens, Prices, and Spam Filtering

Token tracking spans a few narrow modules:

- Custom tokens: the privileged `wallet.addToken { address }` message reads `name`, `symbol`, and
  `decimals` on-chain through `getTokenMetadata` in `packages/platform/starknet/src/rpc/rpc.ts` (felt short-string and
  Cairo ByteArray decoding), normalizes the symbol, and stores it through `preferencesStore`. The
  UI lives on the tokens flow (`packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/token-flows.ts`), reachable from the home Balances
  header and Settings.
- Auto-detection: `packages/features/portfolio/src/tokens/token-registry.ts` vendors a curated mainnet registry (ETH, STRK,
  USDC, USDT, DAI, WBTC). `wallet.detectTokens` probes `balanceOf` for registry tokens not yet
  tracked and returns held ones as one-tap suggestions. Registry addresses marked `VERIFY` are
  advisory; a wrong address simply fails its probe and is never surfaced, and detection never
  authorizes a transfer.
- Spam filtering: the same registry module exports heuristics (registry-symbol spoofing with
  confusable folding, absurd decimals, empty names). Flagged tokens are hidden from home by
  default; the tokens flow reveals them with a warning. A backwards-compatible optional
  `hiddenTokens` preference (like `rpcOverrides`) records user hide/show choices.
- Prices: `packages/features/portfolio/src/tokens/prices.ts` fetches CoinGecko `simple/token_price` and `market_chart` for
  the `starknet` platform (host permission `https://api.coingecko.com/*`), cached in storage with a
  ~5 minute TTL behind an injected clock. Fetching happens only in the background worker through an
  injected `fetch`; every failure degrades to cached-or-empty so the UI omits fiat when offline.
  Home balance rows and the hero portfolio total use `preferences.displayCurrency`.
- Token detail: tapping a balance row opens a detail flow with the current price, a self-drawn
  7-day SVG sparkline (`packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/sparkline.ts`), holdings, and contract facts.

Known limitations (v1): registry coverage is mainnet-only and address-verified from public token
lists; fiat prices depend on CoinGecko's Starknet coverage and address normalization, so some
tokens show no price; spam-flagged tokens cannot yet be force-pinned to home (they stay on the
tokens flow); custom tokens whose on-chain symbol is not a `[A-Z0-9]{2,12}` ticker are rejected;
there is no dedicated remove-token action (hide instead).

## Account classes

Every software, imported-key, and Ledger account records an explicit contract type. New-account
screens offer the stable Argent Account or the existing OpenZeppelin `AccountUpgradeable`; the
choice is part of address derivation, deployment, signature serialization, and the versioned vault
schema, so it cannot be changed after creation.

- Preset: OpenZeppelin `AccountUpgradeable`, Cairo `openzeppelin_presets` v3.0.0.
- Pinned class hash:
  `0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381`
  (identical on Mainnet and Sepolia). Source of truth: `OZ_ACCOUNT_CLASS_HASH` in
  `packages/foundation/wallet-model/src/accounts/accounts.ts`, cross-checked against the published
  Krusty package by the known-answer vectors in `scripts/check-krusty-adapter.ts`. Address
  derivation matches `accountDeployment`
  in `packages/platform/starknet/src/transactions/deployment.ts` (constructor `constructor(public_key: felt252)`).
- Devnet: run the node as `starknet-devnet --chain-id SN_DEVNET`, matching `STARKNET_NETWORKS.SN_DEVNET`; a
  default devnet reports Sepolia's id and the write-path guard rejects it. A local devnet also declares only its
  OWN account class, so `getOzAccountClassHash` resolves `SN_DEVNET` to the class the node predeclares
  (`devnet_getConfig` -> `account_contract_class_hash`) — same preset and constructor, derivation unchanged. It is
  devnet-VERSION specific and pinned by no CI gate. Argent accounts stay unavailable on a devnet that has not
  declared that class itself. Devnet derives its predeployed accounts' keys from the node seed but deploys them
  at its own fixed salt, while the OZ path tries only `["0x0", publicKeyX]` (`deployment.ts`) — so importing a
  predeployed key yields a fresh counterfactual address, not the pre-funded one.
- Audit: OpenZeppelin Contracts for Cairo audit reports —
  <https://github.com/OpenZeppelin/cairo-contracts/tree/main/audits> (API docs:
  <https://docs.openzeppelin.com/contracts-cairo/3.x/api/account#AccountUpgradeable>).
- Argent Account 0.4.0 class hash:
  `0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f`;
  compiled class hash:
  `0x0294a323246c017d00a98f11942e1e38d562c97bc79426742110a14ce497e9b5`.
  It is pinned to Argent's `update-2024Q2` release at commit
  `1352198956f36fb35fa544c4e46a3507a3ec20e3`. Its constructor and account
  signature encoding come from `@bramble/starknet/account-contracts`.
  The pin deliberately uses Argent's latest non-prerelease production line,
  not the newer v0.5 prerelease that upstream marks unsupported by Ready.
  The [May 2024 ChainSecurity report](https://github.com/argentlabs/argent-contracts-starknet/blob/1352198956f36fb35fa544c4e46a3507a3ec20e3/audit/ChainSecurity_Argent_Argent_Account_audit-2024-05.pdf)
  covers the pinned Account and Multisig release; its scope and assumptions are
  evidence about those contracts, not an audit of Bramble's integration.

### Verification

Both supported account classes are declared on Mainnet and Sepolia. Re-run the
check against the wallet-owned gateway with either pinned class hash:

```bash
for NET in mainnet sepolia; do
  curl -s -X POST "https://wallet.nodes.starknet.org/rpc/$NET/v0_10" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClass","params":{"block_id":"latest","class_hash":"0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f"}}' \
    | head -c 80; echo " <- $NET";
done
```

A non-empty `result` (not a `Class hash not found` error) confirms the class is
declared. If the RPC endpoint is unreachable from a sandbox, run the command from
a networked host and expect the same result.

## Ledger Hardware Accounts

Ledger accounts can use either supported single-signer account class, but the vault stores only
public account metadata: the contract type, account address, public-key x-coordinate, account index,
and canonical EIP-2645 path `m/2645'/1195502025'/734980059'/0'/<index>'/0`. No Ledger mnemonic or
signing key enters Bramble. A Ledger-only vault therefore has `mnemonic: null` and no `signingKeys`
entry for its accounts; a mixed vault may contain both software and Ledger account records.

The hardware signing path is split across two mutually checking contexts:

1. The privileged background creates the exact Starknet message hash, parks a bounded signing
   request, and records the active unlock-session generation.
2. A top-level extension tab owns the selected transport. The side panel checks the app version
   and public key at the stored path through its validated session broker, then asks the device to
   blind-sign that exact hash.
3. The background receives only `(r, s)`, verifies it against the parked hash and stored public
   key, re-checks the unlock generation, and only then allows the existing submit path to
   broadcast. A missing queue, timeout, lock/expiry, wrong device, malformed response, rejected
   prompt, or bad signature fails closed.

Chrome displays its native hardware chooser only from an ordinary browser tab. Both an extension
side panel and a `chrome.windows.create({ type: "popup" })` window can resolve a picker request with
an empty device list even while the OS sees the Ledger; this was reproduced with an unlocked Nano
X and with an unfiltered chooser. Device selection therefore happens in `ledger-grant.html` opened
as an active tab. Do not move this boundary back to a popup window. Some Nano X firmware exposes Ledger's APDU
collection and a protected FIDO collection as one composite HID device. Chrome deliberately hides
that entire device from WebHID, even when the chooser filter targets only Ledger's vendor-defined
APDU usage page (`0xFFA0`). Browser API presence does not identify the attached model or connection,
so the tab never infers Bluetooth from `navigator.bluetooth`. It presents cable as the primary
method (WebUSB with an APDU-filtered WebHID compatibility path) and Bluetooth as an explicit
alternative for BLE-capable models. Nano S Plus is cable-only. Before reporting success, the tab
opens the user-selected
transport, reads the Starknet app version, derives
and discards the public key at the canonical index-zero path, then retains that transport for the
current operation. Stable Chrome does not expose `Bluetooth.getDevices()`, so closing the tab and
silently reopening a paired device from the side panel is not a supported design. The Bluetooth
path therefore owns and explicitly disconnects its GATT session; its readiness sequence pairs from
the Ledger dashboard before asking the user to open Starknet.

The side panel reaches the retained transport over a same-extension `BroadcastChannel` named with
a random, per-tab capability. Both ends validate exact message shapes. Only canonical Ledger
paths, Stark field hashes, public app/key responses, and the raw `(r, s)` result can cross; no seed,
private key, vault secret, device identifier, raw transport error, `postMessage`, or Chrome runtime
message does. The tab closes only itself when the owned session finishes; it never closes the
browser window that hosts unrelated tabs. Every tab and APDU wait is bounded. For already-granted cable
devices, the side panel may reconnect silently and presents explicit non-secret device choices
when several are connected; Bluetooth disambiguation remains in Chrome's native pairing chooser.

Bramble supports the Starknet Ledger app 2.x compatibility line and rejects legacy 1.x before
enumeration or signing. The floor is a product compatibility boundary, not a substitute for the
host-side signature verification gate. Blind signing must be enabled in the Starknet app. Device
transport errors are collapsed into the typed rejection catalog and never used to authorize a
fallback signer.

Recovery boundaries are deliberately explicit:

- Bramble's recovery phrase restores software accounts only.
- Bramble's JSON backup contains preferences, labels, contacts, and other non-secret settings;
  it does not restore Ledger accounts.
- Restore Ledger accounts with the Ledger device and its Ledger recovery phrase, then enumerate
  and add the same account indices again.

## Migration Workflow

1. Bump `CURRENT_SCHEMA_VERSION` in `packages/platform/vault/src/schema/schema.ts`.
2. Add one adjacent step to `VAULT_MIGRATIONS` in `packages/platform/vault/src/schema/migrations.ts`.
3. Update schema validators and tests for old, current, and invalid vault data.
4. Exercise `readMigratedVault` staging, verification, restart recovery, and idempotence tests.
5. Run `bun run check`, `bun run build`, and `bun run package:extension`.

The vault schema is currently at **v4**. v2 added `mnemonic: string | null`; v3 admits a `"ledger"`
derivation whose path, index, and `LedgerW` marker must agree and which has no `signingKeys` entry.
v4 adds encrypted `accountSecrets`; public `AccountRef` records cannot contain optional secrets.
Ledger STRK20 viewing keys retain exact account, chain, pool, and scheme provenance. Vaults migrated
from v1 carry `mnemonic: null`; they cannot add software accounts or reveal a phrase until re-created,
but may add a keyless Ledger account. Every migration is adjacent and deterministic (`v0 → v1 → v2 → v3 → v4`).

Chrome preserves `storage.local` across an update but clears `storage.session`. `runtime.onInstalled`
therefore cannot migrate an encrypted vault: it has no passphrase. The first authenticated read runs
the pure schema chain, verifies an encrypted `bramble:vault-migration` stage, then verifies the
primary before cleanup. A worker stop leaves either the old primary or an authenticated recovery
copy; invalid data never reaches the primary write. See [Wallet store architecture](WALLET_STORE.md).

## Account Lifecycle and Secret Reveal

- **Backup verification (onboarding).** Generating a fresh phrase reveals confirmation inputs for
  words 3, 7, and 11. Those positions are deterministic on purpose: randomness would need a
  clock/entropy boundary that repo standards keep out of pure UI code, and fixed positions keep the
  predicate (`verifyBackupWords` in `packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/backup-verify.ts`) pure and exhaustively
  testable. Create stays disabled until the words match. Pasting an existing phrase skips
  verification.
- **Add account.** `wallet.addAccount { networkId }` (privileged, session-authenticated) delegates
  to `WalletVaultService.addDerivedAccount`, which derives the next unused `accountIndex` for that
  network from the stored phrase, appends the account plus its signing key, and selects it.
  Ledger onboarding instead enumerates public keys from the selected device, derives keyless
  account records in the background, and adds each successful selection independently so a partial
  batch failure leaves only the uncreated accounts retryable.
- **Reveal seed / export key.** `wallet.revealSecrets { vaultPassphrase }` is privileged, requires
  the passphrase re-entered in the message (never the cached session), verifies it via `readVault`,
  and returns `{ mnemonic, privateKey }` for the active account. The settings-reachable reveal
  screen re-authenticates, warns strongly, blurs the values until tapped, and never persists them —
  they are wiped on the next render. `tests/background/routing/key-boundary.test.ts` sanctions this reveal only for an
  extension-page sender with the correct passphrase.

### Import private key

Raw-key import is shipped as the privileged, extension-page-only `wallet.importAccount` operation.
The wallet must already be unlocked; the message carries the target network and pasted key but not
the vault passphrase. `apps/extension/src/background/accounts/import-inputs.ts` accepts only an exact request shape and a
canonical, non-zero Stark private key. Dapps cannot reach this message type.

`deriveImportedAccount` keeps key handling inside the existing Krusty boundary: Krusty recovers the
public key and derives the explicitly selected account-contract address, and the wallet rejects invalid KMS
outputs. No local key-derivation or signing fallback exists. The account is tagged
`imported-raw-key`; the private key is written only to the encrypted vault signing-key collection,
the imported account becomes active, and an existing account is rejected. Invalid input, a locked
session, unavailable KMS behavior, inconsistent public data, or a vault write failure aborts the
import without returning a usable account.

## Design System

Side panel styling is layered so each axis can be updated in one place:

- Colors: `Skin` tokens live in `packages/presentation/ui-kit/src/theme/skin.ts`; the concrete
  palettes live beside it in `default-skin.ts` and `dark-skin.ts`. `applySkin` rejects missing,
  extra, hidden, or accessor tokens.
- Scales: spacing, radius, type, control metrics, plus `WEIGHT`, `TRACKING` (size-specific
  letter-spacing), a `SIZE` height scale, an elevation `SHADOW` scale, strong `EASE` curves, and
  named `SPRING` presets (Apple's response/damping form) all live in `packages/presentation/ui-kit/src/theme/tokens.ts`.
- Motion primitives: `packages/presentation/ui-kit/src/motion/spring.ts` turns a spring preset into a native CSS/WAAPI `linear()`
  easing + settle duration (no dependency, CSP-safe). `packages/presentation/wallet-ui/src/sidepanel/shared/motion.ts` exposes
  `prefersReducedMotion()`, an interruptible WAAPI `animate()`/`spring()` wrapper (cancels
  in-flight animations, cuts to the final state under reduced motion), and a `stagger()` helper.
- Stylesheet layers: `packages/presentation/wallet-ui/src/sidepanel/styles/index.ts` composes
  shared core layers and named journey layers for onboarding, portfolio, privacy, send, settings,
  swap, and multisig. The home/onboarding layers are composed last so their reduced-motion rules
  win. Surfaces remain flat and skin-driven; spacing, contrast, elevation, and motion carry the
  hierarchy without a second material system.

Gestures: the account drawer and toasts are drag-dismissible with 1:1 pointer tracking and
velocity-projected momentum (`projectMomentum` in `packages/presentation/wallet-ui/src/sidepanel/shared/motion.ts`) deciding whether a
release falls closed or springs back; both cut to their resting state under `prefers-reduced-motion`.

Interaction contract: controls are borderless — structure comes from elevation and spacing — and
feedback transforms stay inside a bounded envelope (press scale 0.92–1.0, hover/press lift ≤ 2px)
so nothing drifts under the pointer. Screen changes run through the View Transitions API, sliding
forward/back by navigation depth (cross-fade for same-depth swaps) with an instant-swap fallback;
`prefers-reduced-motion` collapses all motion to a cut on both the CSS and JS sides.
`tests/sidepanel/sidepanel-styles.test.ts` and `tests/sidepanel/motion.test.ts` enforce these rules.

The background broadcasts `wallet.event` messages (`accountsChanged`, `networkChanged`,
`approvalsChanged`) after mutations. The side panel refreshes live from those events, and content
scripts forward `accountsChanged`/`networkChanged` to connected pages through the injected
provider's `on`/`off` subscription API — after re-querying which addresses each origin may see,
so events never leak wallet state to unconnected sites.

## dApp Provider

The injected `window.starknet_bramble` object follows the get-starknet/starknetkit
`StarknetWindowObject` shape: `id`, `name`, `version`, an inline `data:` URI `icon`, `isConnected`,
`selectedAddress`, `on`/`off`, `enable`, and `request`. `chainId` is initialized lazily from
`wallet_requestChainId` after `enable` and kept current from `networkChanged` events;
`isPreauthorized()` resolves `true` when the origin's grant covers the wallet's active account. The
object is frozen and installed as a non-configurable global.

`request` accepts these methods, mapped to safe background messages by `packages/foundation/wallet-protocol/src/provider/bridge.ts`:
`wallet_requestAccounts`/`mc_requestAccounts`, `mc_accounts`, `wallet_requestChainId`,
`wallet_switchStarknetChain`, `wallet_addInvokeTransaction`, `wallet_signTypedData`,
`wallet_getPermissions` (returns `["accounts"]` when the origin is connected, else `[]`), and
`wallet_watchAsset`. STRK20 adds balance, proof-preparation, invoke, and sub-account-commitment
methods behind the same origin and phishing gates. Private-state requests additionally require a
held approval bound to the account, network, and payload digest; connection alone is insufficient.

Grants and provider events are isolated per origin: each origin reads only its own accounts
(`wallet.getGrantedAccounts`) and each content script derives page events from its own history
(`pageEventsFor`), so multiple connected sites never observe each other's state.

A grant records which accounts a site was ever approved for; the active account decides which single
one of them it may see right now (`grantedAccountIdsFor` in `packages/platform/vault/src/service/origin-grants.ts`).
`wallet.getGrantedAccounts` returns the active account when the grant covers it and `[]` otherwise —
no grant, no active account, or an active account the grant does not name. So an origin whose grant
misses the active account reads as disconnected: the page receives `accountsChanged([])`, and
reconnecting queues a fresh approval instead of silently handing back the previously connected
account. A page is never handed two of the user's accounts, however many the stored grant has
accumulated from repeated approvals, so a site cannot correlate them. The connected-sites manager
still lists the site with its full granted-account count, because it reads the stored grants
directly, and revoking there is what clears the grant.

The active-network consumers (invoke, declare, typed-data signing, STRK-20, deploy discovery) then
filter that account by the active network and refuse with `origin not connected` if it does not
match — fail-closed, and unreachable in practice because both account pickers list only accounts on
the active network and `switchActiveNetwork` re-selects the target network's account.

`wallet_watchAsset` (SNIP-compatible ERC20, `options.address`) fetches the token's on-chain
`name`/`symbol`/`decimals` via RPC (falling back to the caller's options), then queues a
`watch-asset` approval rendered in the side panel. Approving calls `preferencesStore.upsertToken`;
denying leaves the token untracked. Like `wallet_requestAccounts`, this uses the queue-and-pending
model rather than a persistent open promise: an already-tracked asset resolves `true` immediately,
otherwise the current call rejects with `approval pending` and the dapp receives `true` on a repeat
call after approval. Holding the dapp promise open across the side-panel decision within a single
service-worker lifetime is a possible future enhancement.

## Connected Sites & Site Reputation

The wallet tracks which dapp origins hold account grants and surfaces phishing
and reputation signals before a connection is approved:

- Connected-sites manager: Settings → Connected sites lists every origin with a
  persisted grant and how many accounts it can see. Revoking an origin removes
  its grants from the encrypted vault and broadcasts `accountsChanged` so the
  revoked page immediately sees an empty account list.
- Phishing blocklist (seed + live feed): `packages/features/permissions/src/blocklist.ts` decides
  whether an origin is blocked from a bundled seed list (`BLOCKED_DOMAINS`) and
  an injected dynamic snapshot. `wallet.requestAccounts` — and every other dapp
  surface (getPermissions, getGrantedAccounts, watchAsset, addInvokeTransaction,
  addStarknetChain, addDeclareTransaction, deploymentData, STRK20) — from a
  blocked origin is refused with `origin blocked`.
- Live phishing feed (decision, issue #34): rather than remaining a static
  baseline that only updates with an extension release, phishing protection now
  consumes a live, updatable remote feed *in addition to* the seed. The decision
  was to adopt a remote feed with a **fail-safe** stance:
  - `packages/features/permissions/src/phishing-feed.ts` fetches a maintained web3 phishing list from
    a configurable source (default: MetaMask's community-maintained
    eth-phishing-detect, `https://metamask.github.io/eth-phishing-detect/v1/config.json`)
    under an explicit new host permission (`https://metamask.github.io/*`).
  - The payload is validated before use and cached in plain (non-secret) local
    storage under `bramble:phishing-feed`. Wire format is
    `{ "blocklist": string[], "version"?: number }`; the eth-phishing-detect
    `blacklist` key is accepted as an alias and its fuzzy/whitelist fields are
    ignored (the wallet's own heuristics cover lookalikes).
  - Refresh cadence: the background worker warms the feed on startup and
    refetches only when the cache is older than the TTL (6h), so the list
    refreshes automatically without a new build.
  - Stale / unavailable behaviour is **fail-safe, never fail-open**: an
    unreachable or malformed source falls back to the last good cache, and the
    bundled seed list is always enforced independently — so a network outage can
    only *reduce* coverage to the shipped baseline, never disable blocking. New
    domains added to the feed are flagged without an extension release; the seed
    guarantees existing detections and the lookalike / risky-TLD heuristics keep
    working offline.
  - The `OriginGuard` (`createOriginGuard`) closes over the feed's live snapshot
    accessor so enforcement call sites stay unaware of the feed's origin and a
    refresh takes effect immediately. A user-facing preference to override the
    source URL is a documented follow-up (the source is code-configurable today,
    consistent with how the CoinGecko price base is configured).
- Lookalike heuristics: punycode detection plus digit-substitution,
  hyphen-insertion, edit-distance, and brand-substring checks against a
  protected list (`starknet.io`, `argent.xyz`, `braavos.app`, `cartridge.gg`,
  `ethereum.org`) raise warnings without blocking, so real sites are never
  denied by heuristics alone.
- Site reputation: the first time an origin requests accounts is persisted in
  `packages/features/permissions/src/origin-history.ts` (key `bramble:origin-history`) using an
  injected clock. Approval cards show first-seen, prior-connection, risky-TLD,
  and lookalike insights prominently before the user grants access.

## STRK20 privacy

Bramble implements Wallet API `0.10.4-rc.0` STRK20 through the pinned official Privacy SDK. Viewing
keys stay inside the encrypted vault; actions, relay fees, account, network, pool, and payload digest
are frozen before dedicated approval. No fallback prover or signer exists. Registration and
deposit-only batches may use the public account; other private actions require a relayer. Writes are
serialized before broadcast and prove against mature historical state. See
[STRK20 privacy integration](STRK20_PRIVACY.md) for service contracts, trust boundaries, and operations.

## Krusty KMS

Wallet checks and cryptography require the exact published Krusty KMS WASM package.

```bash
bun install --frozen-lockfile
bun run check
```

`package.json` pins the version and `bun.lock` pins the immutable registry tarball. Before import,
`scripts/check-krusty-adapter.ts` verifies the package metadata, JavaScript and WASM digests, known
wallet vectors, and authenticated Nostr round trip. The build copies those installed runtime bytes
into `dist/dependencies/krusty-kms`.

## Extension

Load `dist/` as an unpacked extension after `bun run build`.
A fresh install opens `onboarding.html` as a dedicated extension tab. It reuses the production
side-panel templates, bindings, encrypted-vault boundary, and Ledger onboarding controller, but
applies the expanded onboarding layout. Updates never reopen the tab. The side-panel first-run
screen retains an explicit full-screen link if setup was dismissed, and successful setup hands the
user back to the Chrome side panel. Click the extension action for the normal wallet surface.

Release zips and SHA-256 checksum files are written to `artifacts/` by
`bun run package:extension`.

CI uploads those same files as the `bramble-extension` workflow artifact.

Cutting a release and submitting to the Chrome Web Store is documented in
[`RELEASING.md`](RELEASING.md): pushing a `vX.Y.Z` tag runs
`.github/workflows/release.yml` to publish a GitHub Release with the packaged
zip + checksum, and an optional, currently-disabled job can publish to the
Chrome Web Store once a store account and secrets exist.

## Transaction replacement

Starknet has no mempool fee-bump or replace-by-nonce as of RPC 0.8: once
broadcast, a transaction is accepted, reverted, or dropped, and cannot be sped
up, replaced, or cancelled. Pending activity rows surface this with a hint line
and a tooltip; they typically settle within a few minutes. If a transaction is
dropped, the next transaction on that nonce proceeds normally. This is a protocol
constraint, not a wallet limitation.

## Multisig

Settings → Multisigs manages true Argent M-of-N account contracts. Argent Multisig does not keep an
on-chain proposal/confirmation queue: one final `INVOKE` carries exactly the threshold number of
member signatures, sorted by Argent signer GUID. Bramble therefore stores public, frozen V3
signing intents—not OpenZeppelin proposal ids—and never places a multisig in the encrypted
single-signer `AccountRef` registry.

- Watch: the wallet requires the pinned class and reads `get_threshold`, `get_signer_guids`, and
  signer membership from chain before accepting or signing an intent.
- Prepare: the background freezes calls, sender, chain, nonce, resource bounds, tip, data
  availability modes, paymaster/account-deployment data, and the resulting transaction hash.
- Sign: every fragment is verified against that exact hash, current on-chain membership, and the
  frozen signer snapshot. Duplicate, foreign, malformed, or out-of-order signatures are refused.
- Submit: only a threshold-complete signature array is serialized and broadcast with the exact
  prepared V3 fields. Nothing is re-estimated or silently changed after review.
- Deploy: the native Argent account deployment binds the salt, threshold, and GUID-sorted signer
  set. Self-deployment uses the contract's dedicated single-member deploy signature.

Pinned Argent Multisig 0.2.0 class hash:
`0x07aeca3456816e3b833506d7cc5c1313d371fbdb0ae95ee70af72a4ddbf42594`;
compiled class hash:
`0x010972dc21f31635a6e90d524295e4e356a565e21dd1dbe986c476dbe9d0f8c9`.
`bun run vendor:argent && bun run check:argent` verifies the exact upstream release commit and all
official ABI/Sierra/CASM digests without copying GPL contract artifacts into the extension bundle.
The verification checkout retains upstream's GPL-3.0 license under the ignored `vendor/` directory;
the distributed extension contains only class identifiers and independently implemented ABI wiring.

## Allowance manager

Settings → Allowances lists the ERC20 approvals this wallet granted — the active account's own
plus any a watched multisig it signs for executed (read-only: those need a separate signing intent) — and revokes
one with `approve(spender, 0)` through the verified send path. Every submitting path files what it
granted; the store applies the arithmetic (`applyDelta`, one serialized read-modify-write) where
`approve` sets, an increase adds, a decrease subtracts, and a delta over an unseen base stores
`lowerBound`, shown as "at least N". Each record's live `allowance(owner, spender)` is then read
directly and adopted when it is at least the tracked figure. Collection approvals are excluded and
reviewed as their own kinds: an ERC721 `approve` carries a token id, so a "revoke" would approve
item 0. The store `bramble:allowances` sits outside the vault.

## NFT gallery (parked: tab, menu entry, and indexer setting hidden; home loads no NFT data)

The gallery merges auto-discovered collectibles with watched `nfts` preferences (contract, token
id, network, optional label, spam flag).
Indexer claims are re-proved on-chain against the active account before display; explicitly
watched NFTs also resolve ERC-721/1155 metadata without auto-fetching attacker-controlled airdrop
URLs. The detail screen shows the resolved artwork and attributes, then sends through a two-phase
review → confirm flow. Review re-proves ownership, detects ERC-721 versus ERC-1155, decodes the
exact call, screens the recipient, and estimates the fee without broadcasting. Confirmation
repeats those checks immediately before the verified invoke submission.
While parked, no view hydrates NFT data: neither watched-NFT metadata nor indexer discovery runs,
and a saved `nftIndexerUrl` is unused and unsettable. Restore the entry points, `bindNfts`, indexer
setter, and gallery-only hydration together; then remove the parked-view guard/test and cover no-unprompted egress on restored routes.
Ownership proofs stay untrusted-first whenever it does: concurrent refreshes for the same account
share the in-flight request, account switches remain isolated, and the first visible watched
images are fetched eagerly so the gallery is warm when opened.

## Reproducible Builds
Every build input is pinned: Bun `1.3.3` (`packageManager` + CI), a frozen lockfile,
the exact published Krusty KMS package and both runtime-file digests, the exact Argent
account-contract release and official artifact digests, and GitHub Actions by commit SHA. The
Privacy SDK source and browser
bundle digest are pinned by its vendor/check scripts. Reproduce a release, then compare
`artifacts/*.zip.sha256` against the CI artifact checksum:

```bash
cd artifacts && shasum -a 256 -c bramble-0.2.0.zip.sha256
```
