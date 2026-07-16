/**
 * Invalid-input and locked-session branches of the connected-sites/origins
 * handler, driven directly with malformed messages and a locked session.
 */
import { describe, expect, test } from "bun:test";
import { handleOriginOps, type OriginOpsDeps } from "../src/background/origins-ops";
import type { WalletStatusReader } from "../src/background/runtime-types";
import { createUnlockSession } from "../src/background/session";

// Wallet stub whose methods must never run on the branches under test.
const unusedWallet = new Proxy(
  {},
  {
    get() {
      throw new Error("wallet must not be called on these branches");
    },
  },
) as unknown as WalletStatusReader;

const deps = (): OriginOpsDeps => ({
  session: createUnlockSession(),
  wallet: unusedWallet,
});

describe("handleOriginOps invalid/locked branches", () => {
  test("rejects a malformed connected-sites request", async () => {
    await expect(
      handleOriginOps(deps(), "wallet.connectedSites", {
        extra: true,
        type: "wallet.connectedSites",
      }),
    ).resolves.toEqual({ error: "invalid connected sites request" });
  });

  test("rejects a non-record connected-sites request", async () => {
    await expect(handleOriginOps(deps(), "wallet.connectedSites", null)).resolves.toEqual({
      error: "invalid connected sites request",
    });
  });

  test("reports wallet locked when revoking with a locked session", async () => {
    // The revoke input is well-formed, so the handler passes the input guard
    // and fails only at the locked-session check.
    await expect(
      handleOriginOps(deps(), "wallet.revokeOrigin", {
        origin: "https://dapp.example",
        type: "wallet.revokeOrigin",
      }),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("rejects a malformed revoke request before touching the session", async () => {
    await expect(
      handleOriginOps(deps(), "wallet.revokeOrigin", { type: "wallet.revokeOrigin" }),
    ).resolves.toEqual({ error: "invalid revoke origin request" });
  });

  test("returns null for an unrelated message type", async () => {
    expect(await handleOriginOps(deps(), "wallet.other", {})).toBeNull();
  });
});
