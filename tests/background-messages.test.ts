/**
 * Background message checks prove typed wallet command dispatch: account
 * creation, mnemonic generation, grants, approvals, and session locking.
 * Sender trust gates live in background-sender-gates.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
import { createMessageHandler } from "../src/background/messages";
import { createUnlockSession } from "../src/background/session";
import type { CreateVaultAccountInput, OriginGrantInput } from "../src/wallet/vault-service";
import {
  account,
  contentSender,
  createWallet,
  extensionSender as sender,
  vaultPassphrase,
} from "./support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "./support/held";

describe("createMessageHandler", () => {
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
    const handler = createMessageHandler(createWallet(), "extension-id", { session });

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
    const handler = createMessageHandler(createWallet(), "extension-id", {
      session: createUnlockSession(),
    });

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
    const handler = createMessageHandler(createWallet(), "extension-id", { session });

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
    const handler = createMessageHandler(createWallet(), "extension-id", {
      session: createUnlockSession(),
    });

    const held = handler(
      { origin: "https://example.com", type: "wallet.requestAccounts" },
      contentSender,
    );
    await flushHeld();
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toMatchObject({
      pending: [{ origin: "https://example.com" }],
    });
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    await expect(held).resolves.toEqual({ error: "connection rejected" });
  });

  test("approves pending dapp account requests after unlock", async () => {
    const captured: OriginGrantInput[] = [];
    const approvals = createApprovalQueue();
    const pending = approvals.request("https://example.com");
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet(undefined, undefined, (input) => captured.push(input)),
      "extension-id",
      { approvals, session },
    );
    const failingHandler = createMessageHandler(
      {
        ...createWallet(),
        async grantOrigin() {
          throw new Error("grant failed");
        },
      },
      "extension-id",
      { approvals, session },
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
    const handler = createMessageHandler(createWallet(), "extension-id", {
      session: createUnlockSession(),
    });

    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    await expect(handler({ type: "wallet.lock" }, sender)).resolves.toMatchObject({ locked: true });
  });
});
