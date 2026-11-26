#!/usr/bin/env python3
"""Generate the SLH-DSA-BLAKE2s-128s spike fixtures with scripts/slh_dsa_ref.py.

SLH-DSA-BLAKE2s-128s is a NON-STANDARD instantiation of FIPS 205's 128s parameter set
(see crates/slh_dsa_blake2s_128s/README.md). Each 16-byte element is encoded as one felt
holding the element's bytes in LITTLE-endian order, matching BLAKE2s's little-endian word
packing so the verifier never byte-swaps nodes.

Usage:
    python3 -I scripts/gen_slh_dsa_blake2s_fixture.py
"""
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import slh_dsa_ref as ref  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "crates/slh_dsa_blake2s_128s/src/fixtures.cairo"


def seed(label):
    return bytes.fromhex(hashlib.sha256(label.encode()).hexdigest()[:32])


def felts(data):
    assert len(data) % 16 == 0
    return [int.from_bytes(data[i:i + 16], "little") for i in range(0, len(data), 16)]


def cairo_values(values):
    lines = [f"0x{v:032x}," for v in values]
    return "\n".join(f"        {' '.join(lines[i:i + 2])}" for i in range(0, len(lines), 2))


def make(prefix, message_value):
    slh = ref.Slh(ref.Blake2s())
    sk, pk = slh.keygen(seed(f"{prefix} sk seed"), seed(f"{prefix} sk prf"), seed(f"{prefix} pk seed"))
    m = message_value.to_bytes(32, "big")
    sig = slh.sign(m, sk)
    assert len(sig) == 7_856
    assert slh.verify(m, sig, pk)
    assert not slh.verify((message_value + 1).to_bytes(32, "big"), sig, pk)
    return pk[0] + pk[1], sig


def block(suffix, message_value, pk, sig):
    return f"""
/// The transaction-hash field signed by fixture{suffix}.
pub fn message{suffix}() -> felt252 {{
    {message_value}
}}

/// `PK.seed || PK.root`, one little-endian 16-byte value per felt.
pub fn public_key{suffix}() -> Array<felt252> {{
    array![{", ".join(f"0x{v:032x}" for v in felts(pk))}]
}}

/// `R || SIG_FORS || SIG_HT`, one little-endian 16-byte value per felt.
pub fn signature{suffix}() -> Array<felt252> {{
    array![
{cairo_values(felts(sig))}
    ]
}}
"""


def main():
    msg1 = int.from_bytes(b"BENCH_MSG", "big")
    msg2 = int.from_bytes(hashlib.sha256(b"slh-dsa-blake2s second message").digest(), "big") % (2**251)
    pk1, sig1 = make("cairo-pq-verifiers SLH-DSA", msg1)
    pk2, sig2 = make("cairo-pq-verifiers SLH-DSA-BLAKE2s second key", msg2)
    out = """//! Generated SLH-DSA-BLAKE2s-128s spike fixtures (NON-STANDARD instantiation).
//!
//! Deterministic pure signatures with an empty context over the 32-byte big-endian
//! encoding of the message field, produced by `scripts/slh_dsa_ref.py`. Regenerate with
//! `python3 -I scripts/gen_slh_dsa_blake2s_fixture.py`.
""" + block("", msg1, pk1, sig1) + block("_2", msg2, pk2, sig2)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
