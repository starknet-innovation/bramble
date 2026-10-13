/**
 * What the side panel shows for every message the wallet's own code throws or
 * replies with (mc-wallet issue 652 and its review).
 *
 * The default is to show a message as written. This walks the production
 * sources — thrown errors, `{ error }` replies, `invariant` guards, string
 * constants, and template heads — runs each message through the real
 * classifier, and requires:
 *
 * - a message that comes out replaced is either a copy-table translation or on
 *   the explicit REVIEWED_PLUMBING list. Nothing is hidden implicitly;
 * - no security, cryptographic, privacy, signing, or approval message is
 *   replaced by the generic fallback or by a caller's context sentence;
 * - every message shown as written was decided on (lists below).
 */
import { describe, expect, test } from "bun:test";
import { isLedgerRejectionCode, ledgerMessage } from "@bramble/ledger-protocol/errors";
import { friendlyError } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error";
import {
  ERROR_COPY,
  UNEXPECTED_FALLBACK,
} from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-copy";
import {
  FACT_TERMS,
  isReviewedPlumbing,
  PLUMBING_DESPITE_FACT_WORD,
  REVIEWED_PLUMBING,
} from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-internal";
import { REVIEWED_PLUMBING_SNAPSHOT, SENSITIVE_COPY_REVIEWED } from "./internal-error-reviewed";
import { PANEL_ERROR_SOURCES, thrownMessages } from "./internal-error-scan";

// Constructor first arguments the scan reads as messages but are not: the
// PrivacyBlockerError kind tag ("fund", "deploy"), whose sentence is the
// second argument.
const NOT_MESSAGES = new Set(["fund", "deploy"]);

// The swap-build safety refusals (swap-build-policy.ts, avnu-route.ts). Each
// names the check that stopped the build, so each is shown as written (issue
// 652 review, R2-1); none may read as a vague sentence.
const SWAP_SAFETY_REFUSALS = [
  "swap build routed a token you are not selling",
  "swap build routed an amount you did not review",
  "swap build bought a token you did not choose",
  "swap build routed the proceeds to another account",
  "swap build accepted less than the minimum you reviewed",
  "swap build charged an aggregator fee beyond the wallet's cap",
  "swap build called a contract that is not the avnu router",
  "swap build called an entrypoint that is not an avnu swap",
  "swap build requested a direct token transfer",
  "swap build requested an additive token allowance",
  "swap build requested an unexpected token allowance",
  "swap build approved an unexpected spender",
  "swap build omitted the sell token approval",
  "swap build returned multiple token approvals",
  "swap build returned too many calls",
  "swap build returned no swap call",
  "swap build returned more than one swap call",
  "swap quote does not match the requested pair",
];

const CONTEXT = "Context sentence from the calling screen.";

// STRK20 shapes built from runtime values the scan cannot resolve
// (`${base} (${stage}/${category})`, strk20WaitExceeded), pinned by hand.
const STRK20_RUNTIME_SHAPES = [
  "strk20 services unavailable (submission/execution-reverted): reason",
  "strk20 services unavailable (submission/proof-rejected): reason",
  "strk20 services unavailable (submission/validation-failed): reason",
  "strk20 services unavailable (submission/invalid-nonce): reason",
  "strk20 services unavailable (proving/service-unavailable): reason",
  "strk20 privacy leak (proving/service-unavailable): USER_LINKAGE",
  "strk20 services unavailable: submission did not finish within 60 s",
];

// Security, cryptographic, privacy, signing, or approval messages: never
// replaced by the fallback or a context sentence.
const SENSITIVE = new RegExp(
  `${FACT_TERMS.source}|\\b(?:sign\\w*|approv\\w*|privacy|private|strk20)\\b`,
  "i",
);

