/** Recovery coordinates: which selections are well-formed, and which are the same account. */
import { describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_BASE_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import {
  isRecoveryAccountSelection,
  RECOVERY_SCAN_LIMITS,
  recoveryScanTarget,
  recoverySelectionKey,
} from "@bramble/wallet-model/recovery";

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

describe("recovery scan target", () => {
  const candidateAt = (
    accountIndex: number,
    evidence: Partial<Pick<RecoveryAccountCandidate, "deployed" | "funded">> = {},
  ): RecoveryAccountCandidate => ({
    account: {
      accountContractType: "openzeppelin",
      address: `0x${(accountIndex + 1).toString(16)}`,
      classHash: "0x1",
      derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" },
      id: `SN_MAIN:0x${(accountIndex + 1).toString(16)}`,
      networkId: "SN_MAIN",
      publicKeyX: "0x2",
      publicKeyY: "0x3",
    },
    deployed: false,
    funded: false,
    ...evidence,
  });

  test("covers the floor when nothing was found", () => {
    expect(recoveryScanTarget([])).toBe(RECOVERY_SCAN_LIMITS.defaultCount);
  });

  test("reaches a quiet tail past the last on-chain evidence", () => {
    // Activity at index 19 would be the last account a fixed window ever
    // offers; the target keeps the scan going for a full tail beyond it.
    expect(recoveryScanTarget([candidateAt(19, { deployed: true })])).toBe(
      20 + RECOVERY_SCAN_LIMITS.defaultCount,
    );
    expect(recoveryScanTarget([candidateAt(25, { funded: true })])).toBe(
      26 + RECOVERY_SCAN_LIMITS.defaultCount,
    );
  });

  test("ignores candidates offered without on-chain evidence", () => {
    // A creatable default at index 0 is an offer, not a finding.
    expect(recoveryScanTarget([candidateAt(17)])).toBe(RECOVERY_SCAN_LIMITS.defaultCount);
  });

  test("never exceeds the fail-safe ceiling", () => {
    expect(recoveryScanTarget([candidateAt(5000, { deployed: true })])).toBe(
      RECOVERY_SCAN_LIMITS.maxScannedIndexes,
    );
  });
});
