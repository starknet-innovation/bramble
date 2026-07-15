/**
 * External-allowance manager messages: allowances discovered on-chain (not
 * granted through this wallet) are merged into the list, and revoking one —
 * which has no local store record — still resolves its target from the id and
 * submits a zero-amount approve through the verified invoke path.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { memoryAllowanceStore } from "../src/storage/allowance-store";
import type { AccountRef, Vault } from "../src/storage/vault-schema";
import { makeRuntimeRpc } from "./support/runtime-rpc-stub";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = `0x7${"5".repeat(62)}`;
const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const makeHarness = () => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const invokeCalls: (readonly unknown[])[] = [];
  const handler = createMessageHandler(walletStub, "extension-id", {
    allowanceStore: memoryAllowanceStore(),
    runtimeRpc: makeRuntimeRpc({
      async getExternalAllowances() {
        return [{ amount: "5000", spender: SPENDER, token: TOKEN }];
      },
      async submitInvokeTransaction(input) {
        invokeCalls.push(input.calls);
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    }),
    session,
  });
  return { handler, invokeCalls };
};

describe("external allowance manager messages", () => {
  test("merges on-chain discovered allowances into the list, labelled external", async () => {
    const { handler } = makeHarness();
    const response = (await handler({ type: "wallet.allowances" }, extensionSender)) as {
      allowances: readonly { amount: string; source: string; spender: string }[];
    };
    expect(response.allowances).toHaveLength(1);
    expect(response.allowances[0]).toMatchObject({
      amount: "5000",
      source: "external",
      spender: `0x${BigInt(SPENDER).toString(16)}`,
    });
  });

  test("revokes an externally discovered allowance not held in the local store", async () => {
    const { handler, invokeCalls } = makeHarness();
    const listed = (await handler({ type: "wallet.allowances" }, extensionSender)) as {
      allowances: readonly { id: string }[];
    };
    const id = listed.allowances[0]?.id ?? "";

    const revoke = await handler({ id, type: "wallet.revokeAllowance" }, extensionSender);
    expect(revoke).toEqual({ ok: true, transactionHash: "0x7cd" });

    const revokeCall = invokeCalls.at(-1)?.[0] as { calldata: string[]; entrypoint: string };
    expect(revokeCall.entrypoint).toBe("approve");
    expect(revokeCall.calldata).toEqual([BigInt(SPENDER).toString(), "0", "0"]);
  });

  test("still rejects revoking an id that does not belong to the active account", async () => {
    const { handler } = makeHarness();
    await expect(
      handler({ id: "SN_MAIN:0x9999:0x1:0x2", type: "wallet.revokeAllowance" }, extensionSender),
    ).resolves.toEqual({ error: "allowance not found" });
  });
});
