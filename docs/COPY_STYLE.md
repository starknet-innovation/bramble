# Copy style

How Bramble writes. Derived from an audit of every user-facing string in the extension and from
the copy review that followed it, which removed about a thousand words of prose and added back
half that — most of what came out did not need rewriting, it needed deleting.

Scope: everything a user reads in the extension (side panel, popup, onboarding tab, Ledger grant
tab, and the approval-review sentences in `packages/features/transactions/src/routing/`). The
website and the store listings are not covered yet.

**Read "Every word counts" first.** The rest of this file is voice and mechanics — worth knowing,
rarely the reason a screen reads badly. Nine screens out of ten are fixed by deleting a sentence.

## Every word counts

The recurring feedback is that the wallet uses too many words, so people stop reading, and that
the excess reads as machine-written — which makes a wallet look unsafe. It is not caused by
flowery adjectives: the codebase contains no *seamless*, *robust*, *simply* or *easily* in
anything a user reads. It is caused by the eight habits below. Each one is a real before/after.

`bun run check:copy` warns about the mechanical half of these. It never fails a build: wording is
a judgement call and a regex cannot make it, so a hit is a question for the author, not a verdict.

### 1. Say the subject once per screen

The heading, the lede and the field label named the same thing three times.

> "Create your vault passphrase" · ~~"You will use this to unlock Bramble on this device."~~ · [Vault passphrase]

Drop the lede unless it carries a fact the heading and the controls do not.

### 2. A control keeps the user's verb

The button is what the reader asked for. A prerequisite is named on the screen that resolves it,
never folded into the label — a control that renames itself after the obstacle makes the obstacle
look like the destination.

> ~~"Deploy and enable"~~, ~~"Fund with STRK"~~ → **"Shield"**

The reason moves into the accessible name (`"Shield — add STRK to this account first"`), so a
screen reader hears it before the tap rather than after.

### 3. State the consequence; do not collect a tick

First-run carried five acknowledgement checkboxes. A tick nobody can proceed without is not a
decision, it is a click, and five of them teach the reader to click past exactly the sentences
that matter. The consequence goes in the copy, once; the button is the confirmation.

This does not apply to a per-transaction choice the reader can genuinely decline.

### 4. Do not narrate the machine

Report the state the reader can act on. The wallet's own steps between are not news.

> ~~"The reviewed transaction is being authorized inside the wallet."~~
> ~~"Starknet received the transaction. Bramble is checking its chain status now."~~

### 5. Unasked reassurance reads as nervousness

Promising in advance that nothing will happen invites the doubt it answers. This is the habit that
most makes the wallet feel unsafe, because confident software does not keep insisting.

> ~~"Nothing broadcasts until device approval is verified."~~
> ~~"Nothing else will be submitted"~~ — above a heading that already said the transaction was not sent

After a failure, "nothing was submitted" is different: it answers the reader's first question and
is worth stating. The rule is about the promise made in advance, not the fact reported afterwards.

### 6. Say what to do, not how it works

Mechanism is for a reader who can act on it. Someone with an empty account cannot act on a fee
breakdown.

> ~~"Going private is a one-time registration paid in STRK: the pool fee plus a network fee. This account does not hold enough STRK for it yet."~~
> → "Going private requires your account to be funded and activated." · "Deposit some STRK, then come back"

### 7. A label must be true of what it labels

"Risk and recovery" sat over neutral all-clear text on three screens, and "Maximum cost and
constraints" over a single fee. A label that overstates its contents trains the reader to
discount every label.

> ~~"Maximum cost and constraints"~~ → **"Cost"**

### 8. A number lives in one place

> ~~"This route returns 4.2% less value than you pay. Small orders can route poorly — try a larger amount or a different pair."~~ → **"High slippage risk"**

The figure stays on the button (`Swap anyway (−4.2%)`), where the decision is made.

### Before you add a sentence

Ask, in order: does the heading already say this? does the control already say this? can the
reader act on it? would they notice if it were gone? A sentence that survives all four earns its
place.

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

> Anyone with these words controls the wallet and its funds. Bramble cannot recover them for you.

**Warn where the wallet hands over a secret, not where the user brings one.** "Save your recovery
phrase" keeps its line, because Bramble just created something the user does not yet understand
the weight of:

> Anyone with these words controls the wallet and its funds. Bramble cannot recover them for you.

The import screens do not. "Anyone with this key controls the account. Paste it only on a device
you trust" arrives as the user is already pasting a key they already own onto a device they
already chose — too late to be advice, so it reads as scolding. Both private-key import screens
and the in-wallet phrase import carried a version of it; all three are gone.

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
| An account several people co-sign for | **multisig** | shared account, shared wallet |

"Shared" survives only where it is the verb — a wallet card or a public key *shared by* a
participant. An account is never a "shared account"; it is a multisig. Sentence case applies, so
it is `Multisigs` as a heading and "this multisig" mid-sentence, while `Ready Multisig 0.2` keeps
its capitals as a product name.

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

Cutting a disclosure outright is a separate, deliberate decision about whether the screen is the
right place for it at all — see "Warn where the wallet hands over a secret" above — not something
a tightening pass does on its way past. Deleting a sentence that discloses nothing is the
ordinary case, and "Every word counts" governs it.

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