// Already a sentence a reader can act on; shown as written by decision.
const READER_SENTENCES = new Set([
  "A 2FA removal is already pending for this account",
  "Account already exists",
  "Account deployment status is unknown. Check the account on-chain before retrying.",
  "Account is already deployed",
  "Account not found",
  "Account recovery is only available for Braavos accounts",
  "Account recovery is only available for Ready accounts",
  "Amount exceeds the multisig account balance",
  "Built-in tokens can't be removed",
  "Could not confirm the public balance required by this transaction",
  "Could not read NFT metadata URI",
  "Could not read NFT owner",
  "Could not read NFT ownership",
  "Enter a secure HTTPS service URL",
  "Guardian removal is still in its waiting period",
  "Host permission controls are unavailable in this browser",
  "No RPC endpoint answered on this network's chain",
  "Nostr coordination requires a recovery-phrase wallet",
  "Private pool fee changed. Review the transaction again.",
  "Private pool fee is unavailable. Retry the balance check.",
  "Private registration is no longer active",
  "Recovery fee exceeds the account's on-chain cap",
  "Select a multisig first",
  "Shielding route changed",
  "That signature is unavailable",
  "That transaction is unavailable",
  "The network fee for this declaration rose above the amount you reviewed. Nothing was submitted — review it again.",
  "The node did not return a declaration fee estimate",
  "The node did not return an invoke fee estimate",
  "The node quoted this fee in an unrecognised unit.",
  "The recovery fee could not be read in STRK.",
  "The recovery fee was not reviewed. Review it and try again.",
  "The recovery step changed. Review it and try again.",
  "The recovery was not reviewed. Review it and try again.",
  "This account has no 2FA signer to remove",
  "This account has no guardian to remove",
  "This account is not deployed on-chain yet and automatic deployment failed. Fund the account address with STRK to cover fees, then retry.",
  "This account is not deployed yet. Ask the participant to copy their public key from Receive.",
  "This account type cannot provide a signer key automatically. Ask the participant to copy their public key from Receive.",
  "This Argent account does not use a Stark public-key owner. Ask the participant to share a supported public key.",
  "Token not found",
  "Too many decimal places",
  "Too many pending approvals",
  "Too many pending approvals for this site",
  "Transfer amount must be greater than zero",
  "Wallet already exists",
  "Your browser did not grant access to that explorer host",
  "Your browser did not grant access to that service host",
  "Your browser did not grant access to those service hosts",
]);

// Facts that pass the guard unreviewed: a check that failed or could not run,
// or a device answer. Shown as written; reviewed copy may reword, not hide.
const GUARDED_FACTS = new Set([
  "Account deployment requires exactly one signature",
  "Account public key unavailable for the live signer check",
  "Argent account class hash is not a release this wallet recognizes",
  "Argent multisig signer history is too large to verify",
  "Argent multisig verification took too long. Check the RPC endpoint and retry.",
  "RPC accepted a different declared class hash. Check on-chain state before retrying.",
  "RPC accepted a different transaction hash. Check on-chain state before retrying.",
  "Starkscan balance does not match the request",
  // Device-originated: the Ledger answered without a version.
  "Ledger grant probe returned no version",
]);

// Developer wording still shown as written, pending reviewed copy (see the
// issue 652 copy proposal). Each needs a sentence; none hides a fact.
const PENDING_COPY = new Set([
  "Argent multisig batches cannot contain account self-calls",
  "Argent multisig internal upgrade callbacks cannot be called directly",
  "Argent multisig public signer configuration is unavailable",
  "Argent multisig removal signers must be unique",
  "Argent multisig signer configuration changed on-chain",
  "Argent multisig signer configuration is unavailable",
  "Argent multisig signer GUIDs must be unique",
  "Argent multisig signer is already configured",
  "Argent multisig signer is not configured",
  "Argent multisig signers must be unique",
  "Argent multisig threshold is unchanged",
  "Clipboard unavailable",
  "Conflicting Argent multisig signer events",
  "Imported Argent multisig has no counterfactual deployment parameters",
  "Ledger account index out of range",
  "Ledger STRK20 viewing key unavailable",
  "Ledger STRK20 viewing-key limit reached",
  "Local funding is unavailable",
  "No account selected",
  "Only Starknet signers are supported in Argent multisig management",
  "QR payload too long",
  "Signing key unavailable",
  "Transfer calldata is unavailable",
]);

