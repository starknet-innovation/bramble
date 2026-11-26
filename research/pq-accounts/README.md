# Post-quantum account research: SLH-DSA-BLAKE2s-128s

Research for [Bramble's post-quantum accounts](#context). Not part of the extension build.

> [!WARNING]
> **Non-standard, unaudited research code.** SLH-DSA-BLAKE2s-128s is FIPS 205's SLH-DSA-128s
> construction with every hash instantiated from BLAKE2s-256. It is not FIPS 205 conformant
> and has had no cryptographic review. Do not use it to protect real funds.

## What we did

We built a Starknet account whose transactions are authorised by a hash-based,
post-quantum signature, and ran it end to end on Sepolia.

1. **Picked a hash-based scheme that fits validation.** Starknet caps `__validate__` at
   100M L2 gas. Standard SLH-DSA does not fit: SHAKE-128s costs about 398M gas per
   verification (Keccak syscall cost), and SHA2-128s pays about 850k gas per SHA-256 block.
   BLAKE2s is a native Cairo opcode, so we instantiated SLH-DSA-128s with BLAKE2s in the
   style of FIPS 205's SHA2 instantiation (`crates/slh_dsa_blake2s_128s/README.md`).
2. **Wrote a Cairo verifier** (`crates/slh_dsa_blake2s_128s`): 2-felt public key,
   491-felt signature (7,856 bytes), and 17 tests covering valid signatures and tampering
   with every part of the signature, the key and the message.
3. **Wrote a Python reference and signer** (`scripts/slh_dsa_ref.py`, `signer/`). The
   reference is generic FIPS 205; with SHA2 and SHAKE it reproduced the `slhdsa-c`
   fixtures byte for byte and matched NIST's ACVP SHAKE-128s vectors before BLAKE2s was
   swapped in.
4. **Wrapped it in an account contract** (`contracts`): `__validate__` verifies the
   SLH-DSA signature over the transaction hash.
5. **Built for the live network.** Starknet's gateway accepts only Sierra 1.10.0 classes,
   which needs Cairo/Scarb 2.22.0. The account builds under the audited libfunc list.
6. **Ran it on Sepolia** (`sepolia/run.mjs`): declare, fund, deploy, a transfer signed
   only with SLH-DSA, and a tampered signature that the network rejected.

## Results

| Measurement | L2 gas |
|---|---:|
| Verification, main fixture (snforge) | 29.2M |
| Verification, costliest of 300 sampled signatures (snforge) | 31.5M |
| `__validate__` on Sepolia (deploy) | 28.8M |

Validation uses about 29–31% of the 100M cap.

### Sepolia

Account class `0xa94e691ba3dabe097e1b5e96c597e550e8b7730670c450b0b784a461985851` (this
folder builds to exactly that hash), account
`0x5f2e32c4194a84254a18763bbbd2fa4ee9bd3140d665d868a5a2ccd5f583f06`.

| Step | Transaction | L2 gas | Fee |
|---|---|---:|---:|
| Declare | [`0x3a7a04…a0a39`](https://sepolia.starkscan.co/tx/0x3a7a04367d2b81d765089ba56d41d8ab87619853da585e98347b3daddca0a39) | 714M | 20.46 STRK |
| Deploy (SLH-signed) | [`0x2e2cbc…224bf`](https://sepolia.starkscan.co/tx/0x2e2cbcf3d4ad19bd30a12676906313d167845d202c91c6a0bcde423839224bf) | 28.8M validation | 0.96 STRK |
| Transfer, 1 STRK (SLH-signed) | [`0x36d8f6…26b8`](https://sepolia.starkscan.co/tx/0x36d8f6012dd25ad7fce426b1b8e6f0b6a6a58cc16296695f69ce7f4763a26b8) | 32.1M | 0.92 STRK |
| Tampered signature | rejected at validation (error 55); nonce unchanged | | 0 |

### What we learned

- **Mainnet declares are allowlisted.** StarkWare's gateway refuses declares from accounts
  not on its `authorized_declarer_accounts` list ("is not allowed to declare contracts",
  code 63). A mainnet test needs the class declared by an allowed account. Sepolia has no
  allowlist.
- **Fee estimation for Sierra 1.10.** Nodes whose Sierra compiler stops at 1.9.x cannot
  estimate fees for these classes, so `sepolia/run.mjs` sets resource bounds by hand.
- **Cost.** An SLH-signed transaction costs about 32M L2 gas, under 1 STRK on Sepolia.
  Signing takes 2–3 s in the Python reference.

## Layout

| Path | Contents |
|---|---|
| `crates/bench_interface` | Verifier trait and Starknet validation-limit constants |
| `crates/slh_dsa_blake2s_128s` | Cairo verifier, fixtures and tests |
| `contracts` | `SlhDsaBlake2s128sAccount` and the shared account flow |
| `scripts` | FIPS 205 reference and the fixture generator |
| `signer` | Key generation and signing (Python) |
| `sepolia` | End-to-end Sepolia script |

## Reproduce

Needs Scarb 2.22.0, Starknet Foundry 0.64.1 and universal-sierra-compiler 2.11.0 or later
(for Sierra 1.10).

```bash
scarb build
snforge test --workspace          # 17 tests

python3 -I signer/slh_signer.py keygen --key my-slh-key.json
cd sepolia && npm install
export PQ_SLH_KEY=$PWD/../my-slh-key.json PQ_FUNDER_ADDRESS=0x… PQ_FUNDER_PRIVATE_KEY=0x…
node run.mjs fund && node run.mjs deploy && node run.mjs transfer && node run.mjs tamper
```

The class is already declared on Sepolia, so `declare` is only needed after changing the
contract. Use a throwaway Sepolia funder.

## Context

Bramble will only adopt hash-based post-quantum signatures. The plan is two account modes
alongside today's ECDSA accounts: hybrid (Stark ECDSA and SLH-DSA, both required) and
SLH-DSA only. This research shows that SLH-DSA validation fits Starknet's limits today.
A standard (FIPS 205) instantiation would need cheaper on-chain Keccak or SHA-256.

## Licence

MIT. See `LICENSE`.
