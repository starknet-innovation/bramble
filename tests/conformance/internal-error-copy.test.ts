/**
 * No error the wallet's own code throws reaches a reader in a developer's
 * words, and no security or cryptographic fact is hidden on the way (mc-wallet
 * issue 652).
 *
 * The background replies to its extension pages with any thrown message as
 * written (`runtimeErrorResponse`), and the panel shows an unmapped
 * capitalised message as written. This walks every message thrown in the
 * production sources, runs it through the real classifier, and requires each
 * to land in exactly one reviewed place:
 *
 * - collapsed (internal plumbing): never shown verbatim;
 * - a reviewed fact (FACT_KEPT) or a guarded unreviewed fact: shown with its
 *   words, never as the generic fallback;
 * - a reviewed sentence below: shown as written, by decision.
 *
 * A new thrown message fails here until someone decides which.
 */
import { describe, expect, test } from "bun:test";
import { friendlyError } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error";
import { UNEXPECTED_FALLBACK } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-copy";
import {
  FACT_KEPT,
  FACT_TERMS,
  INTERNAL_DIAGNOSTICS,
  isInternalDiagnostic,
} from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-internal";
import { PANEL_ERROR_SOURCES, thrownMessages } from "./internal-error-scan";

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

const REVIEWED_AS_WRITTEN = [READER_SENTENCES, GUARDED_FACTS, PENDING_COPY];

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
  const raws = new Set(thrown.map((entry) => entry.raw));

  test("the scan finds the strings it is meant to guard", () => {
    // A broken pattern would make every assertion below vacuously pass.
    expect(raws.size).toBeGreaterThan(250);
    for (const raw of ISSUE_NAMED) expect(raws.has(raw)).toBe(true);
  });

  test("the issue's named diagnostics are never shown as written", () => {
    for (const raw of ISSUE_NAMED) {
      expect(friendlyError(raw).message).not.toBe(raw);
      expect(friendlyError(raw).message).toBe(UNEXPECTED_FALLBACK);
    }
  });

  test("every thrown message is collapsed, translated, or reviewed as written", () => {
    const unreviewed = thrown
      .filter(({ raw }) => friendlyError(raw).message === raw.trim())
      .filter(({ raw }) => !FACT_KEPT.has(raw.trim().toLowerCase()))
      .filter(({ raw }) => !REVIEWED_AS_WRITTEN.some((set) => set.has(raw)))
      .map(({ file, raw }) => `${file}: ${raw}`)
      .sort();
    expect(unreviewed).toEqual([]);
  });

  test("no thrown internal diagnostic comes out verbatim", () => {
    const leaked = thrown
      .filter(({ raw }) => isInternalDiagnostic(raw.trim()))
      .filter(({ raw }) => friendlyError(raw).message === raw.trim())
      .map(({ raw }) => raw);
    expect(leaked).toEqual([]);
  });

  test("every thrown fact comes out with its facts, never as the generic fallback", () => {
    const hidden = thrown
      .filter(({ raw }) => FACT_TERMS.test(raw) || FACT_KEPT.has(raw.trim().toLowerCase()))
      .filter(({ raw }) => !INTERNAL_DIAGNOSTICS.has(raw.trim().toLowerCase()))
      .filter(({ raw }) => friendlyError(raw).message === UNEXPECTED_FALLBACK)
      .map(({ raw }) => raw);
    expect(hidden).toEqual([]);
  });

  test("every reviewed fact is still thrown and still shown as written", () => {
    const lowered = new Set([...raws].map((raw) => raw.toLowerCase()));
    expect([...FACT_KEPT].filter((fact) => !lowered.has(fact))).toEqual([]);
    for (const raw of raws) {
      if (FACT_KEPT.has(raw.toLowerCase())) expect(friendlyError(raw).message).toBe(raw);
    }
  });

  test("every reviewed-as-written entry is still thrown and still shown as written", () => {
    for (const set of REVIEWED_AS_WRITTEN) {
      for (const raw of set) {
        expect(raws.has(raw)).toBe(true);
        expect(friendlyError(raw).message).toBe(raw);
      }
    }
  });
});
