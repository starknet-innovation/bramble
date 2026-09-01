/**
 * What the Send recipient list tells the user about who they are paying.
 *
 * Split from sidepanel-transfer-ui by concern: that suite drives the transfer
 * lifecycle, while these assert the rendered provenance of a candidate
 * recipient. Pure render assertions — no wallet, device, or network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { account } from "@mc-wallet/testkit/sidepanel";
import type { AccountRef, LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { walletStatus as status } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};

// Built field by field rather than spread from the software account: a Ledger ref
// carries no `publicKeyY` and no `deploymentSalt`, and under
// `exactOptionalPropertyTypes` those keys must be absent, not undefined.
const ledgerAccount: LedgerAccountRef = {
  accountContractType: "openzeppelin",
  address: account.address,
  classHash: account.classHash,
  derivation: {
    accountIndex: 0,
    eip2645application: LEDGER_EIP2645_APPLICATION,
    kind: "ledger",
    path: ledgerAccountPath(0),
  },
  id: account.id,
  networkId: account.networkId,
  publicKeyX: account.publicKeyX,
};

const rowFor = (accounts: readonly AccountRef[], address: string): string => {
  const host = document.createElement("main");
  host.innerHTML = sendFlow({ ...status, accounts }, accounts[0] ?? null, preferences);
  return host.querySelector(`[data-send-recipient="${address}"]`)?.textContent ?? "";
};

describe("Send recipient list", () => {
  // Choosing a recipient is a decision about an account, and a hardware account
  // carries different signing and recovery consequences than a software one. The
  // same badge that marks it in account selection marks it here, so the
  // distinction never depends on which screen the user happens to be on.
  test("marks a hardware account, and only a hardware account", () => {
    expect(rowFor([ledgerAccount], ledgerAccount.address)).toContain("Hardware");
    expect(rowFor([account], account.address)).not.toContain("Hardware");
  });
});
