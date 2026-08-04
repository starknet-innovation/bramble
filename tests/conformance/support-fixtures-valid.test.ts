/**
 * Guard: the shared account fixtures in `tests/support/background-wallet-stub.ts`
 * must satisfy the real vault validator. A stub the schema would reject is not a
 * stub of anything — it quietly weakens every suite built on it, and stays green
 * for exactly as long as no test happens to route it through `isAccountRef`.
 * That is how a `secondAccount` whose id named one network while its `networkId`
 * named another survived in-tree: latent, never exercised, never red.
 *
 * Scoped to the background stub deliberately. The side-panel fixtures in
 * `tests/support/sidepanel-fixtures.ts` are internally consistent but use
 * 64-hex-digit addresses that exceed `STARK_FIELD_PRIME`, so they do not pass
 * `isAccountRef` today; widening this guard to them is a separate change.
 */
import { describe, expect, test } from "bun:test";
import { isAccountRef } from "../../src/storage/vault-schema";
import { account, secondAccount } from "../support/background-wallet-stub";

const accountFixtures: readonly (readonly [string, unknown])[] = [
  ["account", account],
  ["secondAccount", secondAccount],
];

describe("shared background stub fixtures", () => {
  for (const [name, fixture] of accountFixtures) {
    test(`${name} is a valid AccountRef`, () => {
      expect(isAccountRef(fixture)).toBe(true);
    });
  }

  test("the two stub accounts are distinct accounts on one network", () => {
    expect(secondAccount.id).not.toBe(account.id);
    expect(secondAccount.networkId).toBe(account.networkId);
    expect(secondAccount.derivation).not.toEqual(account.derivation);
  });
});
