/**
 * Guard: central shared account fixtures must satisfy the real vault validator.
 * A stub the schema would reject quietly weakens every suite built on it and
 * stays green until an unrelated test routes it through `isAccountRef`. This
 * guard covers the background dispatcher and side-panel rendering fixtures,
 * including the distinct-account invariants their consumers rely on.
 */
import { describe, expect, test } from "bun:test";
import {
  account as sidepanelAccount,
  secondAccount as sidepanelSecondAccount,
} from "@mc-wallet/testkit/sidepanel";
import { isAccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  account as backgroundAccount,
  secondAccount as backgroundSecondAccount,
} from "../support/background-wallet-stub";

const accountFixtures: readonly (readonly [string, unknown])[] = [
  ["background account", backgroundAccount],
  ["background secondAccount", backgroundSecondAccount],
  ["sidepanel account", sidepanelAccount],
  ["sidepanel secondAccount", sidepanelSecondAccount],
];

const accountPairs = [
  ["background", backgroundAccount, backgroundSecondAccount],
  ["sidepanel", sidepanelAccount, sidepanelSecondAccount],
] as const;

describe("shared account fixtures", () => {
  for (const [name, fixture] of accountFixtures) {
    test(`${name} is a valid AccountRef`, () => {
      expect(isAccountRef(fixture)).toBe(true);
    });
  }

  for (const [name, first, second] of accountPairs) {
    test(`${name} fixtures are distinct accounts on one network`, () => {
      expect(second.id).not.toBe(first.id);
      expect(second.networkId).toBe(first.networkId);
      expect(second.derivation).not.toEqual(first.derivation);
    });
  }
});
