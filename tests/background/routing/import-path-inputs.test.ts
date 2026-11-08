/**
 * Background message inputs pinned by the import-paths scope doc where no live
 * account can exercise them: the recovery selection cap at every restore
 * message (B6), and a BIP-39 passphrase on account creation (TA-46 / B7).
 */
import { describe, expect, test } from "bun:test";
import { RECOVERY_SCAN_LIMITS } from "@bramble/wallet-model/recovery";
import {
  readCreateAccountInput,
  readImportOwnAccountsInput,
  readImportSeedAccountsInput,
  readRecoverAccountsInput,
} from "../../../apps/extension/src/background/accounts/account-creation-inputs";

const vaultPassphrase = "correct horse battery staple";

describe("import-path message inputs", () => {
  test("caps every restore message at the recovery selection limit", () => {
    // Import-paths scope doc B6: 41 active accounts on one phrase is costly to
    // build on chain, so the cap is pinned here for each restore message.
    const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
    const pick = (count: number) =>
      Array.from({ length: count }, (_, accountIndex) => ({
        accountContractType: "openzeppelin" as const,
        accountIndex,
      }));
    const limit = RECOVERY_SCAN_LIMITS.maxSelections;
    const messages = {
      importOwn: (selections: unknown) =>
        readImportOwnAccountsInput({
          networkId: "SN_SEPOLIA",
          selections,
          type: "wallet.importOwnAccounts",
        }),
      importSeed: (selections: unknown) =>
        readImportSeedAccountsInput({
          mnemonic,
          networkId: "SN_SEPOLIA",
          selections,
          type: "wallet.importSeedAccounts",
        }),
      recover: (selections: unknown) =>
        readRecoverAccountsInput({
          mnemonic,
          networkId: "SN_SEPOLIA",
          selections,
          type: "wallet.recoverAccounts",
          vaultPassphrase,
        }),
    };
    for (const [name, read] of Object.entries(messages)) {
      expect({ name, accepted: read(pick(limit))?.selections.length }).toEqual({
        accepted: limit,
        name,
      });
      expect({ name, refused: read(pick(limit + 1)) }).toEqual({ name, refused: null });
    }
  });

  test("passes a BIP-39 passphrase on account creation through to the vault", () => {
    // No screen sends one today; a string within the bound must still pass.
    expect(
      readCreateAccountInput({
        accountContractType: "openzeppelin",
        mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
        mnemonicPassphrase: "x",
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toMatchObject({ mnemonicPassphrase: "x" });
  });
});
