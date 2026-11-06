/**
 * wallet_addStarknetChain is answered at once, never held (issue 852). The
 * wallet supports only its built-in networks, so a built-in chain id is
 * already added (true, no prompt, per spec) and any other chain is refused as
 * unsupported (CHAIN_ID_NOT_SUPPORTED on the wire). Before this, an unknown
 * chain was approved and stored though nothing could switch to it, and a
 * re-add of a stored chain reported success without a prompt or a write.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { flushHeld } from "../../support/held";

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
const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const chain = {
  chainId: "0x534e5f4b4154414e41",
  chainName: "Katana",
  id: "katana",
  rpcUrls: ["https://rpc.katana.example"] as const,
};

const walletStub = () => ({
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
    return [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [];
  },
  async readVault() {
    return {
      accounts: [account],
      accountSecrets: [],
      activeAccountId: account.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [],
      schemaVersion: 13 as const,
      multisigStrk20KeyConflicts: [],
      multisigStrk20ViewingKeys: [],
      shadowAccountScopes: [],
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
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
      ready: true,
    };
  },
});

const makeHarness = (stored?: Json) => {
  const session = createUnlockSession();
  const approvals = createApprovalQueue();
  const memory = createMemoryStore();
  if (stored !== undefined) void memory.set(PREFERENCES_STORE_KEY, stored);
  const writes: unknown[] = [];
  const recording = {
    ...memory,
    set: (key: string, value: Json) => {
      writes.push(value);
      return memory.set(key, value);
    },
  };
  const preferencesStore = createPreferencesStore({ store: recording });
  const handler = createMessageHandler(walletStub(), testExtension, {
    approvals,
    preferencesStore,
    session,
  });
  const pendingCount = async () =>
    (
      (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
        pending: readonly unknown[];
      }
    ).pending.length;
  return { handler, pendingCount, preferencesStore, writes };
};

const addChainMessage = (overrides: Record<string, unknown> = {}) => ({
  chain: { ...chain, ...overrides },
  origin,
  type: "wallet.addStarknetChain" as const,
});

describe("wallet_addStarknetChain", () => {
  test("refuses an unknown chain as unsupported: no prompt, nothing stored", async () => {
    const { handler, pendingCount, preferencesStore, writes } = makeHarness();

    const response = handler(addChainMessage(), contentSender);
    await flushHeld();
    expect(await pendingCount()).toBe(0);
    await expect(response).resolves.toEqual({ error: "unsupported chain" });
    expect(writes).toHaveLength(0);
    expect((await preferencesStore.read()).customNetworks ?? []).toHaveLength(0);
    // Control: the recorder does see a real preferences write.
    await preferencesStore.setDisplay({ theme: "dark" });
    expect(writes).toHaveLength(1);
  });

  test("refuses a chain an earlier build stored, whatever RPC the re-add carries", async () => {
    const { handler, pendingCount, preferencesStore, writes } = makeHarness({
      ...defaultWalletPreferences(),
      customNetworks: [
        {
          chainId: chain.chainId,
          id: "katana",
          name: "Katana",
          rpcUrls: ["https://rpc-a.example"],
        },
      ],
    } as unknown as Json);

    await expect(
      handler(addChainMessage({ rpcUrls: ["https://rpc-b.example"] }), contentSender),
    ).resolves.toEqual({ error: "unsupported chain" });
    expect(await pendingCount()).toBe(0);
    expect(writes).toHaveLength(0);
    // Control: the earlier build's record really is there to be matched.
    expect((await preferencesStore.read()).customNetworks).toHaveLength(1);
  });

  test("returns true without a prompt for a built-in chain", async () => {
    const { handler, pendingCount, writes } = makeHarness();

    for (const chainId of ["0x534e5f4d41494e", "0x534e5f5345504f4c4941"]) {
      await expect(handler(addChainMessage({ chainId }), contentSender)).resolves.toEqual({
        added: true,
        ok: true,
      });
    }
    expect(await pendingCount()).toBe(0);
    expect(writes).toHaveLength(0);
  });

  test("agrees with wallet_switchStarknetChain on a padded built-in chain id", async () => {
    // A leading-zero spelling of SN_MAIN passes both readers' hex check, but
    // the switch matches chain ids exactly and refuses it. Answering `added`
    // here would promise a network the follow-up switch rejects (issue 852).
    const { handler } = makeHarness();
    const chainId = "0x0534e5f4d41494e";

    await expect(handler(addChainMessage({ chainId }), contentSender)).resolves.toEqual({
      error: "unsupported chain",
    });
    await expect(
      handler({ chainId, origin, type: "wallet.switchChain" }, contentSender),
    ).resolves.toEqual({ error: "unsupported chain" });
  });

  test("rejects an oversized chain label crossed on a runtime message", async () => {
    // MCW-V09-130: the background re-validation once measured the trimmed label,
    // so a megabytes-long padded name passed `isProviderChain`. The bound is on
    // the raw string now.
    const { handler } = makeHarness();
    await expect(
      handler(addChainMessage({ chainName: `${" ".repeat(10_000_000)}a` }), contentSender),
    ).resolves.toEqual({ error: "invalid add chain request" });
  });

  test("refuses an oversized URL list as malformed", async () => {
    // Sherlock audit 153: 80 RPC URLs of about 2 KB each.
    const { handler } = makeHarness();
    const rpcUrls = Array.from(
      { length: 80 },
      (_, index) => `https://rpc.example/${index}/${"a".repeat(2000)}`,
    );
    await expect(handler(addChainMessage({ rpcUrls }), contentSender)).resolves.toEqual({
      error: "invalid add chain request",
    });
  });

  test("rejects a malformed chain payload", async () => {
    const { handler } = makeHarness();
    await expect(handler(addChainMessage({ chainId: "not-hex" }), contentSender)).resolves.toEqual({
      error: "invalid add chain request",
    });
  });

  test("rejects an add-chain from a blocklisted origin", async () => {
    const { handler } = makeHarness();
    const blockedOrigin = "https://starknet-airdrop.com";
    await expect(
      handler(
        { chain, origin: blockedOrigin, type: "wallet.addStarknetChain" },
        { id: "extension-id", url: `${blockedOrigin}/app` },
      ),
    ).resolves.toEqual({ error: "origin blocked" });
  });
});
