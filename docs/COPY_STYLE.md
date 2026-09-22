# Copy style

How Bramble writes. Derived from an audit of the 646 user-facing strings in the extension, so most
of this records what the wallet already does — the parts that were inconsistent have a ruling.

Scope: everything a user reads in the extension (side panel, popup, onboarding tab, Ledger grant
tab, and the approval-review sentences in `packages/features/transactions/src/routing/`). The
website and the store listings are not covered yet.

## Voice

Bramble is the wallet talking to one person about their own money. Plain, specific, and calm.
It states what is true and what happens next, and it does not apologise, cheerlead, or hedge.

- Second person. "Your account", "you approve".
- Bramble refers to itself as **Bramble**, never "we" or "our". "Bramble cannot recover them for
  you", not "we can't recover them". "The wallet" is acceptable when the sentence is already
  crowded with the product name.
- No "please", no "sorry", no exclamation marks. The wallet does not beg or gush.
- Say what happens, not what the user should feel. "Nothing is saved unless you confirm", not
  "Don't worry — nothing is saved".

## Mechanics

**Sentence case everywhere** — buttons, headings, labels, menu items. Capitalise only the first
word and proper nouns (Bramble, Starknet, Ledger, Nostr, Argent, Ready, STRK, NFT, RPC, CSV).
Not `Ready Account` or `Custom Nostr relay`; write `Ready account` and `Custom Nostr relay`.

**Buttons are verb-first and short.** Median is three words; seven is the ceiling. `Copy address`,
`Review request`, `Try again`. A button that cannot start with a verb is probably a heading.

**No trailing period** on buttons, headings, labels, or single-clause hints. Use one when a hint is
two or more sentences.

**Straight apostrophes** (`'`), not curly (`’`). The majority of the wallet already does this, and
it keeps test assertions and greps from depending on an invisible distinction.

**One ellipsis character** (`…`), not three periods, on progress copy. Fourteen strings already use
it and three do not.

**Em dash with spaces** (` — `) for an aside. Nine strings use it and nothing misuses a hyphen for
the job; keep it that way.

**Ampersand in navigation labels**, "and" in prose. `Backup & recovery` as a menu item;
"the backup and recovery settings" in a sentence.

**Contractions, except in warnings.** Contract in ordinary copy — "You're all set", "tokens you
don't track". Spell it out when the sentence carries a security or irreversibility warning, where
the full form lands harder and reads more deliberate:

> Anyone with these words controls the wallet. Bramble cannot recover them for you.

**Empty states open with what is absent**, then what to do about it if there is anything to do.
"No tracked balances yet. Add or detect tokens to see them here."

**Errors say what happened and what to do next**, in that order, and never expose a raw error
string. "Couldn't estimate the fee. Check your connection and try again."

## Terminology

One name per concept. The ruled ones:

| Concept | Use | Not |
| --- | --- | --- |
| A user-made collection of accounts | **folder** | group, bucket |
| A website connected to the wallet | **site** | dapp, app, application |
| The Starknet application on a Ledger device | **the Starknet app** | — |
| The 12/24-word secret | **recovery phrase** | seed phrase, mnemonic |

`folder` is the UI word only. The code keeps `group` internally — `AccountGroups`,
`DEFAULT_GROUP_IDS`, and the stored `preferences.groups` key are unchanged, because renaming a
persisted key would need a vault migration and this is a copy change. UI and code diverging on one
noun is the cheaper trade.

## Length

Tighten wording; do not delete disclosure. A paragraph that is long because it discloses something —
what a third-party explorer learns, what the clipboard does with a recovery phrase, what a backup
does not restore — keeps every fact. Cut the words around the facts, not the facts.

Before changing any string longer than about 25 words, list the facts it currently conveys, then
check the rewrite still conveys each one.

## Copy that is not copy

Two categories are excluded from wording changes:

**Activity summaries.** Dedup guards match on them (see
`apps/extension/src/background/multisig/multisig-tx-ops.ts` and `AGENTS.md`). They are data. The
production set is one literal in `apps/extension/src/background/accounts/deployment-ops.ts` plus
the templates in `packages/features/transactions/src/routing/verify-decode.ts`. Changing one is a
behaviour change with a migration question about already-persisted entries, not a copy edit.

**Approval and review sentences.** What a user reads to decide whether to sign — the
`verify-decode.ts` call descriptions, `journeys/approvals/`, `journeys/ledger/`, and
`shared/review-render`. These may be edited, but as a reviewed group and against a
"did we lose a fact?" pass rather than a "is this shorter?" pass. A mistranslation of intent here
is a security bug.

## Working on copy

`bun run --filter @bramble/ui-lab dev` renders every screen at real dimensions from the production
templates. Review a journey there, not in the file.

Changing a string usually breaks a test — roughly 973 `toContain` assertions across 63 files pin
literal copy, plus 63 Playwright text matchers. That is the intended cost: the assertion is how we
find every place a string is load-bearing. Update the test in the same commit.
