---
layout: default
title: PQ signer — shared contract
permalink: /pq-mobile-signer/shared-contract/
---

[Post-quantum mobile signer](../) · overview, milestones, and cross-cutting flows

# Part 0 — Shared contract

Everything in parts 1 through 3 depends on this section. It is written first because a
disagreement here surfaces as a signature that fails to verify with no useful error.

Agreeing this contract is not the same as building it. Most of it is a target the proof of
concept converges on — see [Milestones](../#milestones) for what is actually needed when.

## Crypto contract

| Parameter | Value |
| --- | --- |
| Scheme | ML-DSA-65 (FIPS 204) |
| Public key | 1952 bytes |
| Signature | 3309 bytes |
| Signed message | The transaction hash as 32 big-endian bytes |
| Context string | Empty |

**Parameter set is forced by the platforms, not chosen.** Apple exposes `SecureEnclave.MLDSA65`
and `SecureEnclave.MLDSA87`; Android 17's Keystore offers ML-DSA-65 and ML-DSA-87 through
`KeyPairGenerator`. Neither offers ML-DSA-44. ML-DSA-65 is the smaller of the two available.

**ML-DSA signs a message, not a digest.** There is no "sign this hash" entry point in either
platform API. The message is the 32-byte big-endian transaction hash, and both sides must agree
on that encoding exactly.

**The context string is empty.** FIPS 204 permits up to 255 bytes of context, and it is folded
into the signed message encoding, so the verifier must apply an identical value. Domain separation
is tempting but redundant here: an invoke-v3 transaction hash already commits to the chain id, and
a SNIP-12 message already commits to its domain. An empty context is the value least likely to
diverge between three implementations. Changing it later is one line on each side, but it must
change on all of them at once.

## The account contract family

**Read from `ml-dsa-cairo` rather than assumed.** The earlier open question in this document —
`constructor(pk_commitment: felt252)` versus `constructor(pk: Array<felt252>)` — was the wrong
question. There is more than one candidate contract, they disagree on the constructor, and one of
them has none at all.

| Contract | Cairo directory | Constructor | Class hash | Signature felts | Measured `__validate__` |
| --- | --- | --- | --- | --- | --- |
| `const` | `account_const` | none — empty storage | **per user**: the verification key is compiled into the class as constants | 905 | 79.9M |
| `storage` | `account` | `(packed_key: Array<felt252>)`, 925 felts | one shared, pinnable | 905 | 114.1M — over cap |
| `hashkey` | `account_hashkey` | `(key_hash: felt252)` — Poseidon over those 925 felts | one shared, pinnable | **1830** | **95.7M** |

The directory was renamed upstream: `--variant hashkey` used to live in `account_split/` and is now
`account_hashkey/`, whose contract is `MlDsaHashKeyAccount`. The old `split` name was a leftover from
a `library_call` experiment measured at 105–106M — over the gas cap — and deleted.

Those names are the `--variant` values of `py/account_tool.py` in the contract repository — that
tool generates the class, the constructor calldata, and the signature payload, so two sides naming
the same contract differently is how a mismatch turns into a signature that fails to verify with no
useful error.

A fourth experiment, a STWO proof of the verification, was removed upstream and was never modelled.

**`hashkey` is the chosen contract, and the only one the wallet implements.** Confirmed
2026-08-27; the other two were removed from the wallet on 2026-08-28. The table above is kept as
the measurement record behind that choice, not as a menu — `accountContractType: "ml-dsa"` now
means `MlDsaHashKeyAccount` and nothing else, an account record carries no contract variant, and
the enrollment screen has no contract picker.

The margin is the thing to watch. `hashkey` validates at **95.7M against a 1e8 cap**, reached only
after the packed-key evaluation was fused into the Schwartz–Zippel pass. `const` has more room at
79.9M but pays a 2.9 MB class per user. Any future change that makes verification more expensive
breaks `hashkey` before it breaks `const`, so the wallet should not treat the choice as permanent.

> **The gas figure depends on which runner measured it**
>
> `snforge` 95.7M · Sepolia sequencer 88.2M · `starknet-devnet` 0.9.2 **224.2M**.
>
> Devnet inflates by roughly 2.5×. Read 224M against a 1e8 cap and the obvious conclusion is that the
> account is dead on arrival; it is not, and we raised exactly that false alarm before checking against
> a real sequencer. Quote the runner with the number, always.

**What does not vary is most of it.** Every contract signs the same 32 big-endian bytes of the
transaction hash, with the same empty FIPS 204 context, and takes the same 3309-byte signature from
the device. So the signer seam, the sign queue, the two background messages, the local
verify-before-broadcast gate, and the whole sign takeover are contract-independent. Three things
vary, and they are the only three:

1. what the constructor takes, and therefore the address preimage,
2. whether there is one class hash to pin or one class per user,
3. how many felts of signature calldata a transaction carries.

With one contract those three are constants rather than a table. They live in
`@mc-wallet/starknet/ml-dsa-classes`: `mlDsaAccountAddress(classHash, keyCommitment)` is the whole
address preimage, the class hash is asked for until there is a release to pin, and the 1830-felt
payload is documented at the head of that module. A second contract would reintroduce the table —
it is not there speculatively.

### What this changes about the earlier estimates

**The signature is 905 felts, not "roughly 107".** Every earlier statement in these documents that
put an ML-DSA signature at ~107 felts was wrong by a factor of eight. The layout is a felt-native
decomposition plus verification hints: `[0, 111)` carries c_tilde, z as 20-bit fields, and the
hints; `[111, 265)` carries `w`; `[265, 521)` carries `M'`; `[521, 905)` carries `K'`. The
`hashkey` contract prefixes the 925-felt packed key — its own signature layout is `[0, 925)` key,
`[925, 1036)` signature, `[1036, 1190)` `w`, `[1190, 1446)` `M'`, `[1446, 1830)` `K'` — so it pays
1830 felts on **every** transaction, and re-hashes the key on every one to check it against the
stored commitment.

At 32 bytes a felt that is roughly 29 KB of signature per transaction — larger than the Tongo
confidential transfer this document's payload table calls the outlier. That is a headline cost of
the design, not a footnote.

**The extension has to compute the hints.** The device returns the raw 3309-byte FIPS 204
signature; `w`, `M'` and `K'` are derived from it and are what make on-chain verification cheap.
That now lives in krusty-kms and reaches the wallet as `mlDsaSignaturePayload`: it verifies the
signature, reuses the `w` rows that verification produced, checks the integer identity exactly, and
errors rather than emitting a payload it could not prove — the contract rejects a wrong one with no
diagnosis. `serializeAccountSignature` still refuses ML-DSA: that seam takes a Stark `(r, s)`, which
this contract validates neither of.

**There are real checked-in fixtures.** `mldsa/src/vector.cairo` holds a full ML-DSA-65 test vector
(the 1952-byte public key and a deterministic signature) and `mldsa/src/packed_key.cairo` holds the
derived 925-felt packed keys and the split signature payload, both generated by `py/gen_vectors.py`
and marked do-not-edit. So a wallet-side test does not need the Python tool in the loop to check an
address derivation — the expected values are already text in the repository. Running the tool for
fresh payloads does need its virtualenv, which is not checked in.

**`hashkey` needs key expansion, and the wallet now does it.** Its constructor argument derives from
the 925-felt packed form of the public key: `A = InvNTT(ExpandA(rho))`,
`T = t1 * 2^d`, `tr = H(pk, 64)`, packed as `[0,768)` A, `[768,922)` T, `[922,925)` tr — and
`hashkey` then takes the Poseidon hash of those 925 felts as its single constructor argument.

### None of this is undefined, and as of 2026-08-31 none of it is unported

The expansion, the commitment, the verifier and the hints are in krusty-kms — see
[what landed](#what-landed). `py/account_tool.py` stays the oracle they were tested against, and the
first place to look when a payload is rejected.

`py/account_tool.py` in the contract repository is the reference implementation for every one of
those gaps:

- `keygen` produces a keypair, optionally from a 32-byte seed for deterministic tests.
- `deploy-data --pk --variant hashkey` produces the `key_hash` — the single felt the constructor
  takes. Enrollment used to ask the user to paste this; it no longer does, because the wallet derives
  it. Still useful for checking the wallet against the tool.
- `sign --msg-hash --variant hashkey` produces the full 1830-felt payload: the 905 signature felts
  prefixed by the 925 key felts. It asserts FIPS 204 verification through
  two independent implementations, plus the integer identity and the Schwartz-Zippel simulation,
  before emitting anything.

**The port is done, and it is in Rust.** It began as `ml-dsa-core.ts` + `ml-dsa-math.ts` in
`@mc-wallet/starknet` — deliberately, because the krusty loop (pinned revision, pinned rustc, rebuilt
wasm, digest-pinned glue) is not one to debug an NTT through. Both files are now deleted and
`krusty_kms_crypto::ml_dsa` replaces them.

It reproduces `key2_felts`, `sig_sz_felts`, `w_felts`, `m_felts` and `k_felts` from
`mldsa/src/packed_key.cairo` exactly. The fixture pins a Poseidon digest per payload section, so a
drift names the section that moved rather than just failing. The migration was checked the only way
that really counts: the built wasm and the TypeScript it replaced were compared felt by felt across
all 1830, plus the commitment and the estimation dummy, and agreed on every one.

Two things confirmed while doing the port:

- `deploy-data` emits the 925 felts as a bare list. `constructor(packed_key: Array<felt252>)`
  serializes an array with its length prefix, so the on-chain calldata for `storage` is presumably
  `[925, ...felts]` — worth confirming rather than assuming.
- For `hashkey` the tool now reports `constructor_calldata` as `[key_hash]` and the 925 felts
  separately as `key_felts`. An earlier revision put the 925 felts in `constructor_calldata`, which
  was wrong — the constructor takes one felt. Anything written against that output needs rechecking.

Signing is **hedged by default** — `--deterministic` is opt-in, for tests. Two signatures over the
same hash differ, which any fixture comparing them has to account for.

### Confirmed against the contract

Two things this document already committed to turned out to match `mldsa/src/verify.cairo` exactly,
and are worth recording as verified rather than assumed:

- **The message encoding.** `hash_to_bytes32` builds the felt little-endian and reverses it — 32
  big-endian bytes, which is what `ml-dsa-verify.ts` produces.
- **The empty context.** `verify_online_sz` computes `mu = H(tr || 0x00 || 0x00 || msg, 64)`, which
  is the FIPS 204 `M'` with domain byte `0x00` and a context length of zero.

## Wire format

The envelope is the contract between the wallet, the transport, and the phone.

**It is defined once, in Rust, inside krusty-kms**, and reaches the extension through WASM and the
phone through the C ABI. It is deliberately not defined in TypeScript and re-implemented in Swift
and Kotlin: three hand-written serializers drift, and the drift presents as unexplainable
verification failures.

```rust
/// Extension -> phone, once, at registration.
pub struct PairingOffer {
    pub version: u16,
    pub network_id: String,        // which chain this account will live on
    pub challenge: [u8; 32],       // random; the phone must sign it
    pub transport: TransportDescriptor,
}

/// Phone -> extension, once, at registration.
pub struct PairingResult {
    pub version: u16,
    pub device_id: [u8; 16],       // stable, non-secret, chosen by the phone
    pub public_key: Vec<u8>,       // 1952 bytes
    pub pop_signature: Vec<u8>,    // 3309 bytes over the challenge
    pub app_version: String,
}

/// Extension -> phone, per signature.
pub struct SignEnvelope {
    pub version: u16,
    pub correlation_id: [u8; 16],
    pub account_address: Felt,     // which account, so the phone picks the right key
    pub chain_id: Felt,
    pub expires_at_ms: u64,
    pub payload: SignPayload,
}

pub enum SignPayload {
    InvokeV3(InvokeV3Payload),     // full transaction, NOT a hash
    DeployAccountV3(DeployAccountV3Payload),
    Snip12(TypedDataPayload),
}

/// Phone -> extension, per signature.
pub enum SignResponse {
    Signed { correlation_id: [u8; 16], signature: Vec<u8> },
    Rejected { correlation_id: [u8; 16], reason: RejectionCode },
}
```

Two rules that make the rest of the design work:

1. **`SignPayload` carries the full transaction, never a hash.** The phone recomputes the hash
   itself. A hash is 32 bytes and a simple invoke payload is roughly 500 — the difference fits
   inside a single QR frame either way, so sending the whole thing costs nothing and removes the
   extension's ability to misrepresent which hash belongs to which transaction.
2. **Every envelope is self-contained.** No shared references between the two sides, no implicit
   session state beyond the pairing. This is what makes a clipboard transport possible, and a
   clipboard transport is what makes the whole thing testable without hardware.

Encoding is CBOR, base64url-wrapped for text transports.

## krusty-kms surface changes

krusty-kms is vendored into this repository at a pinned commit
(`scripts/vendor-krusty.ts`, enforced by `bun run check:krusty`), so these land upstream first.

| Change | Where | Status | Why |
| --- | --- | --- | --- |
| ML-DSA key expansion, commitment, verify, SZ hints, estimation dummy | `crates/crypto/src/ml_dsa/` + `crates/wasm/src/ml_dsa.rs` | **landed** | Replaced `ml-dsa-core.ts` / `ml-dsa-math.ts`, both now deleted |
| Transaction-hash functions | `packages/kms-c/include/kms.h` | **outstanding — the mobile blocker** | The phone cannot recompute a hash; until then it blind-signs whatever it is handed |
| Envelope types + CBOR codec | new module, WASM and C ABI | outstanding | One serializer shared by both consumers |

### What landed

`krusty_kms_crypto::ml_dsa`, behind an off-by-default `ml-dsa` cargo feature, with four
`wasm_bindgen` exports:

```ts
mlDsaKeyCommitment(publicKey): string
mlDsaVerify(publicKey, transactionHash, signature): boolean
mlDsaSignaturePayload(publicKey, transactionHash, signature): string[]   // 1830 felts
mlDsaEstimationSignature(publicKey): string[]                            // 1830 felts
```

Hex strings in, hex felts out, matching the rest of the WASM surface. The 925-felt packed key is
deliberately **not** exported — it is an intermediate of the other two and no caller needs it alone.
There is no key generation and no signing at this boundary and there will not be: the key never
leaves the enclave, so this surface only ever handles public material.

Two things worth knowing if you touch it:

- **No Rust ML-DSA crate could serve this.** `ml-dsa` (RustCrypto), `fips204`, `libcrux-ml-dsa` and
  the PQClean bindings all expose only keygen/sign/verify; the NTT, `ExpandA`, `SampleInBall` and
  bit-unpacking are private in every one. The 1830-felt payload *is* the verification transcript —
  the `w` rows the hints commit to must be the exact rows the verifier computed — so a
  `verify() -> bool` that discards `w` cannot be composed into it. `fips204` is a dev-dependency
  instead, signing fresh keypairs so the verifier is checked against something that is not itself.
- **`sha3` 0.12 has no SHAKE.** That restructure dropped the XOFs entirely; only fixed-output SHA-3
  and Keccak remain. The module pins `sha3` 0.10.8 explicitly, which is already in the dependency
  graph via `starknet-rust-core`, so the feature adds no new crate.

### What is still outstanding — and it is the mobile blocker

`crates/kms/src/tx_hash.rs` is exposed through the WASM surface but **not** through the C ABI —
`kms.h` offers `kms_pedersen_hash` and `kms_poseidon_hash_many` and nothing else relevant. Without
`compute_invoke_v3_hash` and friends in the C ABI, the phone's approval screen is decoration: it can
display a hash it was handed but cannot prove that hash belongs to the transaction shown.

This is the first thing the mobile track needs, and nothing in the wallet is waiting on it.

**Verification did not have to wait for Rust, and neither did the rest.** `verifyStarkSignature`
(`packages/features/transactions/src/routing/ledger-verify.ts`) already verifies Ledger signatures
with **starknet.js, not Krusty**, and its own doc comment sets the precedent: *"This is a pure
public-key operation … it does NOT sign, derive a key, or validate a mnemonic, so it does not
weaken the 'Krusty owns wallet crypto / fail closed' rule."*

The same reasoning covered ML-DSA, and it is what allowed the whole port to be prototyped in
TypeScript first: key expansion, verification and hints all read a public key, a public signature and
a public hash, and none of them signs or derives.

**That interim is over.** All of it now lives in krusty-kms, and `@mc-wallet/starknet`'s dependencies
are back to exactly what they were before this work — both `@noble/post-quantum` and `@noble/hashes`
are gone from it. The extension bundle carries no post-quantum JavaScript at all.

Noble survives in one place: `@mc-wallet/testkit`, where it *signs* fixture devices so the Rust
verifier is checked against an independent implementation. It sits in `dependencies` rather than
`devDependencies` because `check:imports` forbids a file under `src/` from importing a dev-only
dependency, and the fixtures must be in `src/` to be importable by other packages' tests. Nothing in
`apps/extension` imports testkit, so it never reaches a shipped bundle.

Removing that last one needs the enrollment challenge to be deterministic under test: the
key-boundary scan runs live enrollment against a freshly issued random challenge, so no committed
vector table can cover it.

Upstream constraints for when M2 and M3 arrive: changing `kms.h` trips
`.github/guardrails/ffi-kms.h.snapshot`, adding WASM exports trips
`.github/guardrails/wasm-exports.txt`, and both require a dated note in krusty-kms's own
`docs/design/` format (`.github/scripts/check-design-note.sh`). That is a separate deliverable
from this document.

## Rust client-side constraints

Not needed by the wallet, which uses starknet.js — but load-bearing for anyone building a Rust
submitting path in krusty-kms (the mobile app submitting through `krusty-kms-client`, or CLI
tooling). Both are the first things a Rust implementer will trip over.

**ML-DSA cannot go through starknet-rs's `Signer` trait.** `Signer::sign_hash` returns
`starknet_rust_core::crypto::Signature`, which is `{ r: Felt, s: Felt }` — two felts, fixed. An
ML-DSA-65 `hashkey` payload is 1830. `SingleOwnerAccount::sign_execution_v3` hard-codes
`Ok(vec![signature.r, signature.s])` to match.

The seam is one level up: `Account::sign_execution_v3` returns `Result<Vec<Felt>, _>`, which is
unbounded. **Implement `Account`, not `Signer`**, alongside `SingleOwnerAccount` rather than
through it. Deployment needs a matching `AccountFactory` implementation for the same reason.

**Return `true` from `is_signer_interactive`.** This is the starknet-rs counterpart to the
fee-estimation rule in [the wallet document](wallet/#17-fee-estimation-must-not-prompt-for-biometrics). At `src/account/execution.rs:400` the estimate path sets
`skip_signature` from it and sends a dummy signature; report non-interactive and starknet-rs will
wake the phone for every fee estimate, because — as its own comment says — *"signing with
non-interactive signers is cheap so always request signatures."*

## Working before anything is merged

Nothing on the krusty-kms side will be merged during the proof of concept, so the Rust and
TypeScript sides have to be developed against each other locally. This section is the daily loop.

### Topology: one checkout, two consumers

`vendor/krusty-kms/` is **gitignored** by the wallet (`.gitignore:12`), so it is not a submodule and
the wallet's git never sees what is inside it.

```
~/dev/krusty-kms                 <- your working tree, your branch
     |
     +-- fetched by --> mc-wallet/vendor/krusty-kms   (extension, via wasm-pack)
     +-- cargo build --> libkms                       (mobile, via C ABI)
```

**Keep `vendor/krusty-kms` as its own clone and fetch from your working tree**, which is what the
recipe below does. This is the arrangement that has actually been used; earlier revisions of this
document recommended symlinking the wallet's `vendor/` at a single checkout instead.

> **Why not the symlink**
>
> It looks simpler — one tree, no fetch — but `bun run vendor:krusty` ends with
> `git checkout --detach <REV>`, which would detach HEAD inside your working clone. Worse, the
> provenance gate requires the vendored checkout to sit on a specific commit with a clean worktree,
> which is precisely what a working tree is not. Going through a real fetch means the pin and the
> shipped wasm always describe the same source.

### The two loops

They have very different costs, so it is worth knowing which one you are in.

**TypeScript only** — no Rust rebuild at all.

```bash
bun run build            # produces dist/
# reload the unpacked extension in chrome://extensions
```

**Touching Rust** — one extra step, roughly 30–60s incremental.

```bash
cd vendor/krusty-kms && wasm-pack build crates/wasm --target web --out-dir pkg
cd - && bun run build
```

`crates/wasm/pkg/` is gitignored inside krusty-kms too, so the rebuilt artifact is picked up with
no git state to fight, and `apps/extension/build.ts` copies both files into `dist/vendor/`.

**No TypeScript type plumbing is needed when you add a WASM export.** The adapter takes the module
as an untrusted value and validates it structurally (`asRecord`, `ownValue`, `KRUSTY_RESULT_CLASSES`
in `kms-krusty/src/adapter.ts`), so nothing flows from the generated `.d.ts`. New exports are
validated at the boundary like everything else.

### Building locally without a pushed commit

`apps/extension/build.ts:89` runs `bun run check:krusty` **as part of the build**, so "just don't run
the check" does not work — `bun run build` itself fails and there is no `dist/` to load.

`scripts/check-krusty-adapter.ts` gates on four things: the checkout sits on `KRUSTY_KMS_REVISION`,
the worktree is clean, `krusty_kms_wasm.js` matches `expectedGlueDigest`, and a set of known-answer
vectors still reproduce (a reference mnemonic, address, public key, signature and viewing key).

Earlier revisions of this document proposed an `MC_KRUSTY_LOCAL=1` escape that skipped the three
provenance gates and kept the vectors. **It was never built, and it turned out not to be needed.**
Pinning to a local commit satisfies all four gates honestly:

```bash
# 1. commit in your krusty-kms working tree; any branch is fine
git -C ~/dev/krusty-kms commit -am "feat: ..."
SHA=$(git -C ~/dev/krusty-kms rev-parse HEAD)

# 2. point KRUSTY_KMS_REVISION in scripts/vendor-krusty.ts at that SHA

# 3. let the vendor script fetch it from your local tree, not GitHub
git -C vendor/krusty-kms remote set-url origin ~/dev/krusty-kms
bun run vendor:krusty
git -C vendor/krusty-kms remote set-url origin https://github.com/starknet-innovation/krusty-kms.git

# 4. update expectedGlueDigest in scripts/check-krusty-adapter.ts
shasum -a 256 vendor/krusty-kms/crates/wasm/pkg/krusty_kms_wasm.js
```

Going through `bun run vendor:krusty` rather than calling `wasm-pack` by hand matters: it applies the
pinned toolchain (`KRUSTY_KMS_TOOLCHAIN`) and the `--remap-path-prefix` flags, which is what makes
the glue digest comparable to the one CI will compute later.

**The one property this does not give you is remote reproducibility.** The SHA is not on `origin`, so
`bun run vendor:krusty` fails on any other machine and in CI. Two consequences:

- Do not commit `scripts/vendor-krusty.ts` with a local-only SHA, or treat it explicitly as a local
  checkpoint. CI will fail on it.
- When the branch is pushed and merged, re-point `KRUSTY_KMS_REVISION` at the resulting SHA and
  regenerate the digest. If the merge squashes or rebases, that is a different SHA than the branch's.

> **The shortcut to avoid**
>
> `vendor/krusty-kms/.gitignore` ignores `crates/wasm/pkg/`, so you *can* drop a freshly built `pkg/`
> into an old checkout and bump only the digest. `check:krusty` passes — `git status` still reads
> clean. Don't: the pin then claims a revision the shipped wasm was not built from, which is the one
> provenance property that gate exists to protect. Its own header says nothing detects a `pkg/`
> produced after vendoring.

That is roughly six lines across `check-krusty-adapter.ts` and `build.ts`, and it is more honest
than the alternative everyone reaches for otherwise, which is commenting out line 89 and
forgetting.

### The mobile side has none of this

`libkms` builds straight from the same local checkout with `cargo build`; there is no vendoring,
no pin, and no digest. `packages/kms-c/include/kms.h` is checked in, so adding functions there is
picked up by the Swift and Kotlin wrappers immediately. krusty-kms's own
`ffi-kms.h.snapshot` guardrail will complain, but that is that repo's CI and does not block local
work.

### Reconciling at PR time

In order, once, at the end:

1. krusty-kms branch merges upstream, with its own `docs/design/` note and regenerated
   `ffi-kms.h.snapshot` and `wasm-exports.txt` baselines.
2. Bump `KRUSTY_KMS_REVISION` in `scripts/vendor-krusty.ts`.
3. Restore the GitHub remote on `vendor/krusty-kms` and run `bun run vendor:krusty`.
4. Recompute `expectedGlueDigest` from the freshly built glue and update it in the same commit —
   the comment in `check-krusty-adapter.ts` requires it to move together with the revision.
5. `bun run check` clean, and the pinned SHA reachable on `origin` — a local-only SHA passes here
   and fails in CI.

## The stub account — never needed

> **Superseded.** The plan for closing M1 without waiting on the Cairo track was a devnet-only account
> whose `__validate__` returned valid unconditionally, roughly twenty lines of Cairo. **It was never
> built:** the real `MlDsaHashKeyAccount` was ready first, and the wallet has been exercised against a
> locally declared build of it — deploy and transfer, with real verification on chain.

Its *reasoning* survives, and is load-bearing. A fixture key from `account_tool.py keygen --seed` is a
genuine ML-DSA-65 keypair, and a signature from `account_tool.py sign` is a genuine FIPS 204 signature
that the verify gate accepts or rejects on its merits. What a fixture cannot demonstrate is that the
key is non-exportable and that signing is gated on a biometric — platform claims, needing real
hardware, and not wallet code. That is the argument that let the whole wallet side be built without a
phone, and the mobile track inherits it in reverse: what remains to validate on a phone is exactly the
enclave and biometric claims, and nothing else.

**The one requirement that outlived the stub.** No unreviewed account class may reach mainnet or
Sepolia. This repository already rejects a devnet reporting Sepolia's chain id on the write path, and
that guard is what keeps the real — but unreviewed and unaudited — `MlDsaHashKeyAccount` on devnet
until the contract has a reviewed release.
