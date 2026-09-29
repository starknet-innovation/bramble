/**
 * The wording patterns `check-copy.ts` warns about, and the surfaces it leaves
 * alone.
 *
 * Split from the gate for the same reason `file-standards-policy` is: the
 * patterns are a reviewed list that grows with what reviewers keep finding,
 * while the scanner that applies them does not change. Every entry here came
 * from a string this repository actually shipped — see `docs/COPY_STYLE.md`
 * for the rule each one enforces and the before/after it was derived from.
 */

/** One wording habit worth a second look, and the rule it belongs to. */
export type CopyPattern = {
  /** Why this reads badly, phrased as the fix. Printed with every hit. */
  readonly note: string;
  readonly pattern: RegExp;
  /** Short rule name, matching a heading in docs/COPY_STYLE.md. */
  readonly rule: string;
};

/**
 * Surfaces exempt from every pattern below. What a user reads to decide
 * whether to sign is edited as a reviewed group against "did we lose a fact?",
 * never against "is this shorter?" — so a decode that says a transaction "is
 * being" anything is reporting the chain, not narrating the wallet.
 */
export const COPY_EXEMPT_PATHS: readonly string[] = [
  "packages/features/transactions/src/routing/",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/approvals/",
  "packages/presentation/wallet-ui/src/sidepanel/shared/review-render.ts",
  "packages/presentation/wallet-ui/src/sidepanel/shared/sign-request",
];

/**
 * Directories scanned. The extension's own UI only: the UI Lab renders these
 * same templates, and the website and store listings are not covered by the
 * copy style yet.
 */
export const COPY_SCAN_ROOTS: readonly string[] = [
  "packages/presentation/wallet-ui/src",
  "packages/features/privacy/src",
  "packages/features/settings/src",
];

export const COPY_PATTERNS: readonly CopyPattern[] = [
  {
    // Deliberately future and conditional only. After a failure, "nothing was
    // submitted" answers the reader's first question and is a fact worth
    // stating; promising in advance that nothing *will* happen is the habit
    // this rule is about.
    note: "Pre-emptive reassurance reads as nervousness. Promising in advance that nothing will happen invites the doubt it answers — say it afterwards, when it is news.",
    pattern: /\bNothing\s+(?:is|else|will|happens|broadcasts|leaves|gets)\b/i,
    rule: "no unasked reassurance",
  },
  {
    note: "Unasked reassurance. A claim about what the wallet never does belongs in the security docs, not on a screen someone is trying to get through.",
    pattern: /\bnever\s+(?:leaves|touches|sees|reads)\b/i,
    rule: "no unasked reassurance",
  },
  {
    note: "Narrating the machine. Report the state the reader can act on; the wallet's own steps between are not news.",
    pattern: /\b(?:is|are)\s+being\b/i,
    rule: "do not narrate the machine",
  },
  {
    note: "Narrating the machine. The wallet naming itself as the actor of its own internals adds a subject the reader does not need.",
    pattern: /\bBramble\s+is\s+(?:checking|building|preparing|verifying|waiting)\b/i,
    rule: "do not narrate the machine",
  },
  {
    note: "Filler adverb. It adds no information and reads as reassurance about difficulty.",
    pattern: /\b(?:simply|easily|seamlessly|effortlessly|quickly and easily)\b/i,
    rule: "every word counts",
  },
  {
    note: "Marketing adjective. The wallet describes what something does, not how good it is.",
    pattern: /\b(?:seamless|robust|powerful|cutting-edge|state-of-the-art|blazing)\b/i,
    rule: "every word counts",
  },
  {
    note: "Throat-clearing. Cut the preamble and start at the fact.",
    pattern:
      /\b(?:Note that|Please note|Keep in mind|Be aware that|It is important to|Rest assured|Don't worry|Feel free to)\b/i,
    rule: "every word counts",
  },
  {
    note: "Padding. Prefer the shorter form: `to`, `use`, `use`, `about`.",
    pattern: /\b(?:in order to|utilize|leverage the|with regards to)\b/i,
    rule: "every word counts",
  },
  {
    note: "Acknowledgement prompt. A tick nobody can proceed without is a click, not a decision — state the consequence and let the button be the confirmation.",
    // The wallet speaks in the second person everywhere else, so a
    // first-person "I" is only ever the user signing a statement back to it.
    pattern: /\bI (?:understand|acknowledge|confirm|agree)\b/i,
    rule: "state the consequence, do not collect a tick",
  },
];
