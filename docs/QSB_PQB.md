# PQB integration

New vault deposits use PQB. Existing Config A entries continue to use their original
QSB-HORS-v1 derivation, Python runtime and disclosure rules, including unfinished registrations
and exact withdrawal retries. The account's dedicated recovery phrase and BIP84 payment owner
remain unchanged. PQB derives one separate BIP85 child per reserved vault index inside Krusty.

## Pins and runtime

- `@starknetfoundation/krusty-kms-wasm` is pinned exactly to **3.1.0**, with lockfile integrity
  and both shipped runtime digests checked before build. The existing Starknet, Bitcoin, Nostr
  and QSB known answers remain gates. Nostr envelope metadata is validated and retained by the
  adapter. Stored Starknet signing keys are preserved; 3.x's corrected Argent legacy derivation
  applies to new derivations (see upstream's `docs/migration-3.0.md` for historical recovery).
- `scripts/vendor-pqb.ts` pins qsb-app **f76891fb1a67f25d5dc97afd4e23ede707cd77d1**, the current
  SDK source used by its PQB runtime. Its upstream PQB source is Fireblocks commit
  **eccdd09772edf14ab37fc63992b0626ad7ff2221**.
- Run `bun run vendor:pqb` before check/build on a fresh checkout. It fetches only the selected
  source directories and builds the adapter with the repository's pinned Bun. No upstream
  install or build scripts run. Zod 4.6.7 and scure/base 2.4.0 support the SDK's schema/address
  imports; noble dependencies retain their existing exact versions.
- `scripts/pqb-sdk-entry.js` adapts the SDK's public packet/hit verification and witness
  assembly to Krusty's public material and selective disclosure. It never invokes seed-taking
  `buildLock` or `assemblePqb`. A static packaged module works in the MV3 worker; no remote
  scripts, new host permissions, CSP relaxation or offscreen document are needed. Zod JIT is
  disabled before upstream schema construction.
- `check:pqb` verifies the source pin, clean checkout and shipped bundle/license digests.
  Build and every workflow that vendors QSB also require the PQB step. The upstream MIT license
  and notices ship beside the module.

## Authorization

Krusty's vault and request handles stay inside the privileged adapter and are disposed on every
path. Neither a PQB seed, private co-signing key, complete secret table nor unselected menu
signature leaves WASM. The journal service receives public material and selected witnesses only.

The SDK reconstructs all three packets from the approved manifest, verifies the real puzzle
predicates and recovered key encodings, and checks the exact ordered 8+9 selections and pinning
nonce. Bramble verifies both previous transactions, destinations and fees and compares the exact
unsigned transaction. Krusty's independent stage sighashes must equal the SDK's. Its journal digest
is independently recomputed by the adapter from the full transaction and selections.

The current bound journal must durably record that digest before authorization. The selected
witnesses are assembled locally, the transaction binding is checked again, and Krusty signs the
payment helper. Signed bytes are encrypted durably before submission. A retry resends those same
bytes; uncertainty never creates a new authorization. JavaScript disclosure copies cannot be
reliably zeroized. They are dropped after assembly and never appear in extension responses.

The release review shows **17 one-time keys and 4 signatures**, with the existing conservative
unverified-scope warning and, for recovery, the explicit emergency-custody warning. The withdrawal
size bound comes from PQB's witness layout. A served `pqb-v1` protocol is required before saving
or retrying a PQB intent; Config A serving cannot start its withdrawal.

## Evidence and limits

The independent public assembly fixture is generated through the pinned SDK's original
`buildLock`/`assemble` test path using Krusty's published public wallet-vector 0, a two-input
transaction, unsorted 8+9 selections and menu indices 11/15/14. It records source identities,
public material, unsigned transaction, stage hashes, selected witnesses and exact expected bytes.
The real published WASM and the adapted assembly match those bytes. This is an assembly vector,
not a solved puzzle.

Tests cover migration, protocol separation, selections, public registration, funding, solver gates,
durable exposure, failed writes, exact retries, request mutation and the review's disclosure count.
The built-extension E2E tests register and fund against an offline test coordinator and reject an
invented PQB solution without disclosure. These do not establish miner acceptance, a real GPU
solve or a funded mainnet withdrawal. This change selects no production solver and changes no
coordinator deployment switches. Manifest/recovery limits are documented in `WALLET_STORE.md`.
