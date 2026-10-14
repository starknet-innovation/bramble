/**
 * Issue 644: Bramble never creates a Braavos account, and the background holds
 * that rule as well as the picker. `wallet.addLedgerAccount` and
 * `wallet.createLedgerVault` store a Braavos Ledger account only when its
 * derived address is deployed or funded on chain, and refuse when that state
 * cannot be read. Argent and OpenZeppelin Ledger requests are not checked.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const braavosAccount: LedgerAccountRef = {
  accountContractType: "braavos",
  address: "0xb0a",
  classHash: "0x111111",
  deploymentSalt: "0x1234",
  derivation: {
    accountIndex: 0,
    eip2645application: "argentx",
    kind: "ledger",
    path: ledgerAccountPath(0, "argentx"),
  },
  id: "SN_MAIN:0xb0a",
  networkId: "SN_MAIN",
  publicKeyX: "0x1234",
};

const STRK_HELD = {
  address: "0x1",
  balance: "1",
  decimals: 18,
  formatted: "0.000000000000000001",
  id: "SN_MAIN:STRK:0x1",
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
} as const;

type Chain = Pick<RuntimeRpc, "getDeploymentStatus" | "getTokenBalances">;

const NEVER_USED: Chain = {
  getDeploymentStatus: async () => false,
  getTokenBalances: async () => [{ ...STRK_HELD, balance: "0", formatted: "0" }],
};

const harness = (chain: Chain) => {
  const stored: string[] = [];
  const statusReads: string[] = [];
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const wallet = {
    ...createWallet(),
    async addLedgerAccount(input: { readonly accountContractType: string }) {
      stored.push(`add:${input.accountContractType}`);
      return { ...braavosAccount, accountContractType: input.accountContractType } as never;
    },
    async createLedgerVault(input: { readonly accountContractType: string }) {
      stored.push(`create:${input.accountContractType}`);
      return { ...braavosAccount, accountContractType: input.accountContractType } as never;
    },
    async deriveLedgerAccounts() {
      return [braavosAccount];
    },
  };
  const handler = createMessageHandler(wallet, testExtension, {
    runtimeRpc: makeRuntimeRpc({
      getDeploymentStatus: (input) => {
        statusReads.push(input.accountAddress);
        return chain.getDeploymentStatus(input);
      },
      getTokenBalances: (input) => chain.getTokenBalances(input),
    }),
    session,
  });
  return { handler, statusReads, stored };
};

const request = (type: "wallet.addLedgerAccount" | "wallet.createLedgerVault", family: string) => ({
  accountContractType: family,
  accountIndex: 0,
  eip2645application: "argentx",
  networkId: "SN_MAIN",
  publicKeyX: "0x1234",
  type,
  ...(type === "wallet.createLedgerVault" ? { vaultPassphrase } : {}),
});

const NOT_FOUND = { error: "braavos ledger account not found" };
const UNREADABLE = { error: "braavos ledger account status unavailable" };

describe("Braavos Ledger accounts are stored only when already in use", () => {
  for (const type of ["wallet.addLedgerAccount", "wallet.createLedgerVault"] as const) {
    test(`${type} refuses a never-used Braavos address`, async () => {
      const h = harness(NEVER_USED);
      const response = await h.handler(request(type, "braavos"), extensionSender);
      expect(response).toEqual(NOT_FOUND);
      expect(h.stored).toEqual([]);
      // The check reads the address the vault would store, not the device key.
      expect(h.statusReads).toEqual([braavosAccount.address]);
    });

    test(`${type} fails closed when the chain cannot be read`, async () => {
      const h = harness({
        getDeploymentStatus: () => Promise.reject(new Error("rpc down")),
        getTokenBalances: () => Promise.reject(new Error("rpc down")),
      });
      const response = await h.handler(request(type, "braavos"), extensionSender);
      expect(response).toEqual(UNREADABLE);
      expect(h.stored).toEqual([]);
    });

    test(`${type} reports a half-read chain as unreadable, not as no account`, async () => {
      for (const chain of [
        { ...NEVER_USED, getTokenBalances: () => Promise.reject(new Error("rpc down")) },
        { ...NEVER_USED, getDeploymentStatus: () => Promise.reject(new Error("rpc down")) },
      ]) {
        const h = harness(chain);
        expect(await h.handler(request(type, "braavos"), extensionSender)).toEqual(UNREADABLE);
        expect(h.stored).toEqual([]);
      }
    });

    test(`${type} stores a deployed Braavos account`, async () => {
      const h = harness({ ...NEVER_USED, getDeploymentStatus: async () => true });
      const response = await h.handler(request(type, "braavos"), extensionSender);
      expect(response).toMatchObject({ ok: true });
      expect(h.stored).toHaveLength(1);
    });

    test(`${type} stores a funded counterfactual Braavos account`, async () => {
      // Deployment unreadable, but a held balance alone proves the address is used.
      const h = harness({
        getDeploymentStatus: () => Promise.reject(new Error("rpc down")),
        getTokenBalances: async () => [STRK_HELD],
      });
      const response = await h.handler(request(type, "braavos"), extensionSender);
      expect(response).toMatchObject({ ok: true });
      expect(h.stored).toHaveLength(1);
    });

    test(`${type} leaves Argent Ledger accounts unchecked`, async () => {
      const h = harness(NEVER_USED);
      const response = await h.handler(request(type, "argent"), extensionSender);
      expect(response).toMatchObject({ ok: true });
      expect(h.stored).toEqual([`${type === "wallet.addLedgerAccount" ? "add" : "create"}:argent`]);
      expect(h.statusReads).toEqual([]);
    });
  }

  test("refuses a Braavos request when the wallet cannot derive the address", async () => {
    const stored: string[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const wallet = {
      ...createWallet(),
      async addLedgerAccount() {
        stored.push("add:braavos");
        return braavosAccount;
      },
    };
    const handler = createMessageHandler(wallet, testExtension, {
      runtimeRpc: makeRuntimeRpc({ getDeploymentStatus: async () => true }),
      session,
    });
    const response = await handler(request("wallet.addLedgerAccount", "braavos"), extensionSender);
    expect(response).toEqual({ error: "wallet unavailable" });
    expect(stored).toEqual([]);
  });

  test("a network with no curated tokens reads an undeployed address as no account", async () => {
    // Sepolia has no curated token list, so there is no balance to read: that
    // is not an unreadable chain, and the reader is told there is no account.
    const h = harness(NEVER_USED);
    const response = await h.handler(
      { ...request("wallet.addLedgerAccount", "braavos"), networkId: "SN_SEPOLIA" },
      extensionSender,
    );
    expect(response).toEqual(NOT_FOUND);
  });

  test("a derivation that throws refuses as wallet unavailable", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const wallet = {
      ...createWallet(),
      async addLedgerAccount(): Promise<never> {
        throw new Error("must not store");
      },
      deriveLedgerAccounts: () => Promise.reject(new Error("kms down")),
    };
    const handler = createMessageHandler(wallet, testExtension, {
      runtimeRpc: makeRuntimeRpc({}),
      session,
    });
    const response = await handler(request("wallet.addLedgerAccount", "braavos"), extensionSender);
    expect(response).toEqual({ error: "wallet unavailable" });
  });
});
