/**
 * Allowance-ops handler branches: malformed list/revoke messages, a locked
 * wallet on both the list and revoke paths, an external-allowance scan that
 * short-circuits when the active network tracks no tokens, and a revoke of an
 * allowance recorded under a different account.
 */
import { describe, expect, test } from "bun:test";
import { handleAllowanceOps } from "../../src/background/allowance-ops";
import { createUnlockSession } from "../../src/background/session";
import type { WalletOpsDeps } from "../../src/background/wallet-ops";
import { defaultWalletPreferences } from "../../src/storage/preferences-store";
import type { AccountRef } from "../../src/storage/vault-schema";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const passphrase = "correct horse battery staple";
const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

type Options = {
  readonly locked?: boolean;
  readonly tokens?: readonly unknown[];
  readonly listRecords?: readonly unknown[];
  readonly rpcOverrides?: Parameters<typeof makeRuntimeRpc>[0];
};

const deps = (options: Options = {}): WalletOpsDeps => {
  const session = createUnlockSession();
  if (!options.locked) {
    session.unlock(passphrase);
  }
  const preferences = {
    ...defaultWalletPreferences(),
    activeNetworkId: "SN_MAIN" as const,
    tokens: (options.tokens ?? []) as never,
  };
  return {
    activity: {
      async list() {
        return [];
      },
      async record() {},
      async updateStatuses() {
        return [];
      },
    },
    allowanceStore: {
      async list() {
        return (options.listRecords ?? []) as never;
      },
      async record() {},
    } as unknown as WalletOpsDeps["allowanceStore"],
    preferencesStore: {
      async read() {
        return preferences;
      },
    } as unknown as WalletOpsDeps["preferencesStore"],
    runtimeRpc: makeRuntimeRpc(options.rpcOverrides),
    session,
    wallet: {
      async readVault() {
        return { accounts: [account], activeAccountId: account.id } as never;
      },
    } as unknown as WalletOpsDeps["wallet"],
  };
};

describe("handleAllowanceOps message guards", () => {
  test("returns null for unrelated message types", async () => {
    await expect(handleAllowanceOps(deps(), "wallet.other", {})).resolves.toBeNull();
  });

  test("rejects a malformed allowances request", async () => {
    await expect(
      handleAllowanceOps(deps(), "wallet.allowances", { extra: 1, type: "wallet.allowances" }),
    ).resolves.toEqual({ error: "invalid allowances request" });
  });

  test("rejects a malformed revoke request", async () => {
    await expect(
      handleAllowanceOps(deps(), "wallet.revokeAllowance", { type: "wallet.revokeAllowance" }),
    ).resolves.toEqual({ error: "invalid revoke request" });
  });
});

describe("handleAllowanceOps locked wallet", () => {
  test("lists an empty allowance set when the wallet is locked", async () => {
    await expect(
      handleAllowanceOps(deps({ locked: true }), "wallet.allowances", {
        type: "wallet.allowances",
      }),
    ).resolves.toEqual({ allowances: [], ok: true });
  });

  test("surfaces the context error when revoking with a locked wallet", async () => {
    await expect(
      handleAllowanceOps(deps({ locked: true }), "wallet.revokeAllowance", {
        id: "SN_MAIN:0x1:0x2:0x3",
        type: "wallet.revokeAllowance",
      }),
    ).resolves.toEqual({ error: "wallet locked" });
  });
});

describe("handleAllowanceOps external discovery", () => {
  test("returns only in-wallet allowances when the active network tracks no tokens", async () => {
    let scanned = false;
    const response = await handleAllowanceOps(
      deps({
        tokens: [],
        rpcOverrides: {
          async getExternalAllowances() {
            scanned = true;
            return [];
          },
        },
      }),
      "wallet.allowances",
      { type: "wallet.allowances" },
    );

    expect(response).toEqual({ allowances: [], ok: true });
    // The empty-token short-circuit means the external scan is never invoked.
    expect(scanned).toBe(false);
  });
});

describe("handleAllowanceOps cross-account revoke", () => {
  test("refuses to revoke an allowance recorded under a different account", async () => {
    const otherAccountRecord = {
      accountId: "SN_MAIN:0x9999",
      amount: "1000",
      id: "SN_MAIN:0x1:0x2:0x3",
      networkId: "SN_MAIN",
      spender: "0x3",
      token: "0x2",
    };
    await expect(
      handleAllowanceOps(deps({ listRecords: [otherAccountRecord] }), "wallet.revokeAllowance", {
        id: "SN_MAIN:0x1:0x2:0x3",
        type: "wallet.revokeAllowance",
      }),
    ).resolves.toEqual({ error: "switch to the account that granted this allowance" });
  });
});
