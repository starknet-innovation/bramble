# MC Wallet

Browser extension wallet scaffold for Starknet, built with Bun and TypeScript.

## Status

This repository starts with the extension shell, strict checks, encrypted storage primitives,
permissioned store access, migration tests, and a Krusty KMS WASM adapter boundary.

Krusty KMS is required for wallet cryptography. Its upstream README currently marks the project
experimental and not suitable for production or security-critical use, so this repo does not add a
local signing fallback.

## Commands

```bash
bun install
bun run vendor:krusty
bun run vendor:multisig
bun run check
bun run test:e2e:install
bun run build
bun run test:e2e
bun run package:extension
```

## Architecture

- `src/background` owns privileged state, approvals, unlock sessions, and vault service wiring.
- `src/content` and `src/provider` bridge page requests to the background without exposing signing
  or vault operations to dapps.
- `src/storage` owns encrypted persistence, permission checks, schema validation, and migrations.
- `src/crypto` adapts Krusty KMS and rejects invalid inputs or WASM outputs at the boundary.
- `src/ui` defines the design system: the replaceable color skin contract plus the shared scale
  tokens (spacing, radius, type, motion, control metrics) consumed by side panel styling.

## Tokens, Prices, and Spam Filtering

Token tracking spans a few narrow modules:

- Custom tokens: the privileged `wallet.addToken { address }` message reads `name`, `symbol`, and
  `decimals` on-chain through `getTokenMetadata` in `src/starknet/rpc.ts` (felt short-string and
  Cairo ByteArray decoding), normalizes the symbol, and stores it through `preferencesStore`. The
  UI lives on the tokens flow (`src/sidepanel/token-flows.ts`), reachable from the home Balances
  header and Settings.
- Auto-detection: `src/starknet/token-registry.ts` vendors a curated mainnet registry (ETH, STRK,
  USDC, USDT, DAI, WBTC). `wallet.detectTokens` probes `balanceOf` for registry tokens not yet
  tracked and returns held ones as one-tap suggestions. Registry addresses marked `VERIFY` are
  advisory; a wrong address simply fails its probe and is never surfaced, and detection never
  authorizes a transfer.
- Spam filtering: the same registry module exports heuristics (registry-symbol spoofing with
  confusable folding, absurd decimals, empty names). Flagged tokens are hidden from home by
  default; the tokens flow reveals them with a warning. A backwards-compatible optional
  `hiddenTokens` preference (like `rpcOverrides`) records user hide/show choices.
- Prices: `src/starknet/prices.ts` fetches CoinGecko `simple/token_price` and `market_chart` for
  the `starknet` platform (host permission `https://api.coingecko.com/*`), cached in storage with a
  ~5 minute TTL behind an injected clock. Fetching happens only in the background worker through an
  injected `fetch`; every failure degrades to cached-or-empty so the UI omits fiat when offline.
  Home balance rows and the hero portfolio total use `preferences.displayCurrency`.
- Token detail: tapping a balance row opens a detail flow with the current price, a self-drawn
  7-day SVG sparkline (`src/sidepanel/sparkline.ts`), holdings, and contract facts.

Known limitations (v1): registry coverage is mainnet-only and address-verified from public token
lists; fiat prices depend on CoinGecko's Starknet coverage and address normalization, so some
tokens show no price; spam-flagged tokens cannot yet be force-pinned to home (they stay on the
tokens flow); custom tokens whose on-chain symbol is not a `[A-Z0-9]{2,12}` ticker are rejected;
there is no dedicated remove-token action (hide instead).
## Account class

Accounts use the OpenZeppelin `AccountUpgradeable` preset, pinned by Krusty KMS.

- Preset: OpenZeppelin `AccountUpgradeable`, Cairo `openzeppelin_presets` v3.0.0.
- Pinned class hash:
  `0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381`
  (identical on Mainnet and Sepolia). Source of truth: the vendored Krusty KMS
  manifest `crates/kms/src/oz_account_class_manifest.json` at the commit pinned
  in `scripts/vendor-krusty.ts`. Address derivation matches `ozAccountDeployment`
  in `src/starknet/deployment.ts` (constructor `constructor(public_key: felt252)`).
