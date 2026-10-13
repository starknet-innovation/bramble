# Vendor-import test dataset

A mainnet dataset of seed phrases whose accounts span every shape a Ready (Argent) or
Braavos seed can produce, so Bramble's import can be measured against the vendors'
reality rather than its own assumptions. Scripts and the manifest live in this repo;
**the seed phrases themselves are never committed** — they stay in a password manager
and reach the scripts through environment variables at run time.

Interactive combination map ("tree of life"):
https://claude.ai/artifact/2Mba3kTgzJzZkvrWbu7J42

## Runbook — setting the dataset up (state as of 2026-10-02)

Ground rules first: the password manager holds the authoritative copy of every
seed; `.env.vendor-seeds.local` is the scripts' working copy. These phrases are
research material from the day they enter that file — never reuse them for real
funds, keep balances at dust, and never let the words into chat, commits, or
issues (addresses are public and fine).

**Done:** R1 (Ready, 5 accounts: #1 deployed 0.4.0, #2 smart/backend-salted,
#3–5 recorded) and B1 (Braavos, 4 accounts: #1 deployed + 2FA, #2 deployed,
#3 funded-undeployed with 2.3 STRK, #4 recorded). Calibration passed against
both.

**Manual steps remaining (~15 min, ~$10, in the apps):**
1. Ready account 2 (`0x01af449d…`): fund ~$3 and make one outgoing transfer so
   it deploys — that turns the guardian-in-constructor specimen on, and pins
   Argent's real guardian value for every simulated one.
2. Ready account 3 (`0x04e0c443…`): send ~2 USDC and **nothing else** — it is
   currently empty. Its whole purpose is holding only a token the ETH/STRK
   balance probe cannot see. Never transact from it.
3. Optional: X1 — generate a fresh seed, import it into both apps, record one
   address per app. Two minutes, no funds.

**Script seeds (2 min, no apps):** generate one fresh 12-word phrase per empty
slot (`READY_MATRIX`, `BRAAVOS_MATRIX`, `GAPS`, `SEED_DEPLOYER`) — the
calibration project has `gen-seed.ts` for this — store each in the password
manager, paste into the env file. These seeds never touch a vendor app; the
Phase-3 script derives and deploys everything from them.

**Deployer funding (~$150, after the seeds exist):** the script derives the
deployer account from `BRAMBLE_DATASET_SEED_DEPLOYER` and prints its address —
no raw private key changes hands. Send roughly $110 in STRK (all v3 fees are
paid in STRK, and most fixture dust is STRK), $20 in ETH, $20 in USDC. Expect
most of it to stay locked in fixtures permanently.

**Then hands off:** Phase 3 deploys the matrix and writes the manifest;
verification is `bun run build`, load `dist/` at `chrome://extensions`, import
each seed on the recovery screen, and diff what it lists against the manifest.

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

## Phase 2 status — calibration PASSED (2026-10-02)

An independent reimplementation (scratchpad `dataset/calib/derive.ts`; @scure/bip32,
@scure/bip39, @scure/starknet, starknet.js — no Krusty) reproduced the ground-truth
seeds' recorded addresses on the first run:

- **Braavos**: all four recorded accounts match the vendor derivation at indices 0–3,
  with deploy class `0x03d16c7a…` (the table's "braavos 1.0.0") — the current app
  does **not** use the `0x13bfe…` base class for its counterfactual addresses. Live
  class of the two deployed accounts: `0x3957f9f5…` ("braavos current"). The
  funded-undeployed account is confirmed undeployed on chain.
- **Ready**: recorded accounts 1/3/4/5 match the **double derivation** at indices
  0/2/4/5 (live class 0.4.0 for the deployed one). The smart (email-guardian)
  account consumed index 1 and its backend-salted address matches no computed shape,
  as predicted. The smart account (key index 1, backend-salted address
  `0x01af449d…`) is now deployed at 0.4.0 and the D4 case is proven end to end:
  its address matches no computable shape, yet `get_owner` equals the
  double-derivation index-1 pubkey exactly — the account provably belongs to the
  seed while remaining invisible to address probing. Argent's real guardian value,
  the reference for every simulated guardian in the matrix:
  `0x7601f48c44bb108938ab8cc1578d0696cf17c04715b93f607757af07faa7e9b`
  (plain felt, `get_guardian_backup` 0). Separately, R1 account 3 (`0x04e0c443…`,
  key index 2) was discarded in the Ready UI — the seed still controls it, making
  it the "hidden in vendor UI, still the seed's account" specimen; the USDC-only
  fixture moves to the matrix seeds. Index 3 was burned by an **aborted** "create smart account" flow —
  backing out of the dialog still consumes a key index, so real-world index gaps
  arise inside one vendor session without the user ever seeing an account.
- **Empirical verdict on Bramble today**: on the Braavos seed it finds exactly
  account #1 (index 0, the single overlapping coordinate) and misses #2–4; on the
  Ready seed it finds **nothing at any index** — the double derivation means no
  Ready software key ever appears on Bramble's ladder. Fix direction: derive Argent
  scan shapes through the ETH-seeded scheme (Krusty's `deriveArgentLegacyKeypair`)
  on the address axis.

## Phase 3 status — matrix live on mainnet (2026-10-02)

34 fixtures, zero errors, every detectability class represented (D1 ×4, D2 ×20,
D3 ×4, D4 ×3, D5 ×3): the class-era and upgrade ladder, funded-undeployed
probes in ETH/STRK/native USDC, used-and-emptied, gap and past-window indices,
simulated guardian states (set / removed / escape pending / owner-escape
pending), Braavos deploys at both indices plus 2FA-at-deploy with a real P-256
key, custom-salt and UDC-unique D4 shapes, a funded custom-salt counterfactual
(D5), the 25th-word fixture, a Bramble-axis control, the cross-vendor account,
and the nine app-made ground-truth accounts. Ledger of record:
`tools/vendor-dataset/manifest/` (one file per fixture group). Two Braavos tooling facts worth keeping:
fee estimation must run with validation on (the constructor parses the
signature, so SKIP_VALIDATE's empty signature reverts), and the deploy
signature carries the full `AdditionalDeploymentParams` struct poseidon-signed
out-of-band. Pending: owner-rotation pass 2 after the escape security period,
and the verification run against a Bramble build.

## Phase 4 — first verification run (2026-10-02): 4/34

The built wallet (release/v0.10.5 head) imported every dataset seed through its
real onboarding UI against live mainnet (`tools/vendor-dataset/verify-dataset.ts`,
scorecard in `verification.json`). It surfaced **exactly the four D1 fixtures
and nothing else** — every fixture behaved as its detectability class predicts,
with zero off-class results:

- **Found (4, all D1):** the Bramble-axis control, the two scripted Braavos
  index-0 accounts, and the real app-made Braavos #1 ("Deployed · view only").
- **Missed (20 × D2):** everything behind the derivation bugs and table gaps —
  the entire Ready population (both real and scripted, #505), Braavos index 1+
  (vendor axis), the gap fixture at index 7.
- **Missed (4 × D3):** the USDC-only and past-window fixtures — richer probes
  (#504 covers `gaps/25`).
- **Missed (3 × D4, 3 × D5):** confirmed unreachable without an indexer /
  confirmed invisible, as designed.

The scorecard doubles as the acceptance test for the fixes: #505 should flip
the twenty D2 rows, #504 flips `gaps/25`, probe work flips the remaining D3s,
and D4 stays a deliberate architecture decision. One command re-runs it.

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
