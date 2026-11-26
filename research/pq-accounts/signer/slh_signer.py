#!/usr/bin/env python3
"""SLH-DSA-128s signer speaking a one-request JSON protocol on stdin/stdout.

Two hash instantiations, chosen at keygen and stored in the key file:

- slh-dsa-blake2s-128s: a NON-STANDARD instantiation of FIPS 205's 128s parameter set with
  BLAKE2s in place of SHAKE (see crates/slh_dsa_blake2s_128s/README.md). Elements pack
  little-endian.
- slh-dsa-shake-128s: standard FIPS 205 SLH-DSA-SHAKE-128s. Elements pack big-endian.

Research code: unaudited, and not for real funds.

The cryptography lives in scripts/slh_dsa_ref.py; this file only manages the key file and
speaks the JSON protocol. Signing is deterministic (opt_rand = PK.seed), signs the
transaction hash as 32 big-endian bytes through the pure interface with an empty
context, and self-verifies every signature before returning it. Each 16-byte element is
one felt (2 public-key felts, 491 signature felts), matching the Cairo verifiers.

Usage:
    python3 -I slh_signer.py keygen --key my-slh-key.json [--scheme slh-dsa-shake-128s]
    python3 -I slh_signer.py --key my-slh-key.json   # serves one request on stdin
"""

import argparse
import json
import os
import secrets
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
import slh_dsa_ref as ref  # noqa: E402

# Scheme name -> (hash instantiation, byte order of each 16-byte element in its felt), matching
# the Cairo verifiers: BLAKE2s packs little-endian, SHAKE (FIPS 205) big-endian.
INSTANTIATIONS = {
    "slh-dsa-blake2s-128s": (ref.Blake2s, "little"),
    "slh-dsa-shake-128s": (ref.Shake, "big"),
}
ALIASES = {
    "slh_dsa_blake2s_128s": "slh-dsa-blake2s-128s",
    "slh-dsa-blake2s-128s-x3": "slh-dsa-blake2s-128s",
    "slh-dsa-blake2s-128s-x4": "slh-dsa-blake2s-128s",
    "slh_dsa_shake_128s": "slh-dsa-shake-128s",
}
N = 16
SIG_BYTES = 7_856


def canonical_scheme(name: Any) -> str:
    scheme = ALIASES.get(name, name)
    if scheme not in INSTANTIATIONS:
        raise ValueError(f"unsupported scheme: {name}")
    return scheme


def felts(data: bytes, order: str = "little") -> list[str]:
    assert len(data) % N == 0
    return [hex(int.from_bytes(data[i : i + N], order)) for i in range(0, len(data), N)]


def keygen(args: argparse.Namespace) -> None:
    """Write a new key file (mode 0600). Never prints secret material."""
    if args.key.exists():
        raise SystemExit(f"refusing to overwrite existing key file {args.key}")
    scheme = canonical_scheme(args.scheme)
    inst, order = INSTANTIATIONS[scheme]
    slh = ref.Slh(inst())
    sk, pk = slh.keygen(secrets.token_bytes(N), secrets.token_bytes(N), secrets.token_bytes(N))
    data = {
        "scheme": scheme,
        "sk_seed": sk[0].hex(),
        "sk_prf": sk[1].hex(),
        "pk_seed": sk[2].hex(),
        "pk_root": sk[3].hex(),
        "public_key": felts(pk[0] + pk[1], order),
    }
    fd = os.open(args.key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(data, handle, indent=2)
    print(json.dumps({"publicKey": data["public_key"]}))


def load_key(
    path: Path,
) -> tuple[str, tuple[bytes, bytes, bytes, bytes], tuple[bytes, bytes], list[str]]:
    data = json.loads(path.read_text())
    # Key files written before SHAKE support carry the BLAKE2s scheme.
    scheme = canonical_scheme(data.get("scheme", "slh-dsa-blake2s-128s"))
    sk = tuple(bytes.fromhex(data[k]) for k in ("sk_seed", "sk_prf", "pk_seed", "pk_root"))
    pk = (sk[2], sk[3])
    if felts(pk[0] + pk[1], INSTANTIATIONS[scheme][1]) != data["public_key"]:
        raise ValueError("key file public_key does not match its seeds")
    return scheme, sk, pk, data["public_key"]


def request_hash(request: dict[str, Any]) -> int:
    value = (request.get("payload") or {}).get("hash")
    if value is None:
        raise ValueError("request payload must include hash")
    return int(str(value), 0)


def protocol(args: argparse.Namespace) -> None:
    scheme, sk, pk, public_key = load_key(args.key)
    request = json.loads(sys.stdin.read())
    action = request.get("action")
    if canonical_scheme(request.get("scheme")) != scheme:
        raise ValueError(f"key file is {scheme}, request asked for {request.get('scheme')}")
    inst, order = INSTANTIATIONS[scheme]

    if action == "public-key":
        print(json.dumps({"publicKey": public_key}))
        return

    if action in {"sign-hash", "sign-transaction", "sign-deploy-account"}:
        message = request_hash(request).to_bytes(32, "big")
        slh = ref.Slh(inst())
        signature = slh.sign(message, sk)
        if len(signature) != SIG_BYTES or not slh.verify(message, signature, pk):
            raise RuntimeError("signature failed self-verification")
        print(json.dumps({"signature": felts(signature, order)}))
        return

    raise ValueError(f"unsupported action: {action}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command")
    keygen_parser = subparsers.add_parser("keygen", help="generate a local key file")
    keygen_parser.add_argument("--key", type=Path, required=True, help="key file to write")
    keygen_parser.add_argument(
        "--scheme", default="slh-dsa-blake2s-128s", choices=sorted(INSTANTIATIONS), help="hash instantiation"
    )
    parser.add_argument("--key", type=Path, help="key file to read")
    args = parser.parse_args()

    if args.command == "keygen":
        keygen(args)
        return
    if args.key is None:
        parser.error("protocol mode requires --key")
    protocol(args)


if __name__ == "__main__":
    main()
