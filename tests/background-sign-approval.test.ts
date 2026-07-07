/**
 * signTypedData is gated behind a per-request approval: the request is held,
 * queued as a "sign-typed-data" approval, and only signs on user approval —
 * the signature returns through the request's own channel. Deny rejects it.
 */
import { describe, expect, test } from "bun:test";
import { setApprovalNotifier } from "../src/background/approval-notifier";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

const PASSPHRASE = "correct horse battery staple";
const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = {
  accounts: [account],
  activeAccountId: account.id,
  mnemonic: null,
  originGrants: [{ accountIds: [account.id], origin: "https://dapp.example" }],
  schemaVersion: 2,
  signingKeys: [{ accountId: account.id, privateKey: "0x7e5" }],
} as unknown as Vault;

const wallet = {
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
    return "phrase";
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
      ready: true,
    };
  },
};

// A well-formed SNIP-12 typed message that hashes cleanly.
const MESSAGE = {
  domain: { chainId: "0x534e5f4d41494e", name: "Example", version: "1" },
  message: { contents: "hello" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "contents", type: "felt" }],
    StarkNetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
};

const content: RuntimeSender = { id: "ext", url: "https://dapp.example/swap" };
const page: RuntimeSender = { id: "ext", url: "chrome-extension://ext/sidepanel.html" };

const makeHandler = () => {
  setApprovalNotifier(() => undefined);
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  return createMessageHandler(wallet, "ext", session);
};

const signMessage = {
  origin: "https://dapp.example",
  type: "wallet.signTypedData",
  typedData: MESSAGE,
};

describe("signTypedData approval gate", () => {
  test("valid request never auto-signs — it queues and holds until approval", async () => {
    const handler = makeHandler();
    let settled = false;
    const held = handler(signMessage, content).then((r) => {
      settled = true;
      return r;
    });
    // The request stays pending (no signature yet).
    await Promise.resolve();
    expect(settled).toBe(false);

    // The queued approval is visible to the side panel.
    const pending = (await handler({ type: "wallet.pendingApprovals" }, page)) as unknown as {
      pending: { id: string; kind: string }[];
    };
    expect(pending.pending).toHaveLength(1);
    expect(pending.pending[0]?.kind).toBe("sign-typed-data");

    // Approving from the side panel delivers the signature back to the dapp.
    await handler({ id: pending.pending[0]?.id, type: "wallet.approveOrigin" }, page);
    const result = await held;
    expect(result).toEqual({
      ok: true,
      signature: { publicKey: account.publicKeyX, r: "0x1", s: "0x2" },
    });
  });

  test("deny rejects the held request with an error", async () => {
    const handler = makeHandler();
    const held = handler(signMessage, content);
    const pending = (await handler({ type: "wallet.pendingApprovals" }, page)) as unknown as {
      pending: { id: string }[];
    };
    await handler({ id: pending.pending[0]?.id, type: "wallet.denyOrigin" }, page);
    expect(await held).toEqual({ error: "signature request denied" });
  });

  test("an unconnected origin cannot queue a signature", async () => {
    const lonely = {
      ...wallet,
      async getGrantedAccounts() {
        return [];
      },
    };
    const session = createUnlockSession();
    session.unlock(PASSPHRASE);
    const handler = createMessageHandler(lonely, "ext", session);
    expect(await handler(signMessage, content)).toEqual({ error: "origin not connected" });
  });
});
