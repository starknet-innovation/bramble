/**
 * Trust inputs for the address-poisoning check never fail a send and never
 * add trust when storage faults: an unreadable activity log or multisig
 * registry contributes nothing (audit #163).
 */
import { describe, expect, test } from "bun:test";
import { withTrustedRecipients } from "../../../apps/extension/src/background/transactions/trusted-recipients";

const OWN = {
  address: "0x05f1c0ab2b4f6f1c1fd3e2b4c7a9d8e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0",
  networkId: "SN_MAIN" as const,
};
const failing = async (): Promise<never> => {
  throw new Error("storage unavailable");
};

describe("trusted recipients under storage faults", () => {
  test("an unreadable activity log and registry leave only the vault accounts", async () => {
    const result = await withTrustedRecipients(
      { activity: { list: failing }, multisigStore: { listMultisigs: failing } },
      { theme: "dark" },
      [OWN],
    );
    expect(result).toEqual({ ownAccounts: [OWN], paidRecipients: [], theme: "dark" });
  });

  test("no registry wired still yields the vault accounts", async () => {
    const result = await withTrustedRecipients({ activity: { list: failing } }, {}, []);
    expect(result).toEqual({ ownAccounts: [], paidRecipients: [] });
  });
});
