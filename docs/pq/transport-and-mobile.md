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
   is the only transport that runs in CI with no phone, no relay, and no Bluetooth.
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

**Now the critical path.** As of 2026-08-31 the wallet side is done — enrollment, the sign queue, the
takeover, the verify gate, address derivation, the 1830-felt calldata, fee estimation without a
biometric prompt, and deployment — all exercised end to end with `py/account_tool.py` standing in for
the phone. Nothing in the extension is waiting on mobile code. This is where the work moves next.

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

### The one upstream dependency

Transaction-hash functions are exposed through krusty-kms's **WASM** surface but not its **C ABI**:
`packages/kms-c/include/kms.h` offers `kms_pedersen_hash` and `kms_poseidon_hash_many` and nothing
else relevant. Until `compute_invoke_v3_hash` and friends are added there, the phone can only
blind-sign — it can display a hash it was handed but cannot prove that hash belongs to the
transaction shown, which is the entire point of a trusted display.

**This is the mobile track's first task.** Adding to `kms.h` trips krusty-kms's
`ffi-kms.h.snapshot` guardrail and needs a dated note in its `docs/design/` format; the ML-DSA
module that landed on 2026-08-31 is a worked example of both.

What this app adds is the part a fixture cannot: a key that is non-exportable because the hardware
says so, and signing gated on a biometric because the platform enforces it. Those are claims about
devices, not about the wallet — which is why they are validated now that the extension works, rather
than before.

Scope:

- Key generation via `SecureEnclave.MLDSA65` with `init(accessControl:)` and
  `.biometryCurrentSet`, or Android `KeyPairGenerator` with `setUserAuthenticationRequired(true)`
  and `setInvalidatedByBiometricEnrollment(true)`.
- A local key list with stable identifiers. No HD enumeration exists.
- Receive envelope, recompute the transaction hash through the krusty-kms FFI, display,
  authenticate, sign, return.
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

**Open before implementation:** which platform ships first, and which hardware actually supports
enclave-backed ML-DSA. Apple's documentation gives an OS floor of 26.0+ but secondary sources
hedge with "supported hardware," and `SecureEnclave.isAvailable` is a runtime check for the
enclave generally, not for ML-DSA. A one-day probe on real devices answers it.
