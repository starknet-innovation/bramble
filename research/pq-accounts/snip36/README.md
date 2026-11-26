# SLH-DSA inside SNIP-36 proofs

Can a post-quantum signature check run inside the client-side (SNIP-36) proof that STRK20
private transfers already use, instead of on-chain? And can the standard FIPS 205 SHAKE
variant, which is too expensive for `__validate__`, run there?

This folder is a ready-to-run experiment. Everything except proof generation has been run on
Sepolia; proving needs a machine the size StarkWare recommends (48 vCPU, 96 GB).

## How it works

STRK20 private transfers prove an off-chain ("virtual") transaction sent by the privacy pool.
The pool's `__execute__` asks the user's account to approve it with `is_valid_signature`, then
emits an L2-to-L1 message. The on-chain transaction carries the proof, and the pool checks
that the proof facts contain that message. The signature check runs in the **execute** phase
(1.11B L2-gas cap), not `__validate__` (100M), and never touches the chain.

The harness copies that pattern with two small contracts (`contracts/src/snip36/`):

- **`PqAuthProbe`**: the virtual transaction's sender. `__validate__` accepts only zero-fee
  protocol calls (like the pool). `__execute__` accepts one `authorize(user, payload)` call,
  checks `user.is_valid_signature(tx_hash, signature)`, and sends `[user, poseidon(payload)]`.
- **`PqAuthConsumer`**: `apply(user, payload)` succeeds only in a transaction whose proof facts
  come from the virtual OS, are based on a recent block, and prove exactly the probe's message
  for that user and payload. Each payload applies once.

Users are three accounts, so the same proof shape is measured for each signature:

| Variant | Account | Signature |
|---|---|---|
| `ecdsa` | the funder (OpenZeppelin) | Stark ECDSA: today's private transfers |
| `blake2s` | `SlhDsaBlake2s128sAccount` | SLH-DSA-BLAKE2s-128s (non-standard) |
| `shake` | `SlhDsaShake128sAccount` | SLH-DSA-SHAKE-128s (FIPS 205) |

`SlhDsaShake128sAccount` cannot send its own transactions (verification is ~397M L2 gas,
above the 100M validate cap); it is deployed through the Universal Deployer and only used
through `is_valid_signature`.

## Results so far

Measured 2026-11-26 with StarkWare's prover image `PRIVACY-0.14.4-RC.3` against Sepolia
(0.14.4), on an 8-vCPU / 7.5 GB container.

| Variant | Virtual OS run | Steps to prove | vs ECDSA | Proof |
|---|---|---:|---:|---|
| `ecdsa` | ✅ | 296,747 | 1× | not generated: out of memory |
| `blake2s` | ✅ | 651,547 | 2.2× | not generated: out of memory |
| `shake` | ✅ | 15,848,011 | 53× | not generated: out of memory |
| `blake2s --tamper` | refused: `INVALID_SIGNATURE` | — | — | — |
| `shake --tamper` | refused: `INVALID_SIGNATURE` | — | — | — |

- All three signatures verify inside StarkWare's virtual OS, and tampered signatures are
  refused before proving. None uses a builtin the prover rejects.
- SHAKE's trace is dominated by Keccak: the prover has no native Keccak component, so its
  bootloader re-checks each permutation in Cairo (2.29M bitwise operations). The trace pads
  to 2^24 rows against 2^20 for BLAKE2s and 2^19 for ECDSA.
- Proof generation was killed by the container's 7.5 GB memory limit in every case, including
  the ECDSA baseline.

**Expected on the recommended machine (estimates, not measured):** ECDSA and BLAKE2s a few
seconds each; SHAKE roughly 30 s to 3 min, and it may need more than 96 GB.

## Sepolia deployment

| | Address / class |
|---|---|
| Probe | `0x7abee056c480e143780b5bc6634b8f66b8144ebefbac8652c543b436bff085b` |
| Consumer (5,000-block validity) | `0x46529850c035e8f23bc69ed3323bcd9c4a63c8f12977236164d8ffcbf5939ef` |
| SHAKE account | `0xacfc0e6c1d3bdd4aa7109894f8052517aaf9229ac640e79b3ed8f51559c7ba` |
| BLAKE2s account | `0x5f2e32c4194a84254a18763bbbd2fa4ee9bd3140d665d868a5a2ccd5f583f06` |
| SHAKE account class | `0x11e3246534b60260e3aa5fb66aa194f5ac5d34598af878f16f471d0a2a42a6c` |
| Probe class | `0x7cb10c4df0431dbbc26ba6cb62265c2cbe927e4897ed1a2b3033cf5b2fa5504` |
| Consumer class | `0x5ae3a3d54e64770c1eb2174b0659a2e2ba2318e50f11f3859f96eebc07f772b` |

## Run it on a large machine

Needs 48 vCPU / 96 GB (StarkWare's reference is a GCP `c4d-highcpu-48`), Docker, Node 22+,
Python 3.11+, Scarb 2.22.0. Key files never leave the machine.

```bash
# 1. Prover for Sepolia, local only.
docker run --rm -d --name prover -p 127.0.0.1:3100:3000 \
  -e RPC_URL=https://sepolia.nodes.starknet.org/rpc/v0_10 -e CHAIN_ID=SN_SEPOLIA \
  ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.4-RC.3

# 2. Build the classes and install the script's dependency.
cd research/pq-accounts && scarb build && cd snip36 && npm install

# 3. Keys and addresses. setup is already done on Sepolia; copy snip36-state.json across
#    (or run `node snip36.mjs setup` to deploy a fresh set).
export PQ_FUNDER_ADDRESS=0x… PQ_FUNDER_PRIVATE_KEY=0x…        # throwaway Sepolia funder
export PQ_SLH_KEY=…/sepolia-slh-key.json PQ_BLAKE2S_ACCOUNT=0x5f2e…3f06
export PQ_SHAKE_KEY=…/sepolia-shake-key.json

# 4. Prove each variant, then put each proof on-chain.
node snip36.mjs prove ecdsa
node snip36.mjs prove blake2s
node snip36.mjs prove shake
node snip36.mjs submit results/blake2s-<ts>.json            # consumer.apply with the proof
node snip36.mjs submit results/blake2s-<ts>.json --wrong-payload   # must be refused
node snip36.mjs report                                      # markdown table of all runs
```

`prove` writes `results/<variant>-<timestamp>.json` with the proof, proof facts, proving time,
proof size and, with `PQ_PROVER_PID` set for a non-Docker prover, its peak memory
(`docker stats prover` shows it otherwise). Proofs must be submitted within 5,000 blocks.

## What would count as success

1. `prove blake2s` returns a proof, and `submit` lands on Sepolia with `applied_count` going
   up: an SLH-DSA-BLAKE2s approval carried by a SNIP-36 proof, exactly as a private transfer
   would carry it.
2. The same for `shake`: a standard FIPS 205 signature authorising an action on Starknet.
3. Proving times for all three, which decide whether each is usable in Bramble (its proving
   budget is 180 s).
4. `--wrong-payload` and `--tamper` are refused.

## Tests

`snforge test -p pq_accounts` (13 tests) checks the probe with real BLAKE2s and SHAKE
signatures, including one made by `signer/slh_signer.py`, refuses tampered and misdirected
signatures and wrong callers, and checks the consumer against injected proof facts: wrong
program, stale or future base block, other user, other sender, other payload, extra messages
and replays.