- Audit: OpenZeppelin Contracts for Cairo audit reports —
  <https://github.com/OpenZeppelin/cairo-contracts/tree/main/audits> (API docs:
  <https://docs.openzeppelin.com/contracts-cairo/3.x/api/account#AccountUpgradeable>).

### Verification

Verified DECLARED on both networks with `starknet_getClass` against the Cartridge
endpoints on 2026-07-07 (RPC spec `0.10.2` mainnet, `0.9.0` sepolia); the class
resolved with the `UpgradeableImpl` + `AccountMixinImpl` ABI on both. Re-run:

```bash
for NET in mainnet sepolia; do
  curl -s -X POST "https://api.cartridge.gg/x/starknet/$NET" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClass","params":{"block_id":"latest","class_hash":"0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"}}' \
    | head -c 80; echo " <- $NET";
done
```

A non-empty `result` (not a `Class hash not found` error) confirms the class is
declared. If the RPC endpoint is unreachable from a sandbox, run the command from
a networked host and expect the same result.

## Migration Workflow

1. Bump `CURRENT_SCHEMA_VERSION` in `src/storage/vault-schema.ts`.
2. Add one adjacent step to `VAULT_MIGRATIONS` in `src/storage/migrations.ts`.
3. Update schema validators and tests for old, current, and invalid vault data.
4. Run `bun run check`, `bun run build`, and `bun run package:extension`.

The vault schema is currently at **v2**. v2 adds a `mnemonic: string | null` field so the
wallet can derive more accounts and reveal the recovery phrase after re-authentication. Vaults
migrated from v1 (which never stored the phrase) carry `mnemonic: null` and cannot add accounts or
reveal a phrase until re-created; each migration step advances exactly one version
(`v0 → v1 → v2`) so a v1 vault produces a v1-shaped value before the v1→v2 step attaches the null
phrase. `mnemonic` only ever exists inside the encrypted vault envelope.

## Account Lifecycle and Secret Reveal

- **Backup verification (onboarding).** Generating a fresh phrase reveals confirmation inputs for
  words 3, 7, and 11. Those positions are deterministic on purpose: randomness would need a
  clock/entropy boundary that repo standards keep out of pure UI code, and fixed positions keep the
  predicate (`verifyBackupWords` in `src/sidepanel/backup-verify.ts`) pure and exhaustively
  testable. Create stays disabled until the words match. Pasting an existing phrase skips
  verification.
- **Add account.** `wallet.addAccount { networkId }` (privileged, session-authenticated) delegates
  to `WalletVaultService.addDerivedAccount`, which derives the next unused `accountIndex` for that
  network from the stored phrase, appends the account plus its signing key, and selects it.
- **Reveal seed / export key.** `wallet.revealSecrets { vaultPassphrase }` is privileged, requires
  the passphrase re-entered in the message (never the cached session), verifies it via `readVault`,
  and returns `{ mnemonic, privateKey }` for the active account. The settings-reachable reveal
  screen re-authenticates, warns strongly, blurs the values until tapped, and never persists them —
  they are wiped on the next render. `tests/key-boundary.test.ts` sanctions this reveal only for an
  extension-page sender with the correct passphrase.

### Import private key (not shipped)

Importing a raw private key is intentionally omitted. Krusty KMS exposes no
private-key-to-public-key derivation, so the wallet cannot compute an imported key's public key or
account address without adding local key-derivation crypto — which `CONTRIBUTING.md` forbids
("Do not add fallback signing, key derivation, or mnemonic validation code"). Shipping it would
require a new vendored Krusty KMS export and an `"imported"` account-derivation kind across the
schema, validators, and UI. It is deferred rather than shipped half-tested.

## Design System

Side panel styling is layered so each axis can be updated in one place:

- Colors: `Skin` tokens in `src/ui/skin.ts`. Replace `defaultSkin` in `src/sidepanel/index.ts`
  to swap the palette; `applySkin` rejects missing, extra, hidden, or accessor tokens.
- Scales: spacing, radius, type, motion, and control metrics live in `src/ui/tokens.ts` and are
  interpolated into the stylesheet.
