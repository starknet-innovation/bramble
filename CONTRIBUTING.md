# Contributing

This wallet handles private keys, encrypted state, and extension permissions. Treat every change as
security-sensitive unless it is plainly documentation-only.

## Prerequisites / Setup

Install dependencies from the frozen lockfile first:

```bash
bun install --frozen-lockfile
```

Some gates need a toolchain beyond Bun and are expected to fail in offline
sandboxes:

- `bun run vendor:krusty` needs network access, `wasm-pack 0.13.1`, and a Rust
  toolchain (build Krusty KMS).
- `bun run vendor:multisig` needs `scarb 2.18.0` exactly (the multisig class
  hash pin is only reproducible on that version).
- `bun run vendor:privacy` needs network access plus Node.js 24 and npm. It
  builds the exact pinned official Privacy SDK browser bundle and verifies its digest.

Without the vendored outputs, `check:krusty`, `check:multisig`, `check:privacy`, and `build` fail;
that is expected offline. Run the rest of the gates and say so.

Contributors can enable the local pre-push hook to run the offline-fast checks
(types, lint, file/config standards, extension manifest, unit tests) before
every push:

```bash
git config core.hooksPath .githooks
```

Bypass a single push with `git push --no-verify`.

## Required Gates

Run this before opening a pull request:

```bash
bun run vendor:krusty
bun run vendor:multisig
bun run vendor:privacy
bun run check
bun run test:e2e:install
bun run build
bun run test:e2e
bun run package:extension
```

CI runs the same gates. Do not merge around them.

## Workflow: branches, releases, and PRs

Work follows a **roadmap-driven, release-branch** model. The full, canonical
guide is **[DEVELOPMENT.md](DEVELOPMENT.md)** — read it before opening your first
PR. In short:

