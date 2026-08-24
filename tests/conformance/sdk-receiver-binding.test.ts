/**
 * Guards the receiver of every vendored-SDK method call.
 *
 * The pinned privacy SDK is class-based: `discoverRequirement(t,n){ return
 * this.discoveryProvider.discoverRequirement(this.user, ...) }`. Extracting such
 * a method into a local and calling it bare type-checks perfectly — TypeScript
 * models methods as plain function properties and says nothing about `this` —
 * and then throws `Cannot read properties of undefined` at runtime, before any
 * request leaves the wallet.
 *
 * That shipped once, in `registrationStatus`. It was invisible to the unit tests
 * because a hand-written fake is an object literal whose method closes over its
 * answer and never dereferences `this`, so the fixture agreed with the bug; and
 * it was invisible in the UI because a TypeError matches no error marker and
 * collapsed into a message four unrelated wallet-side checks also produce.
 *
 * So this pins the calling convention itself rather than any one call. A future
 * extraction passes its own tests and fails here.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { REPO_DIR, repoRelative } from "../support/workspace-sources";

const SDK_DIR = join(REPO_DIR, "packages/features/privacy/src/sdk");

// `const name = receiver.member;` — the extraction itself is fine (the code uses
// it for a capability check); only a later BARE call to `name` loses the
// receiver. `name.call(...)`/`name.bind(...)` and `receiver.name(...)` do not.
const EXTRACTION =
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.([A-Za-z_$][\w$]*)\s*;/g;

const detachedCalls = (source: string): readonly string[] => {
  const found: string[] = [];
  for (const match of source.matchAll(EXTRACTION)) {
    const local = match[1];
    const member = match[2];
    if (!local || !member) {
      continue;
    }
    // A bare call: the local name immediately applied, not reached through
    // `.call`/`.bind` and not a property of something else.
    const bareCall = new RegExp(`(?<![.\\w$])${local}\\s*\\(`);
    if (bareCall.test(source)) {
      found.push(`${local} (extracted from .${member})`);
    }
  }
  return found;
};

describe("vendored SDK methods keep their receiver", () => {
  test("no privacy SDK adapter calls an extracted method bare", async () => {
    const entries = (await readdir(SDK_DIR)).filter((name) => name.endsWith(".ts"));
    expect(entries.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const entry of entries) {
      const path = join(SDK_DIR, entry);
      const source = await readFile(path, "utf8");
      for (const detached of detachedCalls(source)) {
        offenders.push(`${repoRelative(path)}: ${detached}`);
      }
    }
    // A failure here means a method was pulled off its object and invoked
    // without it. Call it on the receiver, or `.call(receiver, ...)` when the
    // extraction is needed for a capability check.
    expect(offenders).toEqual([]);
  });

  test("the guard actually detects the shape that shipped", () => {
    const buggy = `
      const transfers = transfersFor(sdk, input);
      const discoverRequirement = transfers.discoverRequirement;
      if (!discoverRequirement) throw new WalletError(x);
      const requirement = await read(() => discoverRequirement(a, b));
    `;
    expect(detachedCalls(buggy)).toEqual([
      "discoverRequirement (extracted from .discoverRequirement)",
    ]);

    const fixed = buggy.replace(
      "discoverRequirement(a, b)",
      "discoverRequirement.call(transfers, a, b)",
    );
    expect(detachedCalls(fixed)).toEqual([]);

    // A data field that is never applied is not a receiver problem.
    const field = "const reviewedFee = accountPlan.reviewedFee;\nuse(reviewedFee);";
    expect(detachedCalls(field)).toEqual([]);
  });
});
