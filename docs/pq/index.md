---
layout: default
title: Post-quantum mobile signer
permalink: /pq-mobile-signer/
---

# Post-quantum mobile signer

A Starknet account whose signing key is an ML-DSA-65 key generated inside a phone's secure
hardware and released only for a biometric-approved signature. The phone behaves like a Ledger:
the wallet holds no key, parks a hash, and receives a signature it verifies before broadcast.

**Status:** design, proof of concept. Not a shipping product.

## Ownership

| Area | Owner |
| --- | --- |
| ML-DSA account contract, on-chain `__validate__` | Cairo (separate track) |
| Wallet refactor, transport, mobile app | This document |

The account contract exists and validates ML-DSA-65 signatures: `MlDsaHashKeyAccount` in the
`ml-dsa-cairo` repository, settled on the `hashkey` variant. It has had no reviewed release and no
audit, which is the only reason it stays on devnet.

## Accepted proof-of-concept trade-offs

Decided deliberately. Do not re-open without a product decision.

- The signing key is hardware-bound and non-exportable, so it cannot be derived from a mnemonic.
  **Losing the phone loses the account.**
- No session keys. The phone approves every transaction.
- No guardian, social, or timelocked recovery.
- Blind signing in the first iteration: the phone recomputes and compares the transaction hash but
  does not yet decode calldata semantically.

## Milestones

This is a proof of concept, and it has to be workable long before any of it is merged. The
milestones are ordered so that **no upstream krusty-kms change is required until M2**, and even
then it is developed locally against a working tree rather than a pinned commit.

| | Milestone | Needs upstream? | Proves |
| --- | --- | --- | --- |
| **M0** | Plumbing spike. Mobile app plus copy/paste transport driving the *existing* `signStarkHash` against an ordinary OZ account on Sepolia. | No | The round trip, the sign queue, the approval UI. Zero refactor anywhere. Delete afterwards. |
| **M1** | Real ML-DSA, blind, **no phone**. Fixture keys, real 1952/3309-byte payloads, clipboard transport, JSON envelope, stub devnet account. | **No** | Every size-driven refactor in Part 1, against real numbers. |
| **M2** | Phone recomputes the transaction hash. | Yes — tx-hash in the C ABI | The trusted display. **This is where the work is now.** |
| **M3** | Hardening for review: CBOR codec in Rust, relay transport, `check:krusty` reconciled against a pushed commit. | Yes | PR readiness. |

**M0 was skipped and M1 is closed.** M1 turned out to need no phone at all, which made the throwaway
rehearsal in M0 worthless. The crypto that M3 was going to carry — key expansion, commitment,
verifier, hints — was pulled forward and landed in krusty-kms on 2026-08-31, so M2 is the only
milestone with an open upstream dependency, and it is a mobile one.

M1 is the milestone that matters. It exercises the widened signature type, the account contract
family, the vault migration, the queue, and the message-shape validators — the entire risky half of
Part 1 — with no upstream work at all, because a blind-signing device needs no hash function and a
JSON envelope needs no shared codec.

### M1 needs no phone, and should not wait for one

Everything up to a working extension is built and tested without a mobile app. The clipboard
transport carries a hex string in each direction, and `py/account_tool.py` in the contract
repository produces exactly what a phone would:

1. `keygen --seed <32 bytes>` gives a stable 1952-byte public key. That is the fixture device.
2. Enroll it through the **add-existing-device** path: paste the public key, paste a signature over
   the extension's challenge as the proof of possession.
3. Build a transfer. The sign takeover shows the transaction hash with a copy control.
4. `sign --seed <same> --msg-hash <that hash> --deterministic` produces the 3309-byte signature.
5. Paste it back. The verify gate checks it against the enrolled key and the submit proceeds.

That is a real end-to-end loop, not a stub: real ML-DSA keys, real signatures, real verification.
The tool self-checks through two independent FIPS 204 implementations before emitting anything, and
`--deterministic` makes every fixture reproducible.