- `main` is always the latest stable, releasable version. **Do not push work to it.**
- Each release is a small slice of one roadmap phase, tracked as a **milestone**
  (`v0.4`, …) mapped 1:1 to a **`release/vX.Y`** branch cut from `main`. A phase
  (`phase:N` label + tracking issue #79–#87) spans several releases.
- Cut working branches from the **active release branch** and open PRs **against
  that release branch — not `main`**:
  - `feature/<issue>-<desc>`, `fix/<issue>-<desc>`, `chore/<issue>-<desc>`
  - `release/vX.Y`, `hotfix/<desc>`, `docs/<desc>`
- A PR into a release branch must reference its roadmap issue (`#N` /
  `Closes #N`), name its target release, state which acceptance criterion it
  satisfies, include tests, and stay in scope. CI's `pr-guards` job hard-blocks
  a `feature/`/`fix/` PR aimed at `main` and a release-branch PR with no linked
  issue (`chore/` and `docs/` may target `main` for plumbing that isn't part of
  a release slice).
- Releases are promoted to `main` via `release/**` (a **merge commit**, tagged
  `vX.Y.0`) and urgent fixes via `hotfix/**`. See DEVELOPMENT.md and RELEASING.md.

### Branch hygiene (delete-on-merge)

Keep the remote branch list scoped to branches that represent active, unmerged
work, so contributors find live branches without wading through already-landed
history.

- **Delete the head branch once its PR merges.** After confirming the target
  branch contains the PR's intended changes, the source branch is dead weight.
  Delete it
  (`git push origin --delete <branch>`, or the "Delete branch" button GitHub
  shows on a merged PR). This applies to every `feature/`, `fix/`, `chore/`,
  and `docs/` branch, and to `qa/*` triage branches.
- **Never delete a branch whose work is not yet on its target.** Check the
  merged PR and compare its intended diff with the target branch. Do not rely
  only on `git branch --merged`: squash-merges and cherry-picks preserve changes
  without preserving the source commit as an ancestor. A superseded-but-unmerged
  branch is deleted only after confirming its changes are preserved elsewhere;
  otherwise keep it and document the gap.
- **Long-lived branches are exempt:** `main` and any active `release/vX.Y`
  branch are never pruned.
- Maintainers may enable GitHub's repository setting *Settings → General →
  "Automatically delete head branches"* to make this automatic on merge; when it
  is off, the deletion is manual per this convention.

## Architecture Rules

- Keep files under 500 lines. Split by behavior, not by arbitrary layers.
- Keep modules narrow: crypto adapter, storage, migration, Starknet config, UI skin, popup, and
  background code stay separate.
- Pure code is the default. Side effects belong at browser, storage, network, clock, or randomness
  boundaries.
- Clock and randomness calls must stay in explicit boundary modules and remain covered by
  `bun run check`.
- Secret material fields may only appear in approved parser, session, crypto, encrypted-vault, and
  popup boundary modules enforced by `bun run check`.
- Krusty KMS owns wallet cryptography. Do not add fallback signing, key derivation, or mnemonic
  validation code.
- Krusty KMS source must stay pinned in `scripts/vendor-krusty.ts`; update the pin only with the
  full required gates.
- The official Privacy SDK source and browser bundle digest stay pinned in
  `scripts/vendor-privacy-sdk.ts` and `scripts/check-privacy-sdk.ts`. Do not replace its proving,
  note-discovery, or sub-account cryptography with local implementations.
- No fallback signing implementation. If Krusty KMS is unavailable, fail closed.
- Encrypted stores must validate decrypted data before use.
- Stored data access must go through permission checks. Do not read browser storage directly from UI
  code.
- Migrations must be deterministic functions with tests for old, current, and invalid data.
- UI code must depend on skin tokens, not hard-coded component-library details.
- Render dynamic text with `textContent` or `escapeHtml`; string HTML sinks stay in audited popup
  code only.
- Public APIs need doc comments that explain trust boundaries and failure behavior.

## Security Rules

- Never log secrets, ciphertext keys, mnemonics, signatures, passphrases, or decrypted vault data.
- STRK20 viewing keys stay inside the privileged vault/SDK boundary and are never returned through
  extension messages. Software-account viewing keys remain derived on demand and unpersisted. A
  Ledger viewing key may be retained only in the encrypted v4 `accountSecrets` collection through
  the background-only vault service, with an exact account/chain/pool/scheme binding; it must never
  enter `AccountRef`, preferences, activity, logs, session storage, or UI state.
- Use Web Crypto for local store encryption. Use Krusty KMS for wallet/account cryptography.
- Treat extension messages as untrusted input. Validate type, origin, and requested capability.
- Request the smallest browser permissions possible.
- Prefer deny-by-default switches and allow lists over block lists.
- Do not use eval-style dynamic code execution; packaged scripts only.
- Runtime dependencies must stay pinned and explicit. Dev-tool dependencies must be pinned exactly.
- Any dependency addition needs a reason in the pull request and must be used immediately.
- Any change to key derivation, signing, encryption, storage schema, or permissions needs tests.

## Taste

Green gates mean the change is **correct**. They do not mean it is **good**. Two changes can both pass every check and one can still be the wrong one: harder to read a year from now, easier to misuse, a single refactor away from a bug. We hold that second bar too. No script can measure it, so it falls to the author first and the reviewer second — judge a change not only by "does it meet the requirement" but "does it have the right taste."

The sensibility is borrowed from Haskell: push correctness into the types, keep effects at the edges, and prefer code that *cannot* be wrong over code that merely *happens* to be right.

- **Make illegal states unrepresentable.** If a value must never exist, the type should forbid it. Reach for a discriminated union or a branded type before a boolean flag plus a comment, or an "impossible" `default` branch. The best fix for a class of bug is the one that turns it into a compile error.
- **Parse, don't validate.** Validate untrusted input once, at the boundary, into a precise type — then trust that type everywhere within. A function that takes an `Address` is honest; one that takes a `string` and re-checks it at every call site is not.
- **Keep the core pure; push effects to the edges.** Clock, randomness, storage, network, and key material live only in their boundary modules — that is what `check:files` enforces, and it is a taste principle before it is a rule. Logic that is a pure function of its inputs is testable without mocks and impossible to make accidentally non-deterministic.
- **Total over partial.** Prefer functions defined for every input they accept. Handle every case of a union and let the compiler prove exhaustiveness; return a typed result or throw a typed error rather than handing back `undefined` and hoping the caller checks.
- **Name the domain, not the mechanism.** Types and functions should read like the problem (`ShieldedNote`, `approveInvoke`), not the plumbing (`DataObj`, `handleClick2`). Treating a `string` as an address or a `number` as an amount is primitive obsession — give the concept a name.
- **Compose small, orthogonal pieces.** One thing, at one level of abstraction. If you cannot describe a function without an "and," split it. Prefer composing existing helpers over adding a parameter — especially a boolean one — to an existing function.
- **Let the signature be the documentation.** If a reader must read the body to know what a function does or what it can throw, the signature is too weak. Encode the contract in the types; then a comment only has to explain *why*, never *what*.
- **One source of truth.** Two definitions of the same concept — a version, an address, an error shape — are a divergence waiting to happen. Define it once and import it (see the "Reuse before writing" note in `AGENTS.md`).

The test for good taste: the next person to touch this falls into the pit of success — the easy way to use it is the correct way, and the wrong way does not type-check. If you are writing a comment to warn a future caller off a footgun, first ask whether the types could take the footgun away.

## Commits & PRs

- Commits must be GPG-signed.
- Commit style follows the existing history: an imperative summary line, an
  optional scope prefix like `ci:`, and a body that explains the why.
- Pull requests are squash-merged, so keep the PR title and description in the
  same commit style — that is what lands on `main`.
- Any dependency addition needs a justification in the pull request, must be
  pinned exactly, and must be used immediately. Prefer zero new dependencies.

## Code Style

- TypeScript stays strict. Do not weaken `tsconfig.json`.
- Biome owns formatting and linting.
- Do not suppress TypeScript or lint rules. Fix the boundary or add a narrower validator.
- Type-only imports, parameter immutability, and non-null checks are enforced by lint.
- Avoid classes unless state or browser resources make them simpler.
- Avoid abstractions with one speculative caller. Add them when duplication or a boundary proves they
  are needed.
- Prefer explicit return types at exported boundaries.

## Documentation

Keep docs close to the boundary they describe:

- `README.md` explains setup and the current security posture.
- `CONTRIBUTING.md` defines contributor rules.
- Source doc comments explain exported contracts.
- Tests document migration and storage invariants with executable examples.
