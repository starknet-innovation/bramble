/**
 * Background Starknet-name resolution message: stays privileged and
 * locked-safe, resolves a typed `name.stark` against the ACTIVE network's RPC
 * endpoints, passes the resolver's discriminated outcome through unchanged, and
 * fails closed when the resolution surface is unavailable rather than implying a
 * resolved recipient.
 */
import { describe, expect, test } from "bun:test";
import type { ResolveStarkNameInput } from "@bramble/starknet/stark-name";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };
const vaultPassphrase = "correct horse battery staple";

const vault = {
  accounts: [account],
  activeAccountId: account.id,
} as unknown as Vault;

const walletStub = {
  async createAccount() {
    return account;
  },
  async addDerivedAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
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
    return { publicKey: "0x3", r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

const RESOLVE = { name: "altaga.braavos.stark", type: "wallet.resolveStarkName" } as const;
const MAINNET_RPC_URLS = [
  "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10",
  "https://mainnet.nodes.starknet.org/rpc/v0_10",
];

describe("background Starknet name resolution message", () => {
  test("requires an extension page sender", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, testExtension, {
      runtimeRpc: makeRuntimeRpc(),
      session,
    });
    expect(await handler(RESOLVE, contentSender)).toEqual({ error: "privileged sender required" });
  });

  test("requires an unlocked vault", async () => {
    const handler = createMessageHandler(walletStub, testExtension, {
      runtimeRpc: makeRuntimeRpc(),
      session: createUnlockSession(),
    });
    expect(await handler(RESOLVE, extensionSender)).toEqual({ error: "wallet locked" });
  });

  test("resolves the typed name against the active network", async () => {
    const calls: ResolveStarkNameInput[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, testExtension, {
      runtimeRpc: makeRuntimeRpc({
        async resolveStarkName(input) {
          calls.push(input);
          return { address: account.address, status: "resolved" };
        },
      }),
      session,
    });

    const response = await handler(RESOLVE, extensionSender);

    expect(response).toEqual({
      ok: true,
      resolution: { address: account.address, status: "resolved" },
    });
    expect(calls).toEqual([{ name: "altaga.braavos.stark", rpcUrls: MAINNET_RPC_URLS }]);
  });

  test("passes an unregistered name through as not-found, without an address", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, testExtension, {
      runtimeRpc: makeRuntimeRpc({
        async resolveStarkName() {
          return { status: "not-found" };
        },
      }),
      session,
    });

    expect(await handler(RESOLVE, extensionSender)).toEqual({
      ok: true,
      resolution: { status: "not-found" },
    });
  });

  test("passes a transport outage through as unreachable", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, testExtension, {
      runtimeRpc: makeRuntimeRpc({
        async resolveStarkName() {
          return { status: "unreachable" };
        },
      }),
      session,
    });

    expect(await handler(RESOLVE, extensionSender)).toEqual({
      ok: true,
      resolution: { status: "unreachable" },
    });
  });

  test("rejects an unexpected extra field on the request", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, testExtension, {
      runtimeRpc: makeRuntimeRpc(),
      session,
    });
    expect(
      await handler(
        { extra: true, name: "altaga.braavos.stark", type: "wallet.resolveStarkName" },
        extensionSender,
      ),
    ).toEqual({ error: "invalid stark name request" });
  });

  test("rejects a blank name without reaching the resolver", async () => {
    const calls: ResolveStarkNameInput[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, testExtension, {
      runtimeRpc: makeRuntimeRpc({
        async resolveStarkName(input) {
          calls.push(input);
          return { address: account.address, status: "resolved" };
        },
      }),
      session,
    });
    expect(
      await handler({ name: "   ", type: "wallet.resolveStarkName" }, extensionSender),
    ).toEqual({ error: "invalid stark name request" });
    expect(calls).toEqual([]);
  });

  test("fails closed when the resolution surface is unavailable", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    // The optional method is absent on a partial stub; the handler must not
    // treat that as a resolved recipient.
    const runtimeRpc = makeRuntimeRpc();
    delete (runtimeRpc as { resolveStarkName?: unknown }).resolveStarkName;
    const handler = createMessageHandler(walletStub, testExtension, {
      runtimeRpc,
      session,
    });
    expect(await handler(RESOLVE, extensionSender)).toEqual({
      error: "name resolution unavailable",
    });
  });
});
