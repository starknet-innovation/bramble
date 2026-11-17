/**
 * Pure hide-decision checks: the three outcomes of `decideAccountHide` asserted
 * directly, including the ones a two-account vault cannot produce at the
 * dispatcher level (an already hidden successor, and a refusal scoped to the
 * target's own network rather than the active one).
 */
import { describe, expect, test } from "bun:test";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { decideAccountHide } from "../../../apps/extension/src/background/accounts/account-visibility-ops";
import { account } from "../../support/background-wallet-stub";

// The stub account is a Sepolia account; this makes mainnet siblings of it.
const at = (address: string): AccountRef => ({
  ...account,
  address,
  id: `SN_MAIN:${address}`,
  networkId: "SN_MAIN",
});

const elsewhere: AccountRef = { ...account, address: "0xsep", id: "SN_SEPOLIA:0xsep" };

const REFUSAL = "Can't hide the last account on this network";

describe("decideAccountHide", () => {
  test("refuses an account the vault does not hold", () => {
    expect(decideAccountHide([at("0x1")], at("0x1").id, [], "SN_MAIN:0xff")).toEqual({
      kind: "refuse",
      reason: "Unknown account",
    });
  });

  test("refuses the last account a network still shows", () => {
    expect(decideAccountHide([at("0x1")], at("0x1").id, [], at("0x1").id)).toEqual({
      kind: "refuse",
      reason: REFUSAL,
    });
  });

  test("needs no move when the account being hidden is not active", () => {
    expect(decideAccountHide([at("0x1"), at("0x2")], at("0x1").id, [], at("0x2").id)).toEqual({
      kind: "none",
    });
  });

  test("moves off the active account to a visible account on the same network", () => {
    const accounts = [at("0x1"), at("0x2"), elsewhere];

    expect(decideAccountHide(accounts, at("0x1").id, [], at("0x1").id)).toEqual({
      kind: "switchTo",
      accountId: at("0x2").id,
    });
  });

  test("does not treat an already hidden account as a successor", () => {
    const accounts = [at("0x1"), at("0x2")];

    expect(decideAccountHide(accounts, at("0x1").id, [at("0x2").id], at("0x1").id)).toEqual({
      kind: "refuse",
      reason: REFUSAL,
    });
  });

  test("scopes the refusal to the account's own network, not the active one", () => {
    // Two mainnet accounts and one Sepolia account: hiding the Sepolia one
    // leaves that network with nothing to show, though mainnet is unaffected.
    const accounts = [at("0x1"), at("0x2"), elsewhere];

    expect(decideAccountHide(accounts, at("0x1").id, [], elsewhere.id)).toEqual({
      kind: "refuse",
      reason: REFUSAL,
    });
  });
});