**No dev-only entry point is needed for this.** The add-existing-device path is required for its own
sake — without it a reinstall is indistinguishable from losing the phone — so the shipping path is
also the fixture path. That is the same reason the clipboard transport is kept permanently rather
than deleted after M1.

**What the phone is still needed for** is validating the claims a fixture cannot: that the enclave
key is genuinely non-exportable, that the biometric gate is platform-enforced, and which hardware
supports enclave-backed ML-DSA at all. None of that is wallet code, and all of it can follow a
working extension.

### Where this stands · 2026-08-31

Built, tested, and exercised end to end against a locally declared build of the real account
contract — no stub, and no phone.

| | |
| --- | --- |
| Signature seam | `AccountSignature` is a discriminated union; `StarkHashSigner` is now `AccountHashSigner` |
| Account model | one `ml-dsa` family, vault schema v8, no contract variant on the record |
| Enrollment | challenge first, proof of possession verified before anything is written, single-use |
| Address derivation | the key commitment is computed from the public key through krusty-kms |
| Transaction calldata | the full 1830 felts, assembled and identity-checked before broadcast |
| Fee estimation | query-version dummy, validation enabled, **zero biometric prompts** |
| Deployment | works — deploy then transfer, verified on devnet |
| Crypto | Rust, in krusty-kms; no post-quantum JavaScript in the bundle |

What is **not** done, in the order it blocks things:

1. **Transaction-hash functions in the C ABI** (`packages/kms-c/include/kms.h`). Until this exists the
   phone can only blind-sign, so its approval screen cannot prove the hash belongs to the transaction
   shown. **This is the mobile track's first task**, and nothing in the wallet waits on it.
2. **The mobile app.** Nothing of it exists yet.
3. **The enrollment challenge lives in service-worker memory**, so it dies while the user is on their
   phone. It belongs in `chrome.storage.session`. Small, and it shapes how long a phone-side flow may
   take.
4. **The pinned krusty revision is a local commit.** `bun run vendor:krusty` therefore fails on any
   other machine and in CI until the krusty branch is pushed and the pin re-pointed.
5. **The account class has no reviewed release**, so enrollment still asks for a class hash and the
   contract stays off Sepolia and mainnet.

> **Handing over to the mobile track**
>
> Everything the phone has to agree with is settled and implemented on the wallet side: ML-DSA-65,
> a 1952-byte public key, a 3309-byte signature, the message is the transaction hash as **32
> big-endian bytes** with an **empty FIPS 204 context**. The wallet sends the full transaction and
> never a bare hash, and it verifies whatever comes back before broadcast.
>
> The phone returns the **raw 3309-byte signature only**. It never sees the 925-felt packed key, the
> `w`/`M'`/`K'` witnesses or the 1830-felt calldata — the wallet derives all of that. So the phone's
> job is: hold the key, recompute the hash, display it, sign 32 bytes on biometric approval, return
> 3309 bytes.
>
> Its one upstream dependency is item 1 above.

## Parts

- [Part 0 — Shared contract](shared-contract/) is the crypto parameters, wire format, upstream
  krusty-kms surface, daily Rust/TypeScript working practice, and the stub account. Everything
  else depends on it.
- [Part 1 — Wallet](wallet/) is the account model, signature types, vault migration, signer seam,
  sign queue, fee estimation, message shapes, and UI. Buildable at M1 with no upstream change.
- [Parts 2 and 3 — Transport and mobile app](transport-and-mobile/) is the transport contract,
  measured payload sizes, and the phone-side implementation.

---

# Registration, end to end

The one flow that crosses every part. Specified once here so no part describes only its own slice.

