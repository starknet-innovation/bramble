/**
 * Background message checks prove sender validation and typed wallet commands.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { AccountRef } from "../src/storage/vault-schema";
import type {
  CreateVaultAccountInput,
  OriginGrantInput,
  SignHashInput,
  WalletStatus,
} from "../src/wallet/vault-service";

const account: AccountRef = {
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: {
    accountIndex: 0,
    addressIndex: 0,
    kind: "starknet-bip44",
  },
  id: "SN_SEPOLIA:0xabcabcdef",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/popup.html",
};
const vaultPassphrase = "correct horse battery staple";
const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  hasVault: true,
  locked: true,
  ready: true,
};

const createWallet = (
  captureCreate?: (input: CreateVaultAccountInput) => void,
  captureSign?: (input: SignHashInput) => void,
  captureGrant?: (input: OriginGrantInput) => void,
) => ({
  async createAccount(input: CreateVaultAccountInput) {
    captureCreate?.(input);
    return account;
  },
  async addDerivedAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts(origin: string) {
    return origin === "https://example.com" ? [account] : [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin(input: OriginGrantInput) {
    captureGrant?.(input);
    return [account];
  },
  async readVault(passphrase: string) {
    if (passphrase !== vaultPassphrase) {
      throw new Error("bad passphrase");
    }
    return {
      accounts: [account],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin: "https://example.com" }],
      schemaVersion: 2 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
  },
  async setActiveAccount() {
    return account;
  },
  async signHash(input: SignHashInput) {
    captureSign?.(input);
    return {
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    };
  },
  async status() {
    return status;
  },
});

describe("createMessageHandler", () => {
  test("rejects untrusted senders", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(handler({ type: "wallet.status" }, { id: "other-extension" })).resolves.toEqual({
      error: "untrusted sender",
    });
  });

  test("rejects accessor message types before dispatch", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");
    const message = {};
    Object.defineProperty(message, "type", {
      enumerable: true,
      get() {
        throw new Error("type getter executed");
      },
    });

    await expect(handler(message, sender)).resolves.toEqual({ error: "unsupported message" });
  });

  test("rejects privileged commands from content senders", async () => {
    const captured: SignHashInput[] = [];
    const handler = createMessageHandler(
      createWallet(undefined, (input) => captured.push(input)),
      "extension-id",
    );

    await expect(
      handler(
        {
          messageHash: "0x1234",
          type: "wallet.signHash",
          vaultPassphrase,
        },
        contentSender,
      ),
    ).resolves.toEqual({ error: "privileged sender required" });
    expect(captured).toEqual([]);
  });

  test("rejects status reads from content senders", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(handler({ type: "wallet.status" }, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("rejects extension-page URL prefix matches from other senders", async () => {
    const captured: SignHashInput[] = [];
    const handler = createMessageHandler(
      createWallet(undefined, (input) => captured.push(input)),
      "extension-id",
    );

    await expect(
      handler(
        {
          messageHash: "0x1234",
          type: "wallet.signHash",
          vaultPassphrase,
        },
        {
          id: "other-extension",
          url: "chrome-extension://extension-id-other/popup.html",
        },
      ),
    ).resolves.toEqual({ error: "untrusted sender" });
    expect(captured).toEqual([]);
  });

  test("allows content senders to use the provider account request path", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", createUnlockSession());

    await expect(
      handler({ origin: "https://example.com", type: "wallet.requestAccounts" }, contentSender),
    ).resolves.toMatchObject({
      ok: false,
      pending: { origin: "https://example.com" },
    });
  });

  test("rejects content senders claiming a different origin", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", createUnlockSession());

    await expect(
      handler({ origin: "https://evil.example", type: "wallet.requestAccounts" }, contentSender),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("rejects explicit passphrases from content senders", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", createUnlockSession());

    await expect(
      handler(
        {
          origin: "https://example.com",
          type: "wallet.getGrantedAccounts",
          vaultPassphrase,
        },
        contentSender,
      ),
    ).resolves.toEqual({ error: "privileged sender required" });
  });

  test("rejects granted account reads for a mismatched content origin", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(createWallet(), "extension-id", session);

    await expect(
      handler({ origin: "https://evil.example", type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("scrubs wallet errors for content senders", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async getGrantedAccounts() {
          throw new Error("vault schema details");
        },
      },
      "extension-id",
      session,
    );

    await expect(
      handler({ origin: "https://example.com", type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toEqual({ error: "wallet request failed" });
  });

  test("keeps wallet errors actionable for extension pages", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(
      handler({ type: "wallet.unlock", vaultPassphrase: "wrong passphrase" }, sender),
    ).resolves.toEqual({ error: "bad passphrase" });
  });

  test("validates create account messages", async () => {
    let captured: CreateVaultAccountInput | null = null;
    const handler = createMessageHandler(
      createWallet((input) => (captured = input)),
      "extension-id",
    );

    await expect(
      handler({ mnemonic: "seed words", type: "wallet.createAccount" }, sender),
    ).resolves.toEqual({ error: "invalid create account request" });
    expect(captured).toBeNull();
  });

  test("creates accounts through the wallet service only", async () => {
    const captured: CreateVaultAccountInput[] = [];
    const handler = createMessageHandler(
      createWallet((input) => captured.push(input)),
      "extension-id",
    );

    await expect(
      handler(
        {
          accountIndex: 0,
          mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
          networkId: "SN_SEPOLIA",
          type: "wallet.createAccount",
          vaultPassphrase,
        },
        sender,
      ),
    ).resolves.toEqual({ account, ok: true });
    expect(captured[0]?.vaultPassphrase).toBe(vaultPassphrase);
  });

  test("generates mnemonics through the wallet service only", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(handler({ type: "wallet.generateMnemonic" }, sender)).resolves.toEqual({
      mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
      ok: true,
    });
    await expect(
      handler({ debug: true, type: "wallet.generateMnemonic" }, sender),
    ).resolves.toEqual({
      error: "invalid generate mnemonic request",
    });
    await expect(handler({ type: "wallet.generateMnemonic" }, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("handles provider chain id and gates dapp invoke submission", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(createWallet(), "extension-id", session);

    await expect(
      handler({ origin: "https://dapp.example", type: "wallet.getChainId" }, contentSender),
    ).resolves.toEqual({
      chainId: "0x534e5f4d41494e",
      ok: true,
    });
    await expect(
      handler(
        {
          calls: [{ calldata: ["0x1"], contractAddress: "0x123", entrypoint: "transfer" }],
          origin: "https://other.example",
          type: "wallet.addInvokeTransaction",
        },
        { id: "extension-id", url: "https://other.example/app" },
      ),
    ).resolves.toEqual({ error: "origin not connected" });
  });

  test("validates origin grant messages", async () => {
    const captured: OriginGrantInput[] = [];
    const handler = createMessageHandler(
      createWallet(undefined, undefined, (input) => captured.push(input)),
      "extension-id",
    );

    await expect(
      handler(
        {
          origin: "not-a-url",
          type: "wallet.grantOrigin",
          vaultPassphrase,
        },
        sender,
      ),
    ).resolves.toEqual({ error: "invalid grant origin request" });
    expect(captured).toEqual([]);
  });

  test("grants normalized origins through the wallet service only", async () => {
    const captured: OriginGrantInput[] = [];
    const handler = createMessageHandler(
      createWallet(undefined, undefined, (input) => captured.push(input)),
      "extension-id",
    );

    await expect(
      handler(
        {
          origin: "https://example.com/path",
          type: "wallet.grantOrigin",
          vaultPassphrase,
        },
        sender,
      ),
    ).resolves.toEqual({ accounts: [account], ok: true });
    expect(captured[0]?.origin).toBe("https://example.com");
  });

  test("reads only origin-granted accounts", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(
      handler(
        {
          origin: "https://example.com",
          type: "wallet.getGrantedAccounts",
          vaultPassphrase,
        },
        sender,
      ),
    ).resolves.toEqual({ accounts: [account], ok: true });
    await expect(
      handler(
        {
          origin: "https://evil.example",
          type: "wallet.getGrantedAccounts",
          vaultPassphrase,
        },
        sender,
      ),
    ).resolves.toEqual({ accounts: [], ok: true });
  });

  test("reads granted accounts from an unlocked session", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", createUnlockSession());

    await expect(
      handler({ origin: "https://example.com", type: "wallet.getGrantedAccounts" }, sender),
    ).resolves.toEqual({ error: "wallet locked" });
    await expect(
      handler({ type: "wallet.unlock", vaultPassphrase }, sender),
    ).resolves.toMatchObject({
      accountCount: 1,
      locked: false,
    });
    await expect(
      handler({ origin: "https://example.com", type: "wallet.getGrantedAccounts" }, sender),
    ).resolves.toEqual({ accounts: [account], ok: true });
  });

  test("sets active accounts through the unlocked session", async () => {
    const session = createUnlockSession();
    const handler = createMessageHandler(createWallet(), "extension-id", session);

    await expect(
      handler({ accountId: account.id, type: "wallet.setActiveAccount" }, sender),
    ).resolves.toEqual({ error: "wallet locked" });
    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    await expect(
      handler({ accountId: account.id, type: "wallet.setActiveAccount" }, sender),
    ).resolves.toEqual({ account, ok: true });
    await expect(
      handler({ accountId: "not-an-account", type: "wallet.setActiveAccount" }, sender),
    ).resolves.toEqual({ error: "invalid active account request" });
  });

  test("creates pending approvals for ungranted dapp account requests", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", createUnlockSession());

    const response = await handler(
      { origin: "https://example.com", type: "wallet.requestAccounts" },
      sender,
    );

    expect(response).toMatchObject({
      ok: false,
      pending: { origin: "https://example.com" },
    });
  });

  test("approves pending dapp account requests after unlock", async () => {
    const captured: OriginGrantInput[] = [];
    const approvals = createApprovalQueue();
    const pending = approvals.request("https://example.com");
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet(undefined, undefined, (input) => captured.push(input)),
      "extension-id",
      session,
      approvals,
    );
    const failingHandler = createMessageHandler(
      {
        ...createWallet(),
        async grantOrigin() {
          throw new Error("grant failed");
        },
      },
      "extension-id",
      session,
      approvals,
    );

    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    await expect(
      failingHandler({ id: pending.id, type: "wallet.approveOrigin" }, sender),
    ).resolves.toEqual({ error: "grant failed" });
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toMatchObject({
      ok: true,
      pending: [{ id: pending.id, origin: pending.origin }],
    });
    await expect(
      handler({ id: pending.id, type: "wallet.approveOrigin" }, sender),
    ).resolves.toEqual({
      accounts: [account],
      ok: true,
    });
    expect(captured[0]).toEqual({
      origin: "https://example.com",
      vaultPassphrase,
    });
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("rejects malformed approval ids", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(handler({ id: "not-a-uuid", type: "wallet.denyOrigin" }, sender)).resolves.toEqual(
      {
        error: "invalid approval request",
      },
    );
  });

  test("locks the unlock session", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", createUnlockSession());

    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    await expect(handler({ type: "wallet.lock" }, sender)).resolves.toMatchObject({ locked: true });
  });
});
