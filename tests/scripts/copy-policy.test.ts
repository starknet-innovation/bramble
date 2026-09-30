/**
 * The copy warnings fire on wording this repository actually shipped and
 * deleted, and stay quiet on the wording that replaced it.
 *
 * Every `flagged` string below is a real literal removed during the copy
 * review; every `kept` string is either its replacement or a line the review
 * deliberately left alone. That is the point of the file: the gate is a
 * judgement call encoded as regexes, so the regexes are pinned to the
 * judgement rather than to themselves.
 */
import { describe, expect, test } from "bun:test";
import { COPY_EXEMPT_PATHS, COPY_EXEMPT_STRINGS, COPY_PATTERNS } from "../../scripts/copy-policy";

const rulesFor = (copy: string): readonly string[] =>
  COPY_PATTERNS.filter(({ pattern }) => pattern.test(copy)).map(({ rule }) => rule);

describe("copy patterns catch what the review deleted", () => {
  test.each([
    [
      "Review the request on your Ledger. Nothing broadcasts until device approval is verified.",
      "no unasked reassurance",
    ],
    ["Nothing else will be submitted", "no unasked reassurance"],
    ["The key never leaves this device unencrypted.", "no unasked reassurance"],
    // Plural subject. The rule read only the third-person form until the
    // Ledger grant tab turned up a sentence it could not see.
    ["Your keys never leave your Ledger.", "no unasked reassurance"],
    [
      "The reviewed transaction is being authorized inside the wallet.",
      "do not narrate the machine",
    ],
    ["Signed. The transaction is being broadcast to Starknet.", "do not narrate the machine"],
    [
      "Starknet received the transaction. Bramble is checking its chain status now.",
      "do not narrate the machine",
    ],
    [
      "I understand this wallet can hold real funds on Starknet Mainnet.",
      "state the consequence, do not collect a tick",
    ],
    [
      "This passphrase is weak. I understand it is all that protects this wallet on this device.",
      "state the consequence, do not collect a tick",
    ],
  ])("flags %j", (copy, rule) => {
    expect(rulesFor(copy)).toContain(rule);
  });
});

describe("copy patterns stay quiet on what replaced it", () => {
  test.each([
    // The rewrites this branch shipped.
    ["Review the request on your Ledger."],
    ["Transaction not sent"],
    ["High slippage risk"],
    ["Going private requires your account to be funded and activated."],
    ["Deposit some STRK, then come back"],
    [
      "Anyone with these words controls the wallet and its funds. Bramble cannot recover them for you.",
    ],
    ["Shield — add STRK to this account first"],
    // A past-tense statement after a failure answers the reader's first
    // question. Only a promise made in advance is the habit being flagged.
    ["Nothing was submitted; review the recipient and try again."],
    [
      "Nothing was sent. This version is no longer current. Create a current transaction to continue.",
    ],
    // Ordinary wallet copy that happens to contain a flagged word in a shape
    // the rules do not target.
    ["Deployment creates this account on-chain. Its address and signing authority do not change."],
    ["This account is not deployed yet; the first send also submits its deployment."],
  ])("allows %j", (copy) => {
    expect(rulesFor(copy)).toEqual([]);
  });
});

describe("the exemption list", () => {
  test("covers the surfaces a signer reads to decide", () => {
    // Approval, review and signing copy is edited as a reviewed group against
    // "did we lose a fact?", never "is this shorter?" — see docs/COPY_STYLE.md.
    // A decode that reports what a transaction is doing must not be mistaken
    // for the wallet narrating itself.
    expect(
      COPY_EXEMPT_PATHS.some((path) =>
        "packages/presentation/wallet-ui/src/sidepanel/journeys/approvals/approval-cards.ts".startsWith(
          path,
        ),
      ),
    ).toBe(true);
    expect(
      COPY_EXEMPT_PATHS.some((path) =>
        "packages/features/transactions/src/routing/verify-decode.ts".startsWith(path),
      ),
    ).toBe(true);
  });

  test("keeps only strings that a rule would otherwise flag", () => {
    // An exemption for a string no pattern catches is dead weight that reads
    // like a rule was bent. Each entry has to be earning its place.
    for (const { text } of COPY_EXEMPT_STRINGS) {
      expect(rulesFor(text), text).not.toEqual([]);
    }
  });
});
