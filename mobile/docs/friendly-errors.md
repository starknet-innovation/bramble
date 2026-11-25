# Friendly error copy on mobile

The core's refusals are fixed sentences written for a developer ("swap quote failed",
"invalid revoke request", "Invalid Argent multisig intent package"). The extension never shows
them as written: `friendlyError` (`packages/presentation/wallet-ui/src/sidepanel/runtime/
friendly-error.ts`) maps each to a reader's sentence. Mobile now does the same, with the same
tables and the same matching.

## Pieces

| Piece | Where | Written by |
| --- | --- | --- |
| `ERROR_COPY` (with the address, multisig, privacy and internal tables it merges) | `FriendlyErrorCopy.generated.{swift,kt}` | `scripts/mobile-assets/friendly-errors.ts` |
| Patterns, reviewed plumbing, Ledger catalog, transport markers, STRK20 category sentences, messages | `FriendlyErrorRules.generated.{swift,kt}` | same |
| The matching order | `Errors/FriendlyError.swift`, `errors/FriendlyError.kt` | by hand, step for step |
| Parity vectors (raw string → what the extension shows) | `FriendlyErrorVectors.generated.{swift,kt}` (unit tests) | same generator, by running `friendlyError` |

All generated files are held by `tests/conformance/mobile-generated.test.ts`, so a table or
pattern change in the extension fails the drift gate until `bun run mobile:assets` is re-run. The
extension exports its classifier's patterns (`FRIENDLY_ERROR_RULES`, `KMS_TEMPLATE_PLUMBING`,
`NETWORK_FAILURE_MARKERS`, `LEDGER_MESSAGES`) only for this generator.

## Matching

Same order as `friendlyError`: empty → fallback; the copy table (lowercased); a Ledger code; an
"invalid … request"; reviewed plumbing → fallback; STRK20 messages; rate limits; raw RPC; transport
failures; raw service answers (over 240 UTF-16 units, several lines, HTTP markers or JSON); a
lowercase diagnostic that names no security, privacy or funds fact → fallback; else as written.
The fallback is the caller's `context` sentence, or "Something went wrong. Please try again."

Patterns are JavaScript sources run on ICU (`NSRegularExpression`) and `java.util.regex`. The
generator turns `/i` into `(?i)`, escapes a bare `[` inside a character class (both engines read it
as a nested set) and refuses any other flag or `&&`. `\b` and `\w` follow each engine's definition;
the parity vectors pin the strings the core writes. The ports differ from JavaScript only on
non-ASCII edges no core message has: a letter such as `é` beside a `\b`, and a trailing U+0085
or leading U+FEFF, which the native `trim`, `.` and `$` treat differently. A differential run of
every copy-table and plumbing key, upper- and lowercased, matched on both platforms.

## What does not go through it

Approval, review and signing text: `RiskFlag.message`, review summaries, swap call lines. Those
are shown exactly as the core wrote them.
