/** Recovery coordinates: which selections are well-formed, and which are the same account. */
import { describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_BASE_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import { isRecoveryAccountSelection, recoverySelectionKey } from "@bramble/wallet-model/recovery";

const argent030 = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.0");
if (!argent030) throw new Error("argent 0.3.0 missing from the class table");

describe("recovery selections", () => {
  test("carry the class each family's address derives from", () => {
    expect(
      isRecoveryAccountSelection({ accountContractType: "openzeppelin", accountIndex: 0 }),
    ).toBe(true);
    expect(isRecoveryAccountSelection({ accountContractType: "argent", accountIndex: 0 })).toBe(
      true,
    );
    expect(
      isRecoveryAccountSelection({
        accountContractType: "argent",
        accountIndex: 0,
        classHash: argent030.classHash,
      }),
    ).toBe(true);
    expect(
      isRecoveryAccountSelection({
        accountContractType: "braavos",
        accountIndex: 0,
        classHash: BRAAVOS_BASE_CLASS_HASH,
      }),
    ).toBe(true);
  });

  test("refuse a class the family could not have been deployed with", () => {
    const refused = [
      // OpenZeppelin's class is chosen per network; a selection cannot pick it.
      {
        accountContractType: "openzeppelin",
        accountIndex: 0,
        classHash: ARGENT_ACCOUNT_CLASS_HASH,
      },
      // Braavos has no default: this wallet never creates one.
      { accountContractType: "braavos", accountIndex: 0 },
      // A class from the other family.
      { accountContractType: "braavos", accountIndex: 0, classHash: argent030.classHash },
      { accountContractType: "argent", accountIndex: 0, classHash: BRAAVOS_BASE_CLASS_HASH },
      // Braavos's current class is an upgrade target, never a deploy class.
      {
        accountContractType: "braavos",
        accountIndex: 0,
        classHash: "0x3957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a",
      },
      { accountContractType: "argent", accountIndex: 0, classHash: "0x1234" },
      { accountContractType: "argent", accountIndex: 0, classHash: 7 },
      { accountContractType: "argent", accountIndex: 0, extra: true },
    ];
    for (const selection of refused) {
      expect(isRecoveryAccountSelection(selection), JSON.stringify(selection)).toBe(false);
    }
  });

  test("key two releases at one index apart, and one account one way", () => {
    const at = (classHash?: string) => ({
      accountContractType: "argent" as const,
      accountIndex: 4,
      ...(classHash === undefined ? {} : { classHash }),
    });
    expect(recoverySelectionKey(at(argent030.classHash))).not.toBe(
      recoverySelectionKey(at(ARGENT_ACCOUNT_CLASS_HASH)),
    );
    // Absent means the release this wallet creates, however that is spelled.
    expect(recoverySelectionKey(at())).toBe(recoverySelectionKey(at(ARGENT_ACCOUNT_CLASS_HASH)));
    expect(recoverySelectionKey(at(argent030.classHash))).toBe(
      recoverySelectionKey(at(argent030.classHash.replace("0x0", "0x"))),
    );
  });
});
