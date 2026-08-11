/**
 * Adding the accounts a recovery phrase already has, once chosen.
 *
 * Selection is the user's on both surfaces that offer this, so nothing here may
 * decide what to add. These pin that only the given positions are added, at their
 * own HD index rather than the next free one, that a failed add stops the run so
 * the reported count stays true, and that the three outcomes read differently —
 * "nothing on chain" and "everything already here" are the same count but not the
 * same fact to someone expecting their accounts back.
 */
import { describe, expect, test } from "bun:test";
import { addAccountsAtIndexes, restoreOutcomeMessage } from "../../src/sidepanel/restore-accounts";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";

const walletFor = (failAt?: number) => {
  const added: { readonly accountIndex: number | undefined; readonly networkId: string }[] = [];
  const wallet = {
    async addAccount(networkId: string, accountIndex?: number) {
      if (accountIndex === failAt) {
        throw new Error("Account already exists");
      }
      added.push({ accountIndex, networkId });
      return `SN_MAIN:0x${accountIndex}`;
    },
  } as unknown as SidepanelWallet;
  return { added, wallet };
};

describe("adding chosen accounts from a recovery phrase", () => {
  test("adds exactly the chosen positions, lowest first", async () => {
    const { added, wallet } = walletFor();

    // The whole point of the explicit index: these sit at 3 and 7, and adding by
    // "next free index" would create 1 and 2 as junk and land 3 at the wrong
    // address. Passed out of order to pin the sort.
    expect(await addAccountsAtIndexes(wallet, "SN_MAIN", [7, 3])).toBe(2);
    expect(added).toEqual([
      { accountIndex: 3, networkId: "SN_MAIN" },
      { accountIndex: 7, networkId: "SN_MAIN" },
    ]);
  });

  test("adds nothing when nothing was chosen", async () => {
    const { added, wallet } = walletFor();

    expect(await addAccountsAtIndexes(wallet, "SN_MAIN", [])).toBe(0);
    expect(added).toEqual([]);
  });

  test("a failed add stops the run so the reported count stays true", async () => {
    const { added, wallet } = walletFor(3);

    await expect(addAccountsAtIndexes(wallet, "SN_MAIN", [0, 3, 7])).rejects.toThrow(
      "Account already exists",
    );
    expect(added).toEqual([{ accountIndex: 0, networkId: "SN_MAIN" }]);
  });

  test("names the outcomes distinctly", () => {
    expect(restoreOutcomeMessage({ added: 1, found: 2 })).toBe(
      "Added 1 account from your recovery phrase.",
    );
    expect(restoreOutcomeMessage({ added: 2, found: 2 })).toBe(
      "Added 2 accounts from your recovery phrase.",
    );
    // Same count of additions, different meaning.
    expect(restoreOutcomeMessage({ added: 0, found: 3 })).toBe(
      "Every account from your recovery phrase is already here.",
    );
    expect(restoreOutcomeMessage({ added: 0, found: 0 })).toBe(
      "No other accounts found for this recovery phrase on this network.",
    );
  });
});
