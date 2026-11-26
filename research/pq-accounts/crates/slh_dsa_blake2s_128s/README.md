# SLH-DSA-BLAKE2s-128s verifier (spike)

> [!WARNING]
> **Non-standard, unaudited spike.** This is FIPS 205's SLH-DSA-128s construction with every
> hash instantiated from BLAKE2s-256. It is **not** FIPS 205 conformant, has no NIST test
> vectors, and its instantiation has not been reviewed by a cryptographer. Do not use it to
> protect funds.

**Scheme:** SLH-DSA-128s parameters (n = 16, h = 63, d = 7, h' = 9, a = 12, k = 14,
lg w = 4, m = 30), stateless hash-based signatures. **Status:** measured.

## Instantiation

`BLAKE2s` is unkeyed BLAKE2s-256 (RFC 7693). `Trunc_n` keeps the first n bytes. `ADRS` is the
full 32-byte FIPS 205 address (§4.2, as in the SHAKE instantiation).

| Function | Definition |
|---|---|
| `F`, `H`, `T_l`(PK.seed, ADRS, M) | `Trunc_n(BLAKE2s(PK.seed ‖ 0^48 ‖ ADRS ‖ M))` |
| `PRF`(PK.seed, SK.seed, ADRS) | `Trunc_n(BLAKE2s(PK.seed ‖ 0^48 ‖ ADRS ‖ SK.seed))` |
| `PRF_msg`(SK.prf, opt_rand, M) | `Trunc_n(HMAC-BLAKE2s-256(SK.prf, opt_rand ‖ M))` |
| `H_msg`(R, PK.seed, PK.root, M) | `MGF1-BLAKE2s-256(R ‖ PK.seed ‖ BLAKE2s(R ‖ PK.seed ‖ PK.root ‖ M), m)`, with a 4-byte big-endian counter |

This mirrors FIPS 205's SHA2 instantiation (§11.2.1), with BLAKE2s in place of SHA-256 and the
full address in place of the compressed one. Padding `PK.seed` to one 64-byte block makes the
first compression invariant per signature, so it is computed once. `F` and `H` are then a
single `blake2s_finalize` each. The verifier uses the pure external interface with an empty
context (`M' = 0x00 ‖ 0x00 ‖ M`), and `M` is the transaction hash as 32 big-endian bytes.

**Encoding:**
- The public key is 2 felts and the signature 491 felts (7,856 bytes).
- Each felt holds one 16-byte element as a little-endian integer below 2^128, matching BLAKE2s's little-endian word packing.
- Values at or above 2^128 and wrong lengths are rejected.

**Reference implementation:** `scripts/slh_dsa_ref.py`, a generic FIPS 205 implementation. With
SHA2 and SHAKE it reproduced the `slhdsa-c` SHA2-128s and SHAKE-128s fixtures byte for byte and
matched NIST's ACVP SHAKE-128s vectors before BLAKE2s was swapped in.
`scripts/gen_slh_dsa_blake2s_fixture.py` generates `src/fixtures.cairo`.

## Current efficiency

Measured with snforge 0.64.1 / Cairo 2.22.0 (Sierra 1.10.0), under Sierra-gas tracking.

| Measurement | L2 gas |
|---|---:|
| Verification, main fixture | 29,223,162 |
| Verification, costliest of 300 sampled signatures (`tests/worst.cairo`) | 31,487,972 |

That is about 29–31% of the 100,000,000 L2-gas validation cap. On Sepolia, the account's
whole `__validate__` used 28.8M L2 gas.

**Where the gas goes:** Cairo steps about 70%, the `blake` opcode about 25%, range checks the
rest. The number of BLAKE2s compressions (about 2,150 for the main fixture) depends on the
WOTS+ digits, so cost varies a little with the signed hash.

The account builds under the audited libfunc list.
