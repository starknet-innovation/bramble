/**
 * Per-transaction approval gate (A-H1): a connected dapp's addInvokeTransaction
 * no longer auto-submits. It is decoded and queued as an "invoke" approval; the
 * held calls run only when the user approves in the side panel, and are dropped
 * on deny. Blocked or unconnected origins never reach the queue.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeRpc } from "../src/background/runtime-rpc";
import { unavailablePreferencesStore } from "../src/background/runtime-state";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { WalletError } from "../src/shared/errors";
import type { InvokeInput } from "../src/starknet/rpc";
import { verifyCalls } from "../src/starknet/verify";
import { memoryActivityLog } from "../src/storage/activity-store";
import {
  defaultWalletPreferences,
  type WalletPreferences,
  type WalletPreferencesStore,
} from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";
import { flushHeld, latestApprovalId } from "./support/held";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vaultPassphrase = "correct horse battery staple";
const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const call = { calldata: ["0x5", "1000", "0"], contractAddress: "0x123", entrypoint: "transfer" };

const walletStub = (connected: readonly AccountRef[]) => ({
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts(target: string) {
    return target === origin ? connected : [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return connected;
  },
  async readVault() {
    return {
      accounts: [account],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin }],
      schemaVersion: 3 as const,
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

// A read-only preferences store returning fixed preferences, so an invoke can
// be decoded against a populated address book/token list. Only `read` is
// exercised on the queueing path; the rest stay unavailable.
const fixedPreferencesStore = (preferences: WalletPreferences): WalletPreferencesStore =>
  ({ read: async () => preferences }) as unknown as WalletPreferencesStore;

const makeHarness = (
  connected: readonly AccountRef[] = [account],
  preferencesStore = unavailablePreferencesStore,
) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const approvals = createApprovalQueue();
  const activity = memoryActivityLog();
  const invoked: InvokeInput[] = [];
  const rpc = {
    async submitInvokeTransaction(input: InvokeInput) {
      invoked.push(input);
      return { calls: input.calls, transactionHash: "0x7cd" };
    },
  } as unknown as RuntimeRpc;
  const handler = createMessageHandler(walletStub(connected), "extension-id", {
    activity,
    approvals,
    preferencesStore,
    runtimeRpc: rpc,
    session,
  });
  return { activity, handler, invoked };
};

const invokeMessage = (target = origin) => ({
  calls: [call],
  origin: target,
  type: "wallet.addInvokeTransaction" as const,
});

describe("per-transaction invoke approval (A-H1)", () => {
  test("queues a connected dapp invoke instead of submitting it", async () => {
    const { handler, invoked } = makeHarness();

    // The invoke holds until a decision; inspect the queued approval, then deny
    // so the held request settles and nothing dangles.
    const held = handler(invokeMessage(), contentSender);
    await flushHeld();
    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);

    const pending = (
      listed as {
        pending: readonly { kind?: string; summaries?: readonly string[]; origin?: string }[];
      }
    ).pending.at(-1);
    expect(pending).toMatchObject({ kind: "invoke", origin });
    expect(pending?.summaries?.length).toBe(1);
    expect(invoked).toHaveLength(0);

    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("submits the held calls only after the user approves", async () => {
    const { activity, handler, invoked } = makeHarness();

    const held = handler(invokeMessage(), contentSender);
    await flushHeld();

    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    expect((listed as { pending: readonly { kind?: string }[] }).pending[0]?.kind).toBe("invoke");

    const id = await latestApprovalId(handler, extensionSender);
    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ ok: true, transactionHash: "0x7cd" });
    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.account).toEqual(account);
    const recorded = await activity.list();
    expect(recorded[0]?.hash).toBe("0x7cd");
  });

  test("drops the held calls when the user denies", async () => {
    const { handler, invoked } = makeHarness();

    const held = handler(invokeMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await expect(handler({ id, type: "wallet.denyOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({ error: "request rejected" });
    expect(invoked).toHaveLength(0);
  });

  test("rejects an invoke from an unconnected origin without queueing", async () => {
    const { handler, invoked } = makeHarness([]);

    await expect(handler(invokeMessage(), contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
    expect(invoked).toHaveLength(0);
  });

  test("rejects an invoke from a blocklisted origin", async () => {
    const { handler, invoked } = makeHarness();
    const blockedOrigin = "https://starknet-airdrop.com";

    await expect(
      handler(invokeMessage(blockedOrigin), {
        id: "extension-id",
        url: `${blockedOrigin}/app`,
      }),
    ).resolves.toEqual({ error: "origin blocked" });
    expect(invoked).toHaveLength(0);
  });
});

// A harness whose submit drives the injected signer before broadcasting, and
// whose signer throws — standing in for a Ledger device rejection/timeout/
// verify-failure. Exercises the end-to-end path: executor catches the throw,
// returns `{ error }`, and the applier settles the held dapp request.
const makeThrowingSignHarness = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const approvals = createApprovalQueue();
  const activity = memoryActivityLog();
  const invoked: InvokeInput[] = [];
  const rpc = {
    async submitInvokeTransaction(input: InvokeInput) {
      // Drive the signer first: a device rejection surfaces here, before any
      // broadcast, so `invoked` stays empty on a sign failure (fail-closed).
      await input.signHash("0x1");
      invoked.push(input);
      return { calls: input.calls, transactionHash: "0x7cd" };
    },
  } as unknown as RuntimeRpc;
  const wallet = {
    ...walletStub([account]),
    async signHash(): Promise<never> {
      throw new WalletError("device rejected the transaction");
    },
  };
  const handler = createMessageHandler(wallet, "extension-id", {
    activity,
    approvals,
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: rpc,
    session,
  });
  return { activity, handler, invoked };
};

describe("invoke approval settles the held request when signing throws (A-H1)", () => {
  test("returns { error } and submits nothing instead of hanging the dapp promise", async () => {
    const { activity, handler, invoked } = makeThrowingSignHarness();

    const held = handler(invokeMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    // Approve: the executor's sign step throws, but the applier still settles the
    // held request with the real error rather than leaving the dapp promise open.
    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      error: "device rejected the transaction",
    });
    await expect(held).resolves.toEqual({ error: "device rejected the transaction" });
    expect(invoked).toHaveLength(0);
    expect(await activity.list()).toHaveLength(0);
  });
});

// A SN_SEPOLIA contact the SN_MAIN recipient mimics (same leading 6 + trailing
// 4). It must not influence a SN_MAIN transfer's risk flags — the dApp invoke
// path scopes its verify context to the active account's network, exactly like
// the in-wallet Send review (#19 decode/risk parity). Without that scoping the
// dApp card would raise an address-poisoning flag the Send review never would.
const CROSS_NETWORK_CONTACT = "0x55555500000000000000000000000000000000000000000000000000000abcd";
const POISONED_RECIPIENT = "0x555555fffffffffffffffffffffffffffffffffffffffffffffffffffffabcd";

const poisonAcrossNetworks = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_MAIN",
  addressBook: [
    {
      address: CROSS_NETWORK_CONTACT,
      id: "SN_SEPOLIA:contact",
      label: "Sepolia savings",
      networkId: "SN_SEPOLIA",
    },
  ],
});

const poisonedTransferCall = {
  calldata: [POISONED_RECIPIENT, "1000", "0"],
  contractAddress: "0x123",
  entrypoint: "transfer",
};

describe("dApp invoke decode/risk parity with Send review (#19)", () => {
  test("scopes the verify context to the account's network, so a cross-network lookalike does not flag", async () => {
    const preferences = poisonAcrossNetworks();

    // Positive control: unscoped context (the old dApp behaviour) WOULD raise
    // address-poisoning, proving the divergence the network-scoping fix closes.
    const unscoped = verifyCalls([poisonedTransferCall], {
      account,
      addressBook: preferences.addressBook,
      tokens: preferences.tokens,
    });
    expect(unscoped.flags.some((flag) => flag.code === "address-poisoning")).toBe(true);

    const { handler, invoked } = makeHarness([account], fixedPreferencesStore(preferences));
    const held = handler(
      { calls: [poisonedTransferCall], origin, type: "wallet.addInvokeTransaction" as const },
      contentSender,
    );
    await flushHeld();
    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    const pending = (
      listed as {
        pending: readonly { flags?: readonly { code: string }[]; kind?: string }[];
      }
    ).pending.at(-1);

    expect(pending?.kind).toBe("invoke");
    // Network-scoped: the SN_SEPOLIA contact is filtered out, so no poisoning
    // flag — the dApp card and the Send review agree for this transfer.
    expect((pending?.flags ?? []).some((flag) => flag.code === "address-poisoning")).toBe(false);
    expect(invoked).toHaveLength(0);

    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });
});
