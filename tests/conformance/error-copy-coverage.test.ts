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
import {
  ERROR_COPY,
  UNEXPECTED_FALLBACK,
} from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-copy";

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

// Empty, and meant to stay that way. It held the Argent multisig vocabulary
// until the multisig copy pass translated it; a new entry here is a decision to
// ship a developer's words to a reader, so it needs the same justification the
// list itself once carried.
const DEFERRED = new Set<string>([]);

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
  //
  // The generic fallback is not a review. The classifier rewrites any
  // unmapped lowercase diagnostic to "Something went wrong", so counting any
  // rewrite as reviewed let every new lowercase string pass unread
  // (mc-wallet issue 476).
  const reviewed = (raw: string): boolean => {
    const message = friendlyError(raw).message;
    return (
      ERROR_COPY.has(raw.trim().toLowerCase()) ||
      (message !== raw.trim() && message !== UNEXPECTED_FALLBACK) ||
      DEFERRED.has(raw)
    );
  };

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
