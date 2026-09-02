---
layout: default
title: PQ signer — transport and mobile app
permalink: /pq-mobile-signer/transport-and-mobile/
---

[Post-quantum mobile signer](../) · overview, milestones, and cross-cutting flows

# Parts 2 and 3 — Transport and mobile app

## Part 2 — Transport

Detailed separately. The contract:

```ts
type SignerTransport = {
  pair: (offer: PairingOffer) => Promise<PairingResult>;
  request: (envelope: SignEnvelope, signal: AbortSignal) => Promise<SignResponse>;
};
```

Async, swappable, and never trusted. It cannot forge a signature — the extension verifies against
the enrolled public key — and it cannot cause the wrong thing to be signed, because the phone
displays what it signs. Its only powers are censorship and metadata.

Implementation order:

1. **Manual copy/paste.** A base64url string out, a base64url string back. Keep it permanently: it
   is the only transport that runs in CI with no phone, no relay, and no Bluetooth. **Built.**
   Pairing is base64url JSON in both directions; signing is asymmetric — a base64url JSON envelope
   out, a bare `0x` hex signature back — because the reply needs no correlation id when the panel is
   showing exactly one request and owns the cancel. The phone's key selection matches on the
   enrolled public key the envelope names, and `networkId` in the envelope is what lets it refuse a
   chain its key was not registered against.
2. **Relay.** Needs no tab, no device chooser, no user gesture, and no permission — it runs
   straight from the side panel, which nothing else on this list can claim.
3. **BLE.** `packages/platform/ledger-browser` already owns a Web Bluetooth transport. Deferred
   because stable Chrome cannot enumerate paired Bluetooth devices for a silent reopen, so every
   operation re-pairs through Chrome's native chooser in a dedicated tab.

Pairing and per-request transport need not share a medium. `pair` returns a durable
`TransportDescriptor` that is stored in the account record — which is why part 1's schema depends
on this section.

### Payload sizes

Measured, because one case is an outlier and it changes what a transport has to carry.

| Payload | Size | Fits one QR frame? |
| --- | --- | --- |
| ERC-20 transfer (7 felts + envelope) | ~425 B raw, ~250 B varint | Yes, easily |
| Approve + swap multicall | ~500–650 B | Yes |
| ML-DSA-65 signature (return path) | 3309 B | No — ~5 frames |
| **Tongo confidential transfer** | **~780 felts, ~25 KB** | **No — ~9 frames** |
| Proof-carrying invoke v3 (`proof_facts`) | tens to hundreds of KB | No |

The Tongo figure is dominated by range proofs at `DEFAULT_BIT_SIZE = 40`
(`crates/wasm/src/proof.rs:19`): a `ProofOfBit` is 7 felts, a `Range` is 40 commitments plus 40
proofs plus length felts = 362, and `ProofOfTransfer` carries two of them plus 8 points and 5
scalars = 745. It is curve points and random scalars, so compression buys nothing.

For anything above one frame, the QR carries a **32-byte commitment plus a fetch reference**, not
the payload: the phone fetches over the untrusted channel and verifies against the hash it read
optically. The trust anchor stays in the optical channel and the bandwidth moves elsewhere. That
keeps the pairing QR at a fixed ~100 bytes regardless of transaction size.

## Part 3 — Mobile app