- Components: `src/sidepanel/styles.ts` composes tokens into component classes used by the pure
  templates in `src/sidepanel/views.ts`.

Interaction contract: controls keep a constant 1px border and transition only paint properties,
so nothing moves on hover or press; screens animate only when the visible scene changes, and
`prefers-reduced-motion` disables motion entirely. `tests/sidepanel-styles.test.ts` enforces
these rules.

The background broadcasts `wallet.event` messages (`accountsChanged`, `networkChanged`,
`approvalsChanged`) after mutations. The side panel refreshes live from those events, and content
scripts forward `accountsChanged`/`networkChanged` to connected pages through the injected
provider's `on`/`off` subscription API — after re-querying which addresses each origin may see,
so events never leak wallet state to unconnected sites.

## dApp Provider

The injected `window.starknet_mcWallet` object follows the get-starknet/starknetkit
`StarknetWindowObject` shape: `id`, `name`, `version`, an inline `data:` URI `icon`, `isConnected`,
`selectedAddress`, `on`/`off`, `enable`, and `request`. `chainId` is initialized lazily from
`wallet_requestChainId` after `enable` and kept current from `networkChanged` events;
`isPreauthorized()` resolves `true` when the origin already holds an account grant. The object is
frozen and installed as a non-configurable global.

`request` accepts these methods, mapped to safe background messages by `src/provider/bridge.ts`:
`wallet_requestAccounts`/`mc_requestAccounts`, `mc_accounts`, `wallet_requestChainId`,
`wallet_switchStarknetChain`, `wallet_addInvokeTransaction`, `wallet_signTypedData`,
`wallet_getPermissions` (returns `["accounts"]` when the origin is connected, else `[]`), and
`wallet_watchAsset`.

Grants and provider events are isolated per origin: each origin reads only its own accounts
(`wallet.getGrantedAccounts`) and each content script derives page events from its own history
(`pageEventsFor`), so multiple connected sites never observe each other's state.

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
- Phishing blocklist: `src/security/blocklist.ts` vendors a starter blocklist of
  known-bad domains. `wallet.requestAccounts` from a blocklisted origin is
  refused with `origin blocked`. This starter list is intentionally small and
  explicit; replace or extend `BLOCKED_DOMAINS` with a real threat feed for
  production coverage.
- Lookalike heuristics: punycode detection plus digit-substitution,
  hyphen-insertion, edit-distance, and brand-substring checks against a
  protected list (`starknet.io`, `argent.xyz`, `braavos.app`, `cartridge.gg`,
  `ethereum.org`) raise warnings without blocking, so real sites are never
  denied by heuristics alone.
- Site reputation: the first time an origin requests accounts is persisted in
  `src/storage/origin-history.ts` (key `mc-wallet:origin-history`) using an
  injected clock. Approval cards show first-seen, prior-connection, risky-TLD,
  and lookalike insights prominently before the user grants access.

## Krusty KMS

Wallet checks and cryptography require vendored WASM from Krusty KMS.

```bash
bun run vendor:krusty
bun run check
```

The vendor script checks out the pinned Krusty KMS commit in `scripts/vendor-krusty.ts`.
The build requires `vendor/krusty-kms/crates/wasm/pkg` and copies its runtime files into
`dist/vendor/krusty-kms/pkg`.

## Extension

Load `dist/` as an unpacked extension after `bun run build`.
Click the extension action to open the Chrome side panel wallet.

Release zips and SHA-256 checksum files are written to `artifacts/` by
`bun run package:extension`.

CI uploads those same files as the `mc-wallet-extension` workflow artifact.

## Transaction replacement

Starknet has no mempool fee-bump or replace-by-nonce as of RPC 0.8: once
broadcast, a transaction is accepted, reverted, or dropped, and cannot be sped
up, replaced, or cancelled. Pending activity rows surface this with a hint line
and a tooltip; they typically settle within a few minutes. If a transaction is
dropped, the next transaction on that nonce proceeds normally. This is a protocol
constraint, not a wallet limitation.

## Multisig

