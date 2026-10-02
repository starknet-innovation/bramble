# Vendor-import test dataset

A mainnet dataset of seed phrases whose accounts span every shape a Ready (Argent) or
Braavos seed can produce, so Bramble's import can be measured against the vendors'
reality rather than its own assumptions. Scripts and the manifest live in this repo;
**the seed phrases themselves are never committed** — they stay in a password manager
and reach the scripts through environment variables at run time.

Interactive combination map ("tree of life"):
https://claude.ai/artifact/2Mba3kTgzJzZkvrWbu7J42

## Detectability classes

Every account in the manifest carries one:

| Class | Finding it requires |
|---|---|
| D1 | Bramble's probe today: recompute the address (salt = pubkey, guardian = 0), check class + ETH/STRK balance |
| D2 | A table or path extension — the address is recomputable, Bramble lacks the class hash, constructor shape, or derivation |
| D3 | Richer probes — nonce, non-default-token, or NFT checks |
| D4 | An indexer keyed on the derived public key (what the vendors' own backends do). Stashed for a later phase |
| D5 | Nothing — not identifiable from the seed |

A missed account is a bug if its leaf is D1, a backlog item if D2/D3, an architecture
decision if D4, and a confirmation if D5.

## Phase 0 findings — vendor derivation and deploy shapes (2026-10-02)

Sources: `argentlabs/argent-x` at `e3545daa417d` (current `develop`),
`myBraavos/braavos-account-cairo` at `158d7d0befc8`, and the Starknet forum derivation
thread where a Braavos engineer documents both schemes
(community.starknet.io/t/account-keys-and-addresses-derivation-standard/1230).

### Ready (Argent X) software seeds — double derivation, still current

`WalletCryptoSharedService.restoreSeedPhrase` builds
`HDNodeWallet.fromPhrase(seedPhrase)` (ethers → the **ETH key at
`m/44'/60'/0'/0/0`**) and stores that private key as the session *secret*.
`ArgentSigner` then does `HDKey.fromMasterSeed(secret)` and derives
`m/44'/9004'/0'/0/{index}` with standard SHA-256 grinding (`micro-starknet`'s
`grindKey`). Two consequences:

1. **The "legacy Argent X double derivation" is Ready's current scheme.** Krusty's
   `deriveArgentLegacyKeypair` implements it; Bramble never calls it.
2. Bramble derives `m/44'/9004'/{account}'/0/0` directly from the BIP-39 seed, so a
   real Ready software seed matches Bramble's key ladder at **no index at all,
   including 0**. Bramble's Argent *address math* is right; the keys under it are not
   the keys Ready uses. To verify in Phase 1 with a real Ready seed before filing —
   and to check whether the Ready **mobile** app (separate codebase) derives the same
   way as the extension.

Ready multisig signer seats live at `m/44'/9004'/1'/0/{index}` on the same
ETH-seeded tree. Ledger paths (extension): standard
`m/2645'/1195502025'/1148870696'/0'/0'/{i}`, multisig `…/1'/0'/{i}`.

### Braavos software seeds — standard derivation

Per the Braavos engineer's forum post: master node straight from the mnemonic
(BIP-39 seed → BIP-32), path `m/44'/9004'/0'/0/{index}`, standard grinding. So:

- Braavos account #1 (index 0) **coincides** with Bramble's `(account 0, address 0)`
  coordinate — the only point of overlap.
- Braavos accounts #2+ sit on the **address axis**, which Bramble's scan (which
  iterates the hardened *account* field) never visits.

### Deploy shapes

- Ready standard: `DEPLOY_ACCOUNT`, deployer 0, **salt = stark pubkey**; constructor
  per era exactly as `account-families.ts` documents (0.3.x `[owner, 0]`, 0.4.0
  `[signer, owner, guardian: None]`). Class constants in argent-x stop at 0.4.0 —
  0.5.0 (known to Krusty) is not in the extension's creation path; treat as
  specimen/verify. Cairo 0 era: proxy `0x25ec026…` over impls 0.2.1–0.2.4, salt =
  pubkey, cairo0 constructor shape.
- Ready smart (email guardian): the **backend chooses both the salt and the
  address** (`addSmartAccountResponse.address/.salt`, guardian in the constructor).
  Doubly unrecomputable from the seed → firmly D4. A scripted simulation (our own
  guardian key) reproduces the on-chain shape but not Ready's salt policy; keep one
  real app-made specimen beside every simulation.
- Ready multisig: salt = the creator seat's pubkey, constructor carries threshold +
  full signer set — recomputable only with knowledge of all seats → D4 for any
  single seed.
- Braavos: base class → self-upgrade inside the deploy transaction, with
  Braavos-specific auxiliary signature fields (see `braavos-account-cairo`;
  Bramble's `braavos-deployment.ts` already models this).

### How the vendors themselves discover accounts

Ready (`WalletRecoveryStarknetService.restoreAccountsFromWallet`): derives pubkeys in
windows of 20 and **keeps scanning the next 20 while a window found anything** (the
gap-limit rule Bramble adopts in #504); per key it checks standard addresses across
all class ladders on chain, and resolves smart accounts and multisigs by **pubkey
against Argent's backend** (`ARGENT_SMART_ACCOUNT_DISCOVERY_URL`,
`getStandardAccountDiscoveryUrl`) — the production D4 oracle.

### Open verify items

- Can a still-declared Cairo 0 class be instantiated by a v3 `DEPLOY_ACCOUNT` /
  UDC call on current mainnet? Decides whether Cairo 0 cells are scriptable or
  specimen-only.
- Ready mobile vs extension derivation parity (Phase 1, same seed in both).
- Argent 0.5.0: deployed by any Ready surface yet, and its constructor shape.
- Braavos 1.1.0 implementation: does `isKnownAccountClass` reject it live?
- Braavos withdrawal-limit / deferred-removal state surfaces for the manifest.

## Phases

0. **Research** (this document): pin derivation + deploy shapes from vendor source.
1. **Ground truth** (manual): fresh seeds in the real apps on mainnet; record every
   address the app shows; deploy a few; create the backend-assisted states (email
   guardian before first deploy, Braavos 2FA/3FA). One real specimen per simulated
   backend state.
2. **Calibration**: the dataset script must reproduce the Phase-1 addresses from the
   same seeds before it is trusted. Derivation is reimplemented from vendor source —
   never through Krusty — so the dataset stays independent of the code under test.
3. **Scripted matrix**: deploy the scriptable cartesian product on mainnet; write the
   manifest (`seed`, `index`, derivation, class at deploy, live class, address,
   lifecycle, `backed-by: none | vendor-backend | simulated`, expected outcome).
4. **Verification**: import each seed into Bramble and diff the recovery screen
   against the manifest.

## Index-slot convention

Within one seed, the derivation index selects the scenario (index 0 plain deployed,
index 1 upgraded, index 2 funded-undeployed in USDC only, index 7 after a gap, …), so
one import renders a whole ladder on one recovery screen and the manifest reads
index-by-index. Discovery scans the whole window automatically; the axis mismatch
above is itself an expected-miss entry, not a dataset flaw.
