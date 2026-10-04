/**
 * The account index another wallet reserves on the shared account-index axis is
 * refused at every derivation boundary, so this wallet cannot derive a regular
 * account onto that branch.
 */
import { describe, expect, test } from "bun:test";
import {
  readCreateAccountInput,
  readDiscoverRecoveryAccountsInput,
  readPreviewAccountInput,
} from "../../../apps/extension/src/background/accounts/account-creation-inputs";

// Another wallet walks the same account-index axis and reserves this value for
// a segregated branch it keeps out of a mainstream wallet (#336).
const RESERVED = 0x41474e54;
const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";

const create = (accountIndex: number) =>
  readCreateAccountInput({
    accountContractType: "openzeppelin",
    accountIndex,
    mnemonic,
    type: "wallet.createAccount",
    vaultPassphrase,
  });

const preview = (accountIndex: number) =>
  readPreviewAccountInput({
    accountContractType: "openzeppelin",
    accountIndex,
    mnemonic,
    type: "wallet.previewAccount",
  });

const discover = (manualIndex: number) =>
  readDiscoverRecoveryAccountsInput({
    manualIndex,
    mnemonic,
    networkId: "SN_MAIN",
    type: "wallet.discoverRecoveryAccounts",
  });

describe("account index reservation", () => {
  test("refuses the reserved index when creating or previewing an account", () => {
    expect(create(RESERVED)).toBeNull();
    expect(preview(RESERVED)).toBeNull();
    // The neighbours prove the refusal is the reserved value, not a malformed
    // request that would fail for some other reason.
    expect(create(RESERVED - 1)).not.toBeNull();
    expect(preview(RESERVED + 1)).not.toBeNull();
  });

  test("refuses the reserved index as a recovery discovery index", () => {
    expect(discover(RESERVED)).toBeNull();
    expect(discover(RESERVED - 1)).not.toBeNull();
  });
});
