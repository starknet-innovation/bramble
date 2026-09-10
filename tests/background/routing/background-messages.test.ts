/**
 * Background message checks prove typed wallet command dispatch: account
 * creation, mnemonic generation, approvals, and session locking. Origin grants
 * are minted only by the approval path (see MCW-V09-124), so they are covered
 * through wallet.approveOrigin rather than a direct grant message.
 * Sender trust gates live in background-sender-gates.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore, defaultWalletPreferences } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { CreateVaultAccountInput, OriginGrantInput } from "@bramble/vault/service";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createLedgerSignQueue } from "../../../apps/extension/src/background/ledger/ledger-sign-queue";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import {
  createActiveStateCoordinator,
  unavailablePreferencesStore,
} from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  secondAccount,
  extensionSender as sender,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";

describe("createMessageHandler", () => {
  test("validates create account messages", async () => {
    let captured: CreateVaultAccountInput | null = null;
    const handler = createMessageHandler(
      createWallet({ captureCreate: (input) => (captured = input) }),
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
      createWallet({ captureCreate: (input) => captured.push(input) }),
      "extension-id",
    );

    await expect(
      handler(
        {
          accountContractType: "openzeppelin",
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

  test("previews only public account metadata for extension pages", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");
    const message = {
      accountContractType: "openzeppelin",
      mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
      networkId: "SN_SEPOLIA",
      type: "wallet.previewAccount",
    };

    await expect(handler(message, sender)).resolves.toEqual({ account, ok: true });
    await expect(handler(message, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
    await expect(handler({ ...message, vaultPassphrase }, sender)).resolves.toEqual({
      error: "invalid account preview request",
    });
  });

  test("validates mnemonics through the wallet service only", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");
    const message = {
      mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
      type: "wallet.validateMnemonic",
    };

    await expect(handler(message, sender)).resolves.toEqual({ ok: true, valid: true });
    await expect(handler(message, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
    await expect(handler({ ...message, networkId: "SN_MAIN" }, sender)).resolves.toEqual({
      error: "invalid mnemonic validation request",
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
    ).resolves.toEqual({ accounts: [], ok: true });
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
    let activeNetworkId: "SN_DEVNET" | "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN";
    const networkSelections: string[] = [];
    const handler = createMessageHandler(createWallet(), "extension-id", {
      preferencesStore: {
        ...unavailablePreferencesStore,
        async read() {
          return { ...defaultWalletPreferences(), activeNetworkId };
        },
        async setActiveNetwork(networkId) {
          activeNetworkId = networkId;
          networkSelections.push(networkId);
          return { ...defaultWalletPreferences(), activeNetworkId };
        },
      },
      session,
    });

    await expect(
      handler({ accountId: account.id, type: "wallet.setActiveAccount" }, sender),
    ).resolves.toEqual({ error: "wallet locked" });
    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    await expect(
      handler({ accountId: account.id, type: "wallet.setActiveAccount" }, sender),
    ).resolves.toEqual({ account, ok: true });
    expect(networkSelections.at(-1)).toBe("SN_SEPOLIA");
    await expect(
      handler({ accountId: "not-an-account", type: "wallet.setActiveAccount" }, sender),
    ).resolves.toEqual({ error: "invalid active account request" });
  });

  test("reconciles the encrypted account after importing a new active network", async () => {
    const mainnetAccount = {
      ...account,
      address: "0xabc111111",
      id: "SN_MAIN:0xabc111111",
      networkId: "SN_MAIN" as const,
    };
    let activeAccountId = account.id;
    const baseWallet = createWallet({
      accounts: [account, mainnetAccount],
      activeAccountId: () => activeAccountId,
    });
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    await preferencesStore.setActiveNetwork("SN_SEPOLIA");
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      {
        ...baseWallet,
        async setActiveAccount(input: { readonly accountId: string }) {
          activeAccountId = input.accountId;
          return input.accountId === mainnetAccount.id ? mainnetAccount : account;
        },
      },
      "extension-id",
      { preferencesStore, session },
    );
    const backup = {
      ...(await preferencesStore.read()),
      activeNetworkId: "SN_MAIN" as const,
    };

    await expect(
      handler({ preferences: backup, type: "wallet.importPreferences" }, sender),
    ).resolves.toMatchObject({ ok: true });
    expect(activeAccountId).toBe(mainnetAccount.id);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
  });

  test("orders a concurrent lock after an in-flight unlock", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const baseWallet = createWallet();
    let reads = 0;
    const session = createUnlockSession();
    const handler = createMessageHandler(
      {
        ...baseWallet,
        async readVault(passphrase: string) {
          reads += 1;
          if (reads === 1) {
            started.resolve();
            await release.promise;
          }
          return baseWallet.readVault(passphrase);
        },
      },
      "extension-id",
      { session },
    );

    const unlocking = handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    await started.promise;
    const locking = handler({ type: "wallet.lock" }, sender);
    release.resolve();

    await expect(unlocking).resolves.toEqual({ error: "wallet locked" });
    await expect(locking).resolves.toMatchObject({ locked: true });
    expect(session.isUnlocked()).toBe(false);
  });

  test("a lock revokes a Ledger holder and operations already queued behind it", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const coordinator = createActiveStateCoordinator();
    const queue = createLedgerSignQueue(
      () => undefined,
      undefined,
      () => (session.isUnlocked() ? session.generation() : null),
    );
    const started = Promise.withResolvers<void>();
    const parked = coordinator
      .run(async () => {
        started.resolve();
        await queue.request({
          accountId: account.id,
          messageHash: "0x123",
          path: "m/2645'/1195502025'/1148870696'/0'/0'/0",
          publicKeyX: account.publicKeyX,
        });
      })
      .catch((error: unknown) => error);
    await started.promise;
    const queuedState = coordinator.run(async () => session.isUnlocked());

    const handler = createMessageHandler(createWallet(), "extension-id", {
      activeStateCoordinator: coordinator,
      ledgerSignQueue: queue,
      session,
    });
    const locking = handler({ type: "wallet.lock" }, sender);
    await Promise.resolve();
    const pendingAfterLock = queue.pending().length;
    if (pendingAfterLock > 0) queue.rejectAll("test cleanup");

    expect(pendingAfterLock).toBe(0);
    expect(await parked).toBeInstanceOf(Error);
    expect(await queuedState).toBe(false);
    await expect(locking).resolves.toMatchObject({ locked: true });
    expect(session.isUnlocked()).toBe(false);
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

  test("re-prompts a reconnecting origin whose grant misses the active account", async () => {
    // Regression: connect as account one, disconnect in the dapp, switch to
    // account two in the wallet, reconnect. The stored grant still names only
    // account one, so the site must be re-approved instead of silently getting
    // account one back — and switching back reconnects it with no prompt.
    let activeAccountId = secondAccount.id;
    const handler = createMessageHandler(
      createWallet({
        accounts: [account, secondAccount],
        activeAccountId: () => activeAccountId,
      }),
      "extension-id",
      { session: createUnlockSession() },
    );

    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
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

    activeAccountId = account.id;
    await expect(
      handler({ origin: "https://example.com", type: "wallet.requestAccounts" }, contentSender),
    ).resolves.toEqual({ accounts: [account], ok: true });
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("returns no accounts without prompting for silent ungranted requests", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", {
      session: createUnlockSession(),
    });

    await expect(
      handler(
        {
          origin: "https://example.com",
          silent: true,
          type: "wallet.requestAccounts",
        },
        contentSender,
      ),
    ).resolves.toEqual({ accounts: [], ok: true });
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("approves pending dapp account requests after unlock", async () => {
    const captured: OriginGrantInput[] = [];
    const approvals = createApprovalQueue();
    const pending = approvals.request("https://example.com");
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet({ captureGrant: (input) => captured.push(input) }),
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
    ).resolves.toEqual({ error: "approval execution failed" });
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toMatchObject({
      ok: true,
      pending: [],
    });
    // A failed claimed approval is terminal and cannot be replayed. The dapp
    // must issue a fresh request, which can then be approved normally.
    const retry = approvals.request("https://example.com");
    await expect(handler({ id: retry.id, type: "wallet.approveOrigin" }, sender)).resolves.toEqual({
      accounts: [account],
      ok: true,
    });
    expect(captured[0]).toMatchObject({
      origin: "https://example.com",
      vaultPassphrase,
    });
    expect(captured[0]?.isAuthorized?.()).toBe(true);
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("fails a connect grant whose unlock generation expires during the vault write", async () => {
    const approvals = createApprovalQueue();
    const pending = approvals.request("https://example.com");
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    let checkedBefore = false;
    let checkedAfter = false;
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async grantOrigin(input: OriginGrantInput) {
          checkedBefore = input.isAuthorized?.() === true;
          session.lock();
          checkedAfter = input.isAuthorized?.() === true;
          throw new Error("wallet locked");
        },
      },
      "extension-id",
      { approvals, session },
    );

    await expect(
      handler({ id: pending.id, type: "wallet.approveOrigin" }, sender),
    ).resolves.toEqual({ error: "approval execution failed" });
    expect(checkedBefore).toBe(true);
    expect(checkedAfter).toBe(false);
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
