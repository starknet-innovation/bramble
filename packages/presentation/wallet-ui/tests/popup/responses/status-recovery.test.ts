/**
 * The optional `recovery` field on wallet status (Sherlock #138). The panel
 * picks the recovery gate from it, so an unknown reason is refused like any
 * other malformed status rather than rendered.
 */
import { describe, expect, test } from "bun:test";
import { isWalletStatus } from "../../../src/popup/responses/responses";

const locked = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: true,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

describe("wallet status recovery", () => {
  test("accepts a status without it, and each known reason", () => {
    expect(isWalletStatus(locked)).toBe(true);
    for (const recovery of ["invalid", "rollback", "unverified"]) {
      expect(isWalletStatus({ ...locked, recovery })).toBe(true);
    }
  });

  test("refuses an unknown reason", () => {
    expect(isWalletStatus({ ...locked, recovery: "reset" })).toBe(false);
    expect(isWalletStatus({ ...locked, recovery: null })).toBe(false);
    expect(isWalletStatus({ ...locked, recovery: 1 })).toBe(false);
  });
});