Settings → Multisigs manages shared accounts built on OpenZeppelin's audited
`MultisigComponent` (Cairo v3.0.0, the version already pinned via Krusty). This
is the governance-style model: each participant keeps their own single-key
account, and submit/confirm/revoke/execute are ordinary invokes from that
account through the existing verified send path — no new client-side
cryptography, no off-chain signature aggregation, and nothing stored in the
encrypted vault (multisig addresses, signers, and proposals are public
on-chain data, kept in the plain `mc-wallet:multisigs` store).

- Watch: adding a multisig by address reads `get_quorum`/`get_signers`
  on-chain and requires the active account to be a signer. Signer sets and
  quorums refresh from chain on the detail screen.
- Propose: single-call proposals (contract, entrypoint, calldata felts, salt).
  The transaction id comes from the contract's own `hash_transaction` view, so
  the wallet never re-implements the Pedersen scheme. Submitting does not
  confirm; the proposer confirms like any other signer.
- Coordinate: proposal ids are copyable and a pasted id can be tracked and
  confirmed from another signer's wallet. Executing needs the original call
  and salt, so it runs from a wallet that has them (the proposer's, today).
  Discovering proposals submitted outside this wallet requires an event
  indexer and is a documented follow-up, like allowances.
- Deploy: new multisigs deploy from the pinned `MultisigWallet` class
  (`contracts/multisig`, a constructor-only shell around the OZ component)
  through the public Universal Deployer Contract with `not_from_zero = 0`, so
  the address depends only on class, signers, quorum, and salt. If the class
  is not declared on the active network, the deploy screen offers a one-time
  user-paid declare of the bundled Sierra artifact, whose class hash is
  re-verified against the pin before signing.

Pinned class (reproduce with scarb `2.18.0` via `bun run vendor:multisig`;
verified by `bun run check:multisig`):

- Class hash: `0xbb216b0643679b992e7953b6ea6f5057804237053e79fdd064cf2b5adea035`
- Compiled class hash: `0x42d945a7f59ead19b20435fbea7d168449299b03d71f8da205517166a2c80c8`

Known limitations (v1): proposals are single-call (`submit_transaction_batch`
is not surfaced); signer/quorum changes go through the custom-call form as
self-calls (`add_signers`, `remove_signers`, `change_quorum`) rather than a
dedicated editor; each confirmation is a separate on-chain transaction with
its own fee, and proposals are public once submitted.

## Allowance manager

Settings → Allowances lists the ERC20 approvals granted through this wallet
(spender, token, amount, account, network) and revokes any with one tap by
submitting `approve(spender, 0)` through the same verified send path as
transfers. Approvals are recorded from decoded `approve` calls when a dapp invoke
is submitted; the plain store lives at `mc-wallet:allowances`, outside the
encrypted vault. Enumerating allowances granted on other sites requires an
on-chain indexer and is a follow-up — only approvals made through this wallet are
tracked today.

## NFT gallery

Home → NFTs is a gallery of watched collectibles, kept as an optional `nfts` list
in preferences (contract, token id, network, optional label, spam flag). Adding
an NFT proves ownership on-chain (`owner_of`/`ownerOf`) against the active account
before it is stored; each NFT has a spam-hide toggle, and the detail screen sends
with `transfer_from` through the same verification + invoke path as transfers.
Limitations (follow-ups): metadata images are not fetched — the extension ships a
tight `host_permissions`/CSP allowlist, so remote image and `token_uri` loading
is out of scope for v1 — and sends use snake_case `transfer_from` only
(`safe_transfer_from` and camelCase entrypoints are not yet probed from the ABI).

## Reproducible Builds

Every build input is pinned: Bun `1.3.3` (`packageManager` + CI), a frozen
lockfile, `wasm-pack 0.13.1`, scarb `2.18.0` (enforced by
`scripts/vendor-multisig.ts`) with exact OpenZeppelin versions in
`contracts/multisig/Scarb.toml`, GitHub Actions by commit SHA, and the Krusty
KMS source at the commit recorded in `scripts/vendor-krusty.ts`. To reproduce a
release, run the Commands section above on those versions and compare
`artifacts/*.zip.sha256` against the CI artifact checksum:

```bash
cd artifacts && shasum -a 256 -c mc-wallet-0.1.0.zip.sha256
```