1. User selects **Post Quantum Secure with your Biometrics** in the side panel.
2. Extension generates a random 32-byte challenge and shows a `PairingOffer`.
3. Phone generates an ML-DSA-65 key in the secure enclave, gated on biometrics.
4. Phone returns `PairingResult`: device id, public key, and a signature over the challenge.
5. **Extension verifies the proof of possession.** If the phone returns a key it cannot sign for,
   the derived address is unspendable and any funds sent to it are permanently stranded. This step
   is what prevents that.
6. Extension derives the key commitment from the public key, derives the counterfactual address from
   the class hash and that commitment, and stores the record as undeployed.
7. User funds the address.
8. Extension builds the `DEPLOY_ACCOUNT` v3 transaction and requests a signature.
9. Phone signs — the second biometric prompt of onboarding.
10. Extension verifies, broadcasts, and marks the account deployed.

**All ten steps run today**, with `account_tool.py` standing in for the phone at steps 3, 4 and 9.
The deploy transaction is validated by the account's own key, so **the device signs twice during
onboarding**: once for the proof of possession and once for the deployment.

> **One value is still pasted, and it is temporary**
>
> The **class hash**, because the contract has no reviewed release to pin. When it has one, that
> becomes a constant beside the OpenZeppelin and Argent pins and the field disappears.
>
> A second field used to be pasted — the `key_hash` from `deploy-data` — and it is gone, because the
> wallet derives the commitment itself. It is deliberately *not* stored on the account record either:
> a stored copy would be a second source of truth. The record's `publicKeyX` *is* that commitment,
> and the vault refuses any record where it disagrees with the stored public key.

Steps 5 and 8 are the two most commonly omitted. The deploy transaction is validated by the
account's own key, so the phone signs twice during onboarding.

# Rejected alternatives

Recorded so they are not re-proposed. Each entry names what would change the answer.

**A QR return path — phone screen read by the extension's webcam.**
Scored best on "no third party" and was carried too long for that reason. It is a hardware-wallet
airgap ritual, not something a side-panel wallet user does per transaction. The wallet
structurally needs data back — proof of possession, the deploy signature, every signature after
that — so the return path must be a real bidirectional channel. QR keeps exactly one job: the
one-time pairing bootstrap, extension displays and phone scans, which is the ordinary
WhatsApp-Web gesture and the one moment an optical channel genuinely earns its place.
*Would change if:* never, for this product.

**BLE as the first transport.**
No third party, and `packages/platform/ledger-browser` already has the Web Bluetooth transport. But
stable Chrome cannot enumerate paired Bluetooth devices for a silent reopen, so every operation
re-pairs through Chrome's native chooser in a dedicated tab — the user picks their phone out of a
Bluetooth list for every transaction. The team already paid this cost with Ledger and documented it.
*Would change if:* Chrome ships `Bluetooth.getDevices()` outside a flag.

**Sign-and-forget — phone submits the transaction, no signature returned.**
Tempting because `WalletExecutor::execute` hides it entirely and it skips the `Account` and
`AccountFactory` work. Rejected on three counts: it permanently loses off-chain signatures
(SNIP-12 dapp login, `fold_strk20_viewing_key`, multisig coordination envelopes) and SNIP-9
outside execution; a failed submit leaves the extension polling a hash that will never appear,
with no artifact to retry from; and the extension picks the nonce while the phone submits seconds
later. It also relocates transaction construction and RPC onto two mobile platforms rather than
deleting work.
*Would change if:* the product drops off-chain signing entirely.

