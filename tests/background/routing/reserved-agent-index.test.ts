/**
 * strkd keeps its agent accounts on hardened account index 0x41474E54
 * ("AGNT") of the same phrase, deliberately out of reach of a mainstream
 * wallet (#336). Bramble refuses that index at every boundary where one is
 * chosen: the shared index validator, restore selections, manual discovery
 * searches, and account creation or preview. Its neighbours stay usable.
 */
import { describe, expect, test } from "bun:test";
import {
  isRecoveryAccountIndex,
  isRecoveryAccountSelection,
  RECOVERY_SCAN_LIMITS,
  RESERVED_AGENT_ACCOUNT_INDEX,
} from "@bramble/wallet-model/recovery";
import {
  readDiscoverOwnAccountsInput,
  readDiscoverRecoveryAccountsInput,
  readPreviewAccountInput,
} from "../../../apps/extension/src/background/accounts/account-creation-inputs";
import { readCreateAccountInput } from "../../../apps/extension/src/background/routing/message-inputs";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const RESERVED = RESERVED_AGENT_ACCOUNT_INDEX;
const NEIGHBOURS = [RESERVED - 1, RESERVED + 1];

describe("strkd agent account index (#336)", () => {
  test("is the ASCII 'AGNT' hardened index strkd specified", () => {
    expect(RESERVED).toBe(0x41474e54);
    expect(RESERVED).toBe(1_095_192_148);
    expect(RESERVED).toBeLessThanOrEqual(RECOVERY_SCAN_LIMITS.maxIndex);
  });

  test("the shared index validator refuses it and keeps its neighbours", () => {
    expect(isRecoveryAccountIndex(RESERVED)).toBe(false);
    for (const index of NEIGHBOURS) expect(isRecoveryAccountIndex(index)).toBe(true);
  });

  test("a restore selection cannot name it", () => {
    for (const accountContractType of ["openzeppelin", "argent"] as const) {
      expect(isRecoveryAccountSelection({ accountContractType, accountIndex: RESERVED })).toBe(
        false,
      );
      expect(isRecoveryAccountSelection({ accountContractType, accountIndex: RESERVED + 1 })).toBe(
        true,
      );
    }
  });

  test("a manual discovery search cannot target it", () => {
    const recovery = (manualIndex: number) =>
      readDiscoverRecoveryAccountsInput({
        manualIndex,
        mnemonic,
        networkId: "SN_MAIN",
        type: "wallet.discoverRecoveryAccounts",
      });
    const own = (manualIndex: number) =>
      readDiscoverOwnAccountsInput({
        manualIndex,
        networkId: "SN_MAIN",
        type: "wallet.discoverOwnAccounts",
      });
    expect(recovery(RESERVED)).toBeNull();
    expect(own(RESERVED)).toBeNull();
    for (const index of NEIGHBOURS) {
      expect(recovery(index)).toEqual({ manualIndex: index, mnemonic, networkId: "SN_MAIN" });
      expect(own(index)).toEqual({ manualIndex: index, networkId: "SN_MAIN" });
    }
  });

  test("an account cannot be created or previewed there", () => {
    const create = (accountIndex: number) =>
      readCreateAccountInput({
        accountContractType: "openzeppelin",
        accountIndex,
        mnemonic,
        type: "wallet.createAccount",
        vaultPassphrase: "correct horse battery staple",
      });
    const preview = (accountIndex: number) =>
      readPreviewAccountInput({
        accountContractType: "openzeppelin",
        accountIndex,
        mnemonic,
        type: "wallet.previewAccount",
      });
    expect(create(RESERVED)).toBeNull();
    expect(preview(RESERVED)).toBeNull();
    for (const index of NEIGHBOURS) {
      expect(create(index)).not.toBeNull();
      expect(preview(index)).not.toBeNull();
    }
  });

  test("the sequential recovery walk is bounded far below it", () => {
    // The walk never passes `maxScannedIndexes`, so only a manual search could
    // reach the reserved index, and that is refused above.
    expect(RECOVERY_SCAN_LIMITS.maxScannedIndexes).toBeLessThan(RESERVED);
  });
});