// Developer wording kept visible on purpose (issue 652 review): it may carry a
// fact about calls being signed, chain data, or storage integrity, or it tells
// the reader which service is down. When in doubt a message stays visible.
const KEPT_VISIBLE = new Set([
  "Argent multisig deployment claim x",
  "Argent multisig is already deployed",
  "Argent multisig registry x",
  "Argent multisig intent x",
  "Argent multisig submission claim x",
  "Declared Argent multisig class is malformed",
  "Invalid Argent multisig accepted block response",
  "Invalid Argent multisig call",
  "Invalid Argent multisig calls",
  "Invalid Argent multisig calldata length",
  "Invalid Argent multisig execute calldata length",
  "Invalid Argent multisig management calldata",
  "Invalid Argent multisig management self-call",
  "Invalid Argent multisig management threshold",
  "Invalid Argent multisig resource bounds",
  "Invalid Argent multisig x response",
  "Unsupported Argent multisig self-call",
  "Invalid x",
  "Invalid x response",
  "Invalid Starknet contract class",
  "RPC returned a non-felt Starknet name address",
  "Storage access denied",
  "Encrypted store scope is required",
  // A field the reader types (multisig deploy form); shown so it names itself.
  "Invalid Argent multisig salt",
  // The KMS result-field checks: the field can be a public key or a signature.
  "Krusty KMS result missing field element: x",
  "Krusty KMS result missing non-zero field element: x",
  "Krusty KMS result missing string field: x",
  "Response exceeded its size limit",
  "Nostr relay connection closed",
  "Nostr relay connection failed",
  "Nostr relay publish failed",
  "Nostr relay refused the subscription",
  "Nostr relay sync failed",
  "Nostr relays are unavailable",
  "No RPC endpoints configured",
  "RPC endpoints are temporarily unavailable",
  "Starkscan does not index devnet",
  "Request too large to review",
  "Ledger needs attention",
]);

// Wallet-written sentences the wider scan found (constants, replies, UI copy).
const SCANNED_SENTENCES = new Set([
  "Deploy this account first (Settings → Deploy account).",
  "Not enough x",
  "The network fee was not reviewed. Nothing was submitted — review the transaction again.",
  "The network fee for this transaction rose above the amount you reviewed. Nothing was submitted — review it again.",
  "The transaction could not be recorded before sending. Nothing was submitted — try again.",
  "The account deployment fee rose above the amount you reviewed. Nothing was submitted — review it again.",
  "The account deployment fee was not reviewed. Nothing was submitted — deploy the account first.",
  "The recovery fee changed. Review it and try again.",
  "Passphrase must be at least x characters",
  "Multisig balances are loading.",
  "The transaction was not sent. x",
  "Enter an amount greater than zero.",
  "Review this send first",
]);

const REVIEWED_AS_WRITTEN = [
  READER_SENTENCES,
  GUARDED_FACTS,
  PENDING_COPY,
  KEPT_VISIBLE,
  SCANNED_SENTENCES,
];

// The strings issue 652 named, which must stay collapsed.
const ISSUE_NAMED = [
  "Invalid Ledger account index",
  "Invalid Ledger path application",
  "Invalid Starknet network",
  "Invalid account class hash",
  "Invalid account deployment salt",
  "Account class hash does not belong to its account family",
  "Krusty KMS returned invalid class hash JSON",
  "Krusty KMS returned an invalid class hash",
  "Krusty KMS class hashes are missing oz accounts",
  "Devnet account class hash is invalid",
  "Invalid vault",
  "Unlock session changed during vault creation",
];

