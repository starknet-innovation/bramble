/**
 * wallet_addDeclareTransaction held-approval gate: a declare is never submitted
 * without an explicit user approval. It is queued as a "declare" approval and
 * held; the declare is signed and submitted only on approve, dropped on deny
 * (mapping to USER_REFUSED_OP on the wire). Unconnected origins never queue, and
 * the large CONTRACT_CLASS is never surfaced in the approval snapshot.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeRpc } from "../src/background/runtime-rpc";
import { unavailablePreferencesStore } from "../src/background/runtime-state";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { DeclareInput } from "../src/starknet/rpc";
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

const declare = {
  classHash: "0x5abc",
  compiledClassHash: "0x6def",
  contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
};

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
      schemaVersion: 2 as const,
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

const makeHarness = (connected: readonly AccountRef[] = [account]) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const approvals = createApprovalQueue();
  const declared: DeclareInput[] = [];
  const rpc = {
    async submitDeclareTransaction(input: DeclareInput) {
      declared.push(input);
      return { classHash: "0x7ce", transactionHash: "0x7cd" };
    },
  } as unknown as RuntimeRpc;
  const handler = createMessageHandler(walletStub(connected), "extension-id", {
    approvals,
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: rpc,
    session,
  });
  return { declared, handler };
};

const declareMessage = (overrides: Record<string, unknown> = {}) => ({
  declare: { ...declare, ...overrides },
  origin,
  type: "wallet.addDeclareTransaction" as const,
});

describe("wallet_addDeclareTransaction held approval", () => {
  test("queues a declare approval without submitting or leaking the contract class", async () => {
    const { declared, handler } = makeHarness();

    const held = handler(declareMessage(), contentSender);
    await flushHeld();
    const listed = await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    const pending = (
      listed as {
        pending: readonly {
          kind?: string;
          origin?: string;
          summaries?: readonly string[];
          declare?: unknown;
        }[];
      }
    ).pending.at(-1);
    expect(pending).toMatchObject({ kind: "declare", origin });
    // The CONTRACT_CLASS must never reach the UI snapshot.
    expect(JSON.stringify(pending)).not.toContain("sierra_program");
    expect(declared).toHaveLength(0);

    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("submits the declare and returns hashes only after approval", async () => {
    const { declared, handler } = makeHarness();

    const held = handler(declareMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    await expect(held).resolves.toEqual({
      classHash: "0x7ce",
      ok: true,
      transactionHash: "0x7cd",
    });
    expect(declared).toHaveLength(1);
    expect(declared[0]?.compiledClassHash).toBe(declare.compiledClassHash);
    expect(declared[0]?.classHash).toBe(declare.classHash);
  });

  test("drops the declare when the user denies", async () => {
    const { declared, handler } = makeHarness();

    const held = handler(declareMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);

    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
    expect(declared).toHaveLength(0);
  });

  test("rejects a declare from an unconnected origin without queueing", async () => {
    const { declared, handler } = makeHarness([]);
    await expect(handler(declareMessage(), contentSender)).resolves.toEqual({
      error: "origin not connected",
    });
    expect(declared).toHaveLength(0);
  });

  test("rejects a malformed declare payload", async () => {
    const { handler } = makeHarness();
    await expect(
      handler(declareMessage({ compiledClassHash: "not-hex" }), contentSender),
    ).resolves.toEqual({ error: "invalid declare request" });
  });
});
