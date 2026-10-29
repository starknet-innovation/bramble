/** Recovery coordinates: which selections are well-formed, and which are the same account. */
import { describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_BASE_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import {
  isRecoveryAccountCandidate,
  isRecoveryAccountSelection,
  RECOVERY_SCAN_LIMITS,
  recoveryScanTarget,
  recoverySelectionKey,
  selectionDerivation,
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

describe("recovery selection derivation (issue 505)", () => {
  const argentAt1 = { accountContractType: "argent" as const, accountIndex: 1 };

  test("admits a scheme only where the family can walk that ladder", () => {
    expect(isRecoveryAccountSelection({ ...argentAt1, derivation: "argentx-bip44" })).toBe(true);
    expect(isRecoveryAccountSelection({ ...argentAt1, derivation: "starknet-bip44" })).toBe(true);
    expect(
      isRecoveryAccountSelection({
        accountContractType: "openzeppelin",
        accountIndex: 0,
        derivation: "starknet-bip44",
      }),
    ).toBe(true);
    // Only Argent exists on the Ready ladder.
    expect(
      isRecoveryAccountSelection({
        accountContractType: "openzeppelin",
        accountIndex: 0,
        derivation: "argentx-bip44",
      }),
    ).toBe(false);
    expect(
      isRecoveryAccountSelection({
        accountContractType: "braavos",
        accountIndex: 0,
        classHash: BRAAVOS_BASE_CLASS_HASH,
        derivation: "argentx-bip44",
      }),
    ).toBe(false);
    expect(isRecoveryAccountSelection({ ...argentAt1, derivation: "ledger" })).toBe(false);
  });

  test("defaults every family to its vendor scheme", () => {
    expect(selectionDerivation(argentAt1)).toBe("argentx-bip44");
    expect(selectionDerivation({ accountContractType: "openzeppelin", accountIndex: 0 })).toBe(
      "starknet-bip44",
    );
    expect(selectionDerivation({ accountContractType: "braavos", accountIndex: 2 })).toBe(
      "starknet-bip44",
    );
  });

  test("keys one Argent index on the two ladders as two coordinates", () => {
    const vendor = recoverySelectionKey({ ...argentAt1, derivation: "argentx-bip44" });
    const own = recoverySelectionKey({ ...argentAt1, derivation: "starknet-bip44" });
    expect(vendor).not.toBe(own);
    // Absent means the vendor ladder, however it is spelled.
    expect(recoverySelectionKey(argentAt1)).toBe(vendor);
  });
});

describe("recovery candidate restriction (issue 542)", () => {
  const account = {
    accountContractType: "argent" as const,
    address: "0x1",
    classHash: canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string,
    deploymentSalt: "0x3",
    derivation: { addressIndex: 0, kind: "argentx-bip44" as const },
    id: "SN_MAIN:0x1",
    networkId: "SN_MAIN" as const,
    publicKeyX: "0x4",
  };
  const candidate = { account, deployed: true, funded: false };

  test("admits each named restriction and nothing else", () => {
    expect(isRecoveryAccountCandidate(candidate)).toBe(true);
    for (const restriction of ["guardian", "owner-changed", "owner-type", "release"]) {
      expect(isRecoveryAccountCandidate({ ...candidate, restriction })).toBe(true);
    }
    expect(isRecoveryAccountCandidate({ ...candidate, restriction: "frozen" })).toBe(false);
    expect(isRecoveryAccountCandidate({ ...candidate, restriction: 1 })).toBe(false);
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

describe("selections and candidates found by address (issue 398)", () => {
  const pick = {
    accountContractType: "argent",
    accountIndex: 3,
    classHash: ARGENT_ACCOUNT_CLASS_HASH,
    derivation: "argentx-bip44",
  } as const;

  test("a selection may carry a canonical address on a family the owner reader matches", () => {
    expect(isRecoveryAccountSelection({ ...pick, address: "0x7e57" })).toBe(true);
    expect(
      isRecoveryAccountSelection({
        accountContractType: "braavos",
        accountIndex: 0,
        address: "0x7e57",
        classHash: BRAAVOS_BASE_CLASS_HASH,
      }),
    ).toBe(true);
    for (const address of ["0x07e57", "0x0", "0X7E57", 7, ""]) {
      expect(isRecoveryAccountSelection({ ...pick, address })).toBe(false);
    }
    expect(
      isRecoveryAccountSelection({
        accountContractType: "openzeppelin",
        accountIndex: 0,
        address: "0x7e57",
      }),
    ).toBe(false);
  });

  test("the address is part of the account's identity", () => {
    expect(recoverySelectionKey({ ...pick, address: "0x7e57" })).not.toBe(
      recoverySelectionKey(pick),
    );
    expect(recoverySelectionKey({ ...pick, address: "0x7e57" })).not.toBe(
      recoverySelectionKey({ ...pick, address: "0x7e58" }),
    );
  });

  test("a candidate marks itself found by address only with `true`", () => {
    const candidate: RecoveryAccountCandidate = {
      account: {
        accountContractType: "openzeppelin",
        address: "0x1",
        classHash: "0x1",
        derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
        id: "SN_MAIN:0x1",
        networkId: "SN_MAIN",
        publicKeyX: "0x2",
        publicKeyY: "0x3",
      },
      deployed: true,
      funded: false,
    };
    expect(isRecoveryAccountCandidate({ ...candidate, byAddress: true })).toBe(true);
    expect(isRecoveryAccountCandidate({ ...candidate, byAddress: false })).toBe(false);
  });
});
