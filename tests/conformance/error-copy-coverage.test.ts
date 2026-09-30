/**
 * Every raw error string a user can be shown has been translated.
 *
 * The side panel displays whatever `friendlyError` hands back, and that
 * function returns an unrecognised string verbatim — so a diagnostic written
 * for a developer reaches a reader unless someone mapped it. This walks the
 * production sources for the two places those strings are minted, runs each
 * through the real classifier, and fails when one would survive to a toast.
 *
 * The Argent multisig vocabulary is the one exception, listed below: it is
 * reviewed with the multisig journey, whose wording it shares. The list is
 * checked against the sources too, so a deferred string that is deleted or
 * reworded cannot sit here pretending to be covered.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { friendlyError } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error";
import { ERROR_COPY } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-copy";

const root = join(import.meta.dir, "../..");

// Where a raw error string is minted: the background's error replies, and the
// panel runtime client's fallback when a reply is unrecognised.
const SOURCES = [
  "apps/extension/src",
  "packages/features",
  "packages/foundation",
  "packages/platform",
  "packages/presentation/wallet-ui/src/sidepanel",
];

const sourceFiles = (dir: string): string[] => {
  const absolute = join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "tests" && entry !== "node_modules") {
        out.push(...sourceFiles(join(dir, entry)));
      }
    } else if (entry.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
};

const ERROR_REPLY = /\{\s*error:\s*"([^"]{3,120})"/g;
// Matched on shape, not on the callee's name: the collectibles client
// imports responseError as `failure`, and a name-based scan missed five
// diagnostics for as long as it did.
const RUNTIME_FALLBACK = /\bthrow\s+[A-Za-z_$][\w$]*\(\s*[A-Za-z_$][\w$]*\s*,\s*"([^"]{3,120})"/g;

const rawErrorStrings = (): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const dir of SOURCES) {
    for (const file of sourceFiles(dir)) {
      const src = readFileSync(file, "utf8");
      for (const pattern of [ERROR_REPLY, RUNTIME_FALLBACK]) {
        pattern.lastIndex = 0;
        for (const match of src.matchAll(pattern)) {
          const raw = match[1];
          // A value with no space is a code, not a sentence — the Ledger
          // rejection union keys this way and carries its own message table.
          if (raw && /\s/.test(raw)) {
            found.add(raw);
          }
        }
      }
    }
  }
  return found;
};

// Reviewed with the multisig journey, not before it. Several of these tell a
// signer something they act on, so collapsing them to a generic sentence would
// lose more than it hides.
const DEFERRED = new Set([
  "switch to the multisig network first",
  "This intent is too large for secure relay sharing. Copy the intent package instead",
  "Signer-management intents require the complete current public signer configuration",
  "Signer set, threshold, and salt do not reproduce the watched multisig address",
  "multisig balances unavailable",
  "Multisig balances are loading.",
  "A supplied public key is not a current Stark signer for this multisig",
  "add Ready multisig failed",
  "Argent multisig deployment address needs STRK before deployment",
  "Argent multisig deployment did not reach the network. Try again.",
  "Argent multisig deployment must exactly match a fresh fee review",
  "Argent multisig deployment outcome is unresolved",
  "Argent multisig deployment review address mismatch",
  "Argent multisig deployment review unavailable",
  "Argent multisig has a pending or unresolved operation",
  "Argent multisig intent already has its threshold signatures",
  "Argent multisig intent is stale after a configuration change",
  "Argent multisig intent nonce is no longer current",
  "Argent multisig intent not found",
  "Argent multisig not found",
  "Argent multisig submission outcome is unresolved",
  "Argent multisig threshold is not satisfied",
  "co-signer sync failed",
  "confirm removal of terminal Argent multisig history",
  "conflicting Argent multisig intent id",
  "coordination identity unavailable",
  "deploy Ready multisig failed",
  "invalid Argent multisig deployment operation",
  "invalid Argent multisig intent package",
  "invalid Argent multisig prepared transaction",
  "invalid Argent multisig signature import",
  "invalid Argent multisig signing claim",
  "invalid Argent multisig submission claim",
  "multisig balance snapshot unavailable",
  "multisig not found on the active network",
  "Nostr relay update failed",
  "remove Ready multisig failed",
  "remove Ready multisig intent failed",
  "resolve multisig signer account failed",
  "review Ready multisig deployment failed",
  "Save a co-signer wallet card before sharing securely",
  "secure co-signer share failed",
  "Secure co-signer coordination is unavailable for this wallet",
  "Secure co-signer sharing is unavailable. Try again shortly",
  "Secure co-signer updates are unavailable. Try again shortly",
  "Secure co-signer updates could not be verified. Try again shortly",
  "selected account is not a current Argent multisig signer",
  "selected signer account is unavailable on this network",
  "selected signer is not a member of the reviewed constructor",
  "signature is not valid for this exact Argent multisig intent",
  "signer account lookup unavailable",
  "Signer keys cannot be verified until the multisig is deployed",
  "Signer public keys are invalid or duplicated",
  "stable Argent Multisig 0.2 class is not declared on this network",
  "this Argent multisig signer already signed the intent",
]);

describe("error copy coverage", () => {
  const raws = rawErrorStrings();

  test("the scan finds the strings it is meant to guard", () => {
    // A broken regex would make every assertion below vacuously pass.
    expect(raws.size).toBeGreaterThan(200);
    expect(raws.has("add token failed")).toBe(true);
  });

  // Reviewed means someone decided what the reader sees. Usually that is a
  // rewrite; occasionally the raw string was already the right sentence, and
  // an entry mapping it to itself records that decision rather than forcing a
  // change nobody wanted.
  const reviewed = (raw: string): boolean =>
    ERROR_COPY.has(raw.trim().toLowerCase()) ||
    friendlyError(raw).message !== raw.trim() ||
    DEFERRED.has(raw);

  test("no raw diagnostic reaches a reader unreviewed", () => {
    expect([...raws].filter((raw) => !reviewed(raw)).sort()).toEqual([]);
  });

  test("every deferred string is still minted somewhere", () => {
    expect([...DEFERRED].filter((raw) => !raws.has(raw)).sort()).toEqual([]);
  });

  test("a translated string keeps its raw form for the copy control", () => {
    // The mapping never edits the source, so the diagnostic a bug report
    // carries stays byte-identical to what the background threw.
    expect(raws.has("add token failed")).toBe(true);
    expect(friendlyError("add token failed").message).toBe(
      "Couldn't add that token. Check the contract address and try again.",
    );
  });
});