**Built, on both platforms, as of 2026-09-02.**
[`keep-starknet-strange/pq-signer`](https://github.com/keep-starknet-strange/pq-signer): Kotlin
Multiplatform with Compose Multiplatform, one shared implementation of the wire formats, key
selection and UI, and `expect`/`actual` only where the hardware differs.

Kotlin Multiplatform was not a preference. `SecureEnclave.MLDSA65` is CryptoKit, which is
Swift-only, so the iOS key path cannot be shared with anything — and once that is true, the choice is
between sharing the *rest* or writing it twice. What is per-platform is exactly the hardware seam:
key generation, the authentication prompt, and the keystore/keychain metadata beside each key.

The whole ceremony runs by clipboard: pair, deploy, send, sign. `py/account_tool.py` remains the
fixture path, and is still how the wallet is tested with no device attached.

### The contract the phone has to meet

Settled and already implemented on the wallet side, so none of it is open:

| | |
| --- | --- |
| Scheme | ML-DSA-65 (FIPS 204) |
| Public key returned at pairing | 1952 bytes |
| Signature returned per request | **3309 bytes, raw FIPS 204** |
| Message signed | the transaction hash as **32 big-endian bytes** |
| FIPS 204 context | **empty** |

**The phone's whole job is those five rows.** It never sees the 925-felt packed key, the `w`/`M'`/`K'`
witnesses, or the 1830-felt calldata — the wallet derives all of that from the 3309 bytes it gets
back. Receive the transaction, recompute the hash, display it, sign 32 bytes on biometric approval,
return 3309 bytes.

The wallet verifies every response against the enrolled public key before broadcast, so a wrong key,
a wrong hash, or a non-empty context surfaces as a refusal rather than a failed transaction.

### The mobile crypto surface

The phone does not use `packages/kms-c`. It has its own C ABI —
**`crates/ffi-mobile`** in krusty-kms, library `kms_mobile`, five functions over public material
only: an ABI version, an error reader, the ML-DSA key commitment, the account address, and a
signature verifier. A separate crate rather than a widened `crates/ffi` because that one is
`cdylib`-only (iOS needs a `staticlib`) and because a signer that never handles a private key should
not link an ABI that can derive one.

It packages itself: `./crates/ffi-mobile/build-mobile.sh` produces an XCFramework with device and
simulator slices, and the Android library in `jniLibs` layout. The app's Gradle build invokes that
script and knows no cargo target triple. Kotlin reaches it through cinterop on iOS and JNA on
Android — chosen over a JNI shim because the surface is small enough to transcribe and it needs no
CMake or NDK build step.

### The one upstream dependency

**Transaction-hash functions.** `kms_mobile.h` derives an address and verifies a signature; it
cannot compute an invoke-v3 hash. Until `compute_invoke_v3_hash` and friends are added, the phone
can only blind-sign — it can display a hash it was handed but cannot prove that hash belongs to the
transaction shown, which is the entire point of a trusted display.

**This is the mobile track's next task.** It trips krusty-kms's `ffi-kms_mobile.h.snapshot`
guardrail and needs a dated note in its `docs/design/` format; `2026-09-01-mobile-c-abi.md` is the
worked example of both, and its *Distribution* section is where the packaging decision is recorded.

Scope, as built:

- Key generation via `SecureEnclave.MLDSA65(accessControl:)` with `[.privateKeyUsage,
  .userPresence]`, or Android `KeyPairGenerator` with `setUserAuthenticationRequired(true)` and
  `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG | AUTH_DEVICE_CREDENTIAL)`. Every
  signature demands a fresh authentication, satisfied by biometry **or** the device passcode.
  `.biometryCurrentSet` and `setInvalidatedByBiometricEnrollment` were considered and **rejected**:
  they destroy the key when the enrolled biometric set changes, and with no recovery path a user
  adding a second fingerprint would lose the account.
- A local key list with stable identifiers, creation and last-used times, and the network the key
  was registered against. No HD enumeration exists.
- Receive the envelope, select the key by its enrolled public key, display the account and the hash,
  authenticate, sign, return. Recomputing the hash arrives with the dependency above.
- Deleting a key, behind a confirmation that says plainly that the account becomes unspendable.
- The app must be open and foregrounded to receive a request. Waking it would require push
  notifications, which would reintroduce a central server.

> **Budget the human round trip against the extension, not against a Ledger**
>
> Two constraints from the wallet side that a phone flow has to fit inside:
>
> - The enrollment challenge currently lives in the extension's service-worker memory, and Chrome MV3
>   terminates that worker after roughly 30 seconds idle. Moving it to `chrome.storage.session` is a
>   known fix, and until it lands an enrollment that takes longer than that fails.
> - Resource bounds go stale. A fee change means a new transaction hash, which means the user must see
>   and approve it again — never a silent re-sign. Whatever expiry the phone enforces and whatever
>   timeout the extension's queue uses must be one agreed number, or one side gives up while the other
>   waits.

### Answered by hardware · both platforms work, and the floor is the OS

Measured on a **Pixel 8 Pro (Android 17, API 37)** and an **iPhone SE 3rd generation, A15 (iOS
26.6)** — deliberately the oldest supported iPhone, because the question was whether ML-DSA needs
newer silicon. It does not: the floor is the OS version, not the chip.

| | |
| --- | --- |
| Android | every Keystore configuration reported `SECURITY_LEVEL_TRUSTED_ENVIRONMENT` with `privateKey.encoded == null`. **StrongBox cannot hold an ML-DSA key** — `setIsStrongBoxBacked(true)` fails keygen with `ProviderException`, so TEE is Android's ceiling for this algorithm |
| iOS | every Secure Enclave configuration produced a 1952-byte public key. `.privateKeyUsage` is mandatory and omitting it *denies* rather than gates: `[.userPresence]` alone reports "Operation is not allowed" |
| Both | ungated keys signed 3309 bytes that verified; every gated key refused to sign without authentication |
| Emulators | neither can gate a key. The iOS Simulator makes a genuine enclave key but any biometry-constrained access control fails with LocalAuthentication `-1020`, regardless of enrolment — so a Simulator build drops the gate and labels such keys |

One trap worth carrying across: **`KeyGenParameterSpec` drops inconsistent options silently, and
always in the permissive direction.** `setUserAuthenticationParameters` without
`setUserAuthenticationRequired(true)` discards the entire parameter set, leaving a key that signs
with no prompt while the source reads as protected. The app reads `KeyInfo` back and destroys a key
the platform did not configure as asked.
