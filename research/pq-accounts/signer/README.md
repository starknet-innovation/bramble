# SLH-DSA-128s signer (research)

> **Research code, not for real funds.** SLH-DSA-BLAKE2s-128s is a **non-standard**
> instantiation of FIPS 205's 128s parameter set with BLAKE2s in place of SHAKE. It has had
> no cryptographic review or audit, and this signer is a Python reference (about 2–3 s per
> signature).

`slh_signer.py` signs for `SlhDsaBlake2s128sAccount` (default) and, with
`keygen --scheme slh-dsa-shake-128s`, for the standard FIPS 205 `SlhDsaShake128sAccount`. The
key file records its scheme, and requests must name the same one. The cryptography is
`scripts/slh_dsa_ref.py`.

- **Keys:** `keygen` draws `SK.seed`, `SK.prf` and `PK.seed` from `secrets` and writes them
  to a new key file with mode 0600. It never overwrites a file and never prints secret
  material.
- **Signing:** deterministic (`opt_rand = PK.seed`), over the transaction hash as 32
  big-endian bytes through the pure interface with an empty context. Every signature is
  verified with the reference before it is returned.
- **Encoding:** each 16-byte element is one felt holding its bytes in little-endian order:
  2 public-key felts, 491 signature felts.

## Usage

```bash
python3 -I signer/slh_signer.py keygen --key my-slh-key.json   # prints the public key

# Serves one request on stdin and answers {"signature": [...]} on stdout:
echo '{"scheme":"slh-dsa-blake2s-128s","action":"sign-transaction","payload":{"hash":"0x1234"}}' \
  | python3 -I signer/slh_signer.py --key my-slh-key.json
```

`sepolia/run.mjs` drives it for a real account. Keep the key file private: anyone holding
it can sign for the account.