**A placeholder signature scheme — Stark ECDSA or P-256 standing in for ML-DSA.**
Rejected because nearly every refactor in Part 1 is driven by *size*: 1830 felts of signature, 1952
bytes of public key, message-shape validators, transport chunking. Stark ECDSA is two felts and
P-256 is four — either passes every one of those refactors without exercising one of them, so the
work would be done blind and the real constraints rediscovered later. Phone code written against
`SecureEnclave.MLDSA65` is also the final code; against P-256 it is throwaway. **Substitute the
account contract instead** — see [the stub account](shared-contract/#the-stub-account).
*Would change if:* nothing. This is the reasoning behind M1.

**Defining the wire format in TypeScript.**
Would need re-implementing in Swift and Kotlin. Three hand-written serializers drift, and the
drift presents as signature verification failures nobody can localise.
*Would change if:* the project ever has only one non-Rust consumer.

# Open questions

- ~~**Which ML-DSA contract an account uses.**~~ **Settled: `hashkey`**, confirmed 2026-08-27, and
  the wallet now models only that one. The `mlDsaKind` discriminator, the per-contract table, and
  the enrollment screen's contract picker were all removed on 2026-08-28: an ML-DSA account record
  carries no contract variant, its address is derived from the class hash and the key commitment,
  and the enrollment form asks for the commitment unconditionally. See
  [the account contract family](shared-contract/#the-account-contract-family).
- ~~**Porting the key expansion and signature hints.**~~ **Done, and in Rust as of 2026-08-31.**
  `krusty_kms_crypto::ml_dsa` behind an off-by-default `ml-dsa` cargo feature, reaching the wallet as
  four `wasm_bindgen` exports — `mlDsaKeyCommitment`, `mlDsaVerify`, `mlDsaSignaturePayload`,
  `mlDsaEstimationSignature`. See [what landed](shared-contract/#what-landed).

  It was prototyped in TypeScript first (`ml-dsa-core.ts` + `ml-dsa-math.ts`, both now deleted),
  because the krusty loop — pinned revision, pinned rustc, rebuilt wasm, digest-pinned glue — is not
  one to debug an NTT through. Nothing in it is secret-dependent, which is what made that interim
  placement admissible.

  The consequence for the wallet's dependencies: `@mc-wallet/starknet` is back to exactly the four it
  had before this work. `@noble/post-quantum` and `@noble/hashes` are both gone from it, and the
  extension bundle carries no post-quantum JavaScript. Noble remains only in `@mc-wallet/testkit`,
  signing fixture devices so the Rust verifier is checked against an independent implementation.

  Note that the contract repository's own test vector cannot serve as a fixture *device*:
  `gen_vectors.py` generates its key with a random `keygen()` and never records the secret key, so
  nobody can produce the proof of possession enrollment requires. It serves perfectly as a
  known-answer vector, which is what it is used for. A fixture device still has to be a key
  generated with `keygen --seed` and kept.
- **Pinning the class.** `hashkey` shares one class across every account, so there will be a single
  hash to pin once the contract has a reviewed release. Until then enrollment asks for it.

  Compiling the contract repository's current `account_hashkey/` source gives
  `0x430e051d9ed7ca553ed4b8dc7e8cfc16400d13fc9b0d4279206687c2059356f`, which is what the wallet has
  been tested against. Note that the class hash quoted in the contract repository's own
  `docs/architecture.md` is a *different* one — that account was deployed to Sepolia about 38 hours
  before the query-version tolerance landed, so the live class predates the fee-estimation behaviour
  described alongside it. Take the hash from compiling the source, not from the prose.
- **Chain binding.** Accounts are per-network records. Does one enclave key back accounts on
  several networks, or is there a key per network? Either way the phone must refuse to sign for a
  chain it was not registered against.
- **Relay choice**, if part 2 reaches step 2. Nostr relays with multi-relay publishing satisfy
  "no server we operate"; a single operated relay is simpler. Product decision.
- **Decoder sharing.** `sign-request-decode.ts` decodes SNIP-12 in TypeScript for the extension. If
  the phone is to show the same review, that decoder is extracted to Rust and shared. Until then
  the phone verifies the hash but does not explain it.

# Non-goals

Session keys and delegated signing. Recovery beyond re-pairing the same phone. Multi-device
enrollment. Paymaster and SNIP-9 outside execution. Mainnet or Sepolia deployment of the stub
account.
