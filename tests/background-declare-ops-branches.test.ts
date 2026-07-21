/**
 * Declare-ops error envelopes: handleDeclareOps rejects a sender that does not
 * claim the request origin, a blocked origin, and a locked wallet; and
 * executeDeclareApproval fails closed on a locked wallet or a revoked grant, and
 * on the happy path drives the injected signHash through the RPC submission.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
import {
  type DeclareExecuteDeps,
  type DeclareOpsDeps,
  executeDeclareApproval,
  handleDeclareOps,
} from "../src/background/declare-ops";
import { LEDGER_DAPP_SIGNING_UNSUPPORTED } from "../src/background/ledger-signer";
import type { RuntimeRpc } from "../src/background/runtime-rpc";
import { unavailablePreferencesStore } from "../src/background/runtime-state";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { createSignatureWaiters } from "../src/background/signature-waiters";
import type { AccountRef } from "../src/storage/vault-schema";

const origin = "https://dapp.example";
const passphrase = "correct horse battery staple";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const ledgerAccount: AccountRef = {
  address: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: "m/2645'/1195502025'/1470455285'/0'/0'/0",
  },
  id: "SN_MAIN:0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const declare = {
  classHash: "0x5abc",
  compiledClassHash: "0x6def",
  contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
};

const message = { declare, origin, type: "wallet.addDeclareTransaction" as const };

const walletStub = (granted: readonly AccountRef[], signed: string[] = []) =>
  ({
    async getGrantedAccounts(target: string) {
      return target === origin ? granted : [];
    },
    async signHash({ messageHash }: { messageHash: string }) {
      signed.push(messageHash);
      return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
    },
  }) as unknown as DeclareOpsDeps["wallet"];

const opsDeps = (
  overrides: Partial<DeclareOpsDeps> & { readonly locked?: boolean } = {},
): DeclareOpsDeps => {
  const session = createUnlockSession();
  if (!overrides.locked) {
    session.unlock(passphrase);
  }
  return {
    approvals: createApprovalQueue(),
    extensionId: "extension-id",
    preferencesStore: unavailablePreferencesStore,
    session,
    wallet: walletStub([account]),
    waiters: createSignatureWaiters(),
    ...overrides,
  };
};

describe("handleDeclareOps error envelopes", () => {
  test("ignores unrelated message types", async () => {
    await expect(
      handleDeclareOps(opsDeps(), "wallet.other", message, contentSender),
    ).resolves.toBeNull();
  });

  test("rejects a malformed declare payload", async () => {
    await expect(
      handleDeclareOps(
        opsDeps(),
        "wallet.addDeclareTransaction",
        { ...message, declare: { ...declare, compiledClassHash: "not-hex" } },
        contentSender,
      ),
    ).resolves.toEqual({ error: "invalid declare request" });
  });

  test("rejects a sender that does not claim the request origin", async () => {
    const wrongSender: RuntimeSender = { id: "extension-id", url: "https://evil.example/x" };
    await expect(
      handleDeclareOps(opsDeps(), "wallet.addDeclareTransaction", message, wrongSender),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("rejects a blocked origin", async () => {
    await expect(
      handleDeclareOps(
        opsDeps({
          guard: {
            insights: () => ({ blocked: true, warnings: ["blocked"] }),
            isBlocked: () => true,
          },
        }),
        "wallet.addDeclareTransaction",
        message,
        contentSender,
      ),
    ).resolves.toEqual({ error: "origin blocked" });
  });

  test("rejects when the wallet is locked", async () => {
    await expect(
      handleDeclareOps(
        opsDeps({ locked: true }),
        "wallet.addDeclareTransaction",
        message,
        contentSender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
  });
});

describe("executeDeclareApproval", () => {
  const executeDeps = (
    overrides: Partial<DeclareExecuteDeps> & {
      readonly locked?: boolean;
      readonly signed?: string[];
    } = {},
  ): DeclareExecuteDeps => {
    const session = createUnlockSession();
    if (!overrides.locked) {
      session.unlock(passphrase);
    }
    return {
      preferencesStore: unavailablePreferencesStore,
      runtimeRpc: {
        async submitDeclareTransaction(input: {
          readonly signHash: (hash: string) => Promise<unknown>;
        }) {
          await input.signHash("0xfeed");
          return { classHash: "0x7ce", transactionHash: "0x7cd" };
        },
      } as unknown as RuntimeRpc,
      session,
      wallet: walletStub([account], overrides.signed),
      ...overrides,
    };
  };

  test("fails closed when the wallet is locked", async () => {
    await expect(
      executeDeclareApproval(executeDeps({ locked: true }), { declare, origin }),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("fails closed when the origin is no longer connected", async () => {
    const deps = executeDeps({ wallet: walletStub([]) });
    await expect(executeDeclareApproval(deps, { declare, origin })).resolves.toEqual({
      error: "origin not connected",
    });
  });

  test("refuses a keyless Ledger account with a clear message, nothing signed", async () => {
    const signed: string[] = [];
    const deps = executeDeps({ signed, wallet: walletStub([ledgerAccount], signed) });
    await expect(executeDeclareApproval(deps, { declare, origin })).resolves.toEqual({
      error: LEDGER_DAPP_SIGNING_UNSUPPORTED,
    });
    expect(signed).toEqual([]);
  });

  test("signs and submits the declare, returning the node hashes", async () => {
    const signed: string[] = [];
    const result = await executeDeclareApproval(executeDeps({ signed }), { declare, origin });

    expect(result).toEqual({ classHash: "0x7ce", ok: true, transactionHash: "0x7cd" });
    // The signHash closure passed to the RPC layer routed through the wallet.
    expect(signed).toEqual(["0xfeed"]);
  });
});
