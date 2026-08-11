/**
 * Restoring the accounts a recovery phrase already has.
 *
 * These pin what the shared routine does with a scan's answer: it adds only what
 * the wallet does not already hold, at each account's own HD position rather than
 * the next free one, and it reports honestly enough to tell "nothing on chain"
 * apart from "everything already here". A failed scan must propagate — reporting
 * "no other accounts" because a node was down reads as the accounts being gone.
 */
import { describe, expect, test } from "bun:test";
import type { SeedScanCandidate } from "../../src/popup/responses";
import { restoreOutcomeMessage, restoreSeedAccounts } from "../../src/sidepanel/restore-accounts";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";

const candidate = (
  accountIndex: number,
  overrides: Partial<SeedScanCandidate> = {},
): SeedScanCandidate => ({
  accountIndex,
  address: `0x${(0xaaa + accountIndex).toString(16)}`,
  alreadyAdded: false,
  deployed: true,
  funded: false,
  ...overrides,
});

const walletFor = (candidates: readonly SeedScanCandidate[], failScan = false) => {
  const added: { readonly accountIndex: number | undefined; readonly networkId: string }[] = [];
  const wallet = {
    async addAccount(networkId: string, accountIndex?: number) {
      added.push({ accountIndex, networkId });
      return `SN_MAIN:0x${accountIndex}`;
    },
    async scanSeedAccounts() {
      if (failScan) {
        throw new Error("node unreachable");
      }
      return candidates;
    },
  } as unknown as SidepanelWallet;
  return { added, wallet };
};

describe("restoring accounts from a recovery phrase", () => {
  test("adds every found account at its own HD position", async () => {
    // The whole point of the explicit index: these sit at 0, 3 and 7, and adding
    // them by "next free index" would create 1 and 2 as junk and land 3 at the
    // wrong address.
    const { added, wallet } = walletFor([candidate(0), candidate(3), candidate(7)]);

    const outcome = await restoreSeedAccounts(wallet, "SN_MAIN");

    expect(added).toEqual([
      { accountIndex: 0, networkId: "SN_MAIN" },
      { accountIndex: 3, networkId: "SN_MAIN" },
      { accountIndex: 7, networkId: "SN_MAIN" },
    ]);
    expect(outcome).toEqual({ added: 3, found: 3 });
  });

  test("skips an account the wallet already holds", async () => {
    const { added, wallet } = walletFor([candidate(0, { alreadyAdded: true }), candidate(1)]);

    const outcome = await restoreSeedAccounts(wallet, "SN_MAIN");

    expect(added).toEqual([{ accountIndex: 1, networkId: "SN_MAIN" }]);
    // `found` counts what is on chain, so "found 2, added 1" stays reportable.
    expect(outcome).toEqual({ added: 1, found: 2 });
  });

  test("a failed scan propagates rather than reading as no accounts", async () => {
    const { added, wallet } = walletFor([], true);

    await expect(restoreSeedAccounts(wallet, "SN_MAIN")).rejects.toThrow("node unreachable");
    expect(added).toEqual([]);
  });

  test("a failed add stops the run so the reported count stays true", async () => {
    const added: number[] = [];
    const wallet = {
      async addAccount(_networkId: string, accountIndex?: number) {
        if (accountIndex === 3) {
          throw new Error("Account already exists");
        }
        added.push(accountIndex ?? -1);
        return "SN_MAIN:0x1";
      },
      async scanSeedAccounts() {
        return [candidate(0), candidate(3), candidate(7)];
      },
    } as unknown as SidepanelWallet;

    await expect(restoreSeedAccounts(wallet, "SN_MAIN")).rejects.toThrow("Account already exists");
    expect(added).toEqual([0]);
  });

  test("names the three outcomes distinctly", () => {
    expect(restoreOutcomeMessage({ added: 1, found: 2 })).toBe(
      "Restored 1 account from your recovery phrase.",
    );
    expect(restoreOutcomeMessage({ added: 2, found: 2 })).toBe(
      "Restored 2 accounts from your recovery phrase.",
    );
    // Same count of additions, different meaning: one wallet has everything
    // already, the other has nothing on chain to find.
    expect(restoreOutcomeMessage({ added: 0, found: 3 })).toBe(
      "Every account from your recovery phrase is already here.",
    );
    expect(restoreOutcomeMessage({ added: 0, found: 0 })).toBe(
      "No other accounts found for this recovery phrase on this network.",
    );
  });
});