describe("internal error copy (issue 652)", () => {
  const thrown = thrownMessages(PANEL_ERROR_SOURCES);
  const raws = new Set(thrown.map((entry) => entry.raw).filter((raw) => !NOT_MESSAGES.has(raw)));
  const messages = [...raws, ...STRK20_RUNTIME_SHAPES];

  test("the scan finds the strings it is meant to guard", () => {
    // A broken pattern would make every assertion below vacuously pass.
    expect(raws.size).toBeGreaterThan(550);
    for (const raw of ISSUE_NAMED) expect(raws.has(raw)).toBe(true);
    // Constants, templates and replies are read, not only `new Error("…")`.
    expect(
      raws.has(
        "strk20 services unavailable: submission status is unknown; close every browser window and reopen the browser to recover",
      ),
    ).toBe(true);
    expect(raws.has("strk20 privacy leak")).toBe(true);
    expect(raws.has("Krusty KMS export missing: x")).toBe(true);
  });

  test("every scanned message without a space is a Ledger code read as its catalog sentence", () => {
    const words = [...raws].filter((raw) => !/\s/.test(raw));
    expect(words.length).toBeGreaterThan(0);
    for (const raw of words) {
      expect(isLedgerRejectionCode(raw), raw).toBe(true);
      if (isLedgerRejectionCode(raw)) expect(friendlyError(raw).message).toBe(ledgerMessage(raw));
    }
  });

  test("every swap-build safety refusal is read and shown as written (R2-1)", () => {
    for (const raw of SWAP_SAFETY_REFUSALS) {
      expect(raws.has(raw), raw).toBe(true);
      expect(friendlyError(raw).message, raw).toBe(raw);
      expect(friendlyError(raw, CONTEXT).message, raw).toBe(raw);
    }
  });

  test("the plumbing list matches its reviewed snapshot (hiding a message takes two edits)", () => {
    expect([...REVIEWED_PLUMBING.keys()].sort()).toEqual([...REVIEWED_PLUMBING_SNAPSHOT]);
  });

  test("every sensitive copy-table mapping matches its reviewed snapshot", () => {
    const current = [...ERROR_COPY].filter(([raw]) => SENSITIVE.test(raw));
    expect(current).toEqual(SENSITIVE_COPY_REVIEWED.map(([raw, copy]) => [raw, copy]));
  });

  test("no sensitive message is on the plumbing list unless its reason is recorded", () => {
    const listed = [...REVIEWED_PLUMBING.keys()].filter((raw) => SENSITIVE.test(raw));
    expect(listed.every((raw) => PLUMBING_DESPITE_FACT_WORD.has(raw))).toBe(true);
    for (const raw of SWAP_SAFETY_REFUSALS) expect(REVIEWED_PLUMBING.has(raw)).toBe(false);
  });

  test("the issue's named diagnostics are replaced", () => {
    for (const raw of ISSUE_NAMED) expect(friendlyError(raw).message).toBe(UNEXPECTED_FALLBACK);
  });

  test("a replaced message is a copy-table translation or explicitly reviewed plumbing", () => {
    const implicit = messages
      .filter((raw) => friendlyError(raw).message === UNEXPECTED_FALLBACK)
      .filter((raw) => !ERROR_COPY.has(raw.trim().toLowerCase()))
      .filter((raw) => !isReviewedPlumbing(raw.trim()))
      .sort();
    expect(implicit).toEqual([]);
  });

  test("every reviewed plumbing entry is still minted", () => {
    const lowered = new Set([...raws].map((raw) => raw.toLowerCase()));
    expect([...REVIEWED_PLUMBING.keys()].filter((raw) => !lowered.has(raw)).sort()).toEqual([]);
  });

  test("no sensitive message is replaced by the fallback or a context sentence", () => {
    const hidden = messages
      .filter((raw) => SENSITIVE.test(raw))
      .filter((raw) => {
        const plain = friendlyError(raw).message;
        const withContext = friendlyError(raw, CONTEXT).message;
        return plain === UNEXPECTED_FALLBACK || withContext === CONTEXT;
      })
      .filter((raw) => !isReviewedPlumbing(raw.trim()))
      .sort();
    expect(hidden).toEqual([]);
  });

  test("every message shown as written was decided on", () => {
    const unreviewed = thrown
      .filter(({ raw }) => /^[A-Z]/.test(raw))
      .filter(({ raw }) => friendlyError(raw).message === raw.trim())
      .filter(({ raw }) => !REVIEWED_AS_WRITTEN.some((set) => set.has(raw)))
      .filter(({ raw }) => !SENSITIVE.test(raw))
      .map(({ file, raw }) => `${file}: ${raw}`)
      .sort();
    expect(unreviewed).toEqual([]);
  });

  test("every reviewed-as-written entry is still minted and still shown as written", () => {
    for (const set of REVIEWED_AS_WRITTEN) {
      for (const raw of set) {
        expect(raws.has(raw)).toBe(true);
        expect(friendlyError(raw).message).toBe(raw);
      }
    }
  });
});
