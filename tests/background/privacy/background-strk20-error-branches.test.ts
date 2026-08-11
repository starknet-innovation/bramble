/**
 * STRK20 handler error and gate branches: malformed balances requests, the
 * sender-mismatch and blocked-origin gates across balances/prepare/invoke, the
 * wallet-locked and origin-not-connected resolve failures, plus
 * executeStrk20InvokeApproval's locked resolve error and its successful
 * submit path (which drives the injected signHash callback). Complements
 * background-strk20-messages.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { OriginGuard } from "@mc-wallet/permissions/blocklist";
import type { Strk20Service } from "@mc-wallet/privacy/service";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import type { InvokeInput } from "@mc-wallet/starknet/rpc";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import type { SignHashInput, WalletStatus } from "@mc-wallet/vault/service";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { ec } from "starknet";
import type { LedgerSignQueue } from "../../../apps/extension/src/background/ledger/ledger-sign-queue";
import { executeStrk20InvokeApproval } from "../../../apps/extension/src/background/privacy/strk20-ops";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

const token = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const origin = "https://example.com";
const vaultPassphrase = "correct horse battery staple";

const account: AccountRef = {
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_SEPOLIA:0xabcabcdef",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};
const { starkCurve } = ec;
// The fake device's private key; the Ledger account's stored publicKeyX is its
// real Stark public x-coordinate so a good device signature verifies.
const LEDGER_KEY = "0x1234567890abcdef";
const ledgerAccount: AccountRef = {
  address: "0xfedfed",
  classHash: "0xabcdef",
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: "m/2645'/1195502025'/1470455285'/0'/0'/0",
  },
  id: "SN_SEPOLIA:0xfedfed",
  networkId: "SN_SEPOLIA",
  publicKeyX: starkCurve.getStarkKey(LEDGER_KEY),
};

// A fake device: signs whatever hash it is handed with a chosen private key — no
// hardware or WebHID. LEDGER_KEY verifies against publicKeyX; any other fails.
const deviceQueue = (privateKey: string): LedgerSignQueue => ({
  pending: () => [],
  reject: () => false,
  rejectAll: () => 0,
  settle: () => false,
  async request(request) {
    const sig = starkCurve.sign(request.messageHash, privateKey);
    return { r: `0x${sig.r.toString(16)}`, s: `0x${sig.s.toString(16)}` };
  },
});
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const mismatchSender: RuntimeSender = { id: "extension-id", url: "https://evil.example/app" };
const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  ready: true,
};

const callAndProof = {
  call: { calldata: ["0x1"], contract_address: token, entry_point: "shielded_execute" },
  proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
};

const walletStub = (
  granted: readonly AccountRef[],
  captureSign?: (input: SignHashInput) => void,
) => ({
  async createAccount() {
    return account;
  },
  async addDerivedAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts(target: string) {
    return target === origin ? granted : [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return granted;
  },
  async readVault() {
    return {
      accounts: [account],
      accountSecrets: [],
      activeAccountId: account.id,
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin }],
      schemaVersion: 4 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
  },
  async setActiveAccount() {
    return account;
  },
  async signHash(input: SignHashInput) {
    captureSign?.(input);
    return { publicKey: "0xabc", r: "0x1", s: "0x2" };
  },
  async status() {
    return status;
  },
});

const strk20Service: Strk20Service = {
  async prepare() {
    return callAndProof;
  },
  async privateBalances({ tokens }) {
    return tokens.map((entry) => ({ balance: "0x64", token: entry }));
  },
  async quoteActions() {
    return {
      feeAction: { amount: "0x1", recipient: token, token, type: "withdraw" },
    };
  },
  async subaccountCommitment() {
    return "0x123";
  },
  async submitActions(input) {
    await input.signHash("0xabc123");
    return { transactionHash: "0x123" };
  },
  async submitPrepared() {
    return { transactionHash: "0x123" };
  },
};

const rpcStub = (
  submit?: RuntimeRpc["submitInvokeTransaction"],
  privacyService: Strk20Service = strk20Service,
): RuntimeRpc => ({
  async estimateInvokeFee() {
    return { overallFee: "1", unit: "FRI" };
  },
  async getDeploymentStatus() {
    return true;
  },
  async getNftOwner() {
    return "0x0";
  },
  async getTransactionStatuses() {
    return {};
  },
  async getTokenBalances() {
    return [];
  },
  async getTokenMetadata() {
    return { decimals: 18, name: "Token", symbol: "TKN" };
  },
  async submitAccountDeployment() {
    throw new Error("unused");
  },
  async submitErc20Transfer() {
    throw new Error("unused");
  },
  submitInvokeTransaction:
    submit ?? (async (input: InvokeInput) => ({ calls: input.calls, transactionHash: "0x123" })),
  async submitDeclareTransaction() {
    return { classHash: "0x1", transactionHash: "0x1" };
  },
  strk20: privacyService,
});

const blockAllGuard: OriginGuard = {
  insights: () => ({ blocked: true, warnings: ["blocked"] }),
  isBlocked: () => true,
};

const buildHandler = (options: {
  readonly locked?: boolean;
  readonly granted?: readonly AccountRef[];
  readonly guard?: OriginGuard;
}) => {
  const session = createUnlockSession();
  if (!options.locked) {
    session.unlock(vaultPassphrase);
  }
  const preferences = { ...defaultWalletPreferences(), activeNetworkId: "SN_SEPOLIA" as const };
  return createMessageHandler(walletStub(options.granted ?? [account]), "extension-id", {
    ...(options.guard ? { originGuard: options.guard } : {}),
    preferencesStore: {
      ...unavailablePreferencesStore,
      async read() {
        return preferences;
      },
    },
    runtimeRpc: rpcStub(),
    session,
  });
};

describe("strk20 handler gate and resolve branches", () => {
  test("rejects a malformed balances request", async () => {
    const handler = buildHandler({});
    await expect(
      handler({ extra: 1, origin, tokens: [token], type: "wallet.strk20Balances" }, contentSender),
    ).resolves.toEqual({ error: "invalid strk20 balances request" });
  });

  test("refuses balances when the sender origin does not match", async () => {
    const handler = buildHandler({});
    await expect(
      handler({ origin, tokens: [token], type: "wallet.strk20Balances" }, mismatchSender),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("refuses balances for a blocked origin", async () => {
    const handler = buildHandler({ guard: blockAllGuard });
    await expect(
      handler({ origin, tokens: [token], type: "wallet.strk20Balances" }, contentSender),
    ).resolves.toEqual({ error: "origin blocked" });
  });

  test("refuses balances when the wallet is locked", async () => {
    const handler = buildHandler({ locked: true });
    await expect(
      handler({ origin, tokens: [token], type: "wallet.strk20Balances" }, contentSender),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("refuses balances when the origin is not connected", async () => {
    const handler = buildHandler({ granted: [] });
    await expect(
      handler({ origin, tokens: [token], type: "wallet.strk20Balances" }, contentSender),
    ).resolves.toEqual({ error: "origin not connected" });
  });

  test("refuses prepare when the sender origin does not match", async () => {
    const handler = buildHandler({});
    await expect(
      handler(
        {
          actions: [{ amount: "0x0a", recipient: token, token, type: "withdraw" }],
          origin,
          simulate: false,
          type: "wallet.strk20PrepareInvoke",
        },
        mismatchSender,
      ),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("refuses prepare when the wallet is locked", async () => {
    const handler = buildHandler({ locked: true });
    await expect(
      handler(
        {
          actions: [{ amount: "0x0a", recipient: token, token, type: "withdraw" }],
          origin,
          simulate: false,
          type: "wallet.strk20PrepareInvoke",
        },
        contentSender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("refuses an invoke when the sender origin does not match", async () => {
    const handler = buildHandler({});
    await expect(
      handler(
        {
          actions: [{ amount: "0x0a", recipient: token, token, type: "withdraw" }],
          origin,
          type: "wallet.strk20InvokeTransaction",
        },
        mismatchSender,
      ),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("refuses an invoke when the origin is not connected", async () => {
    const handler = buildHandler({ granted: [] });
    await expect(
      handler(
        {
          actions: [{ amount: "0x0a", recipient: token, token, type: "withdraw" }],
          origin,
          type: "wallet.strk20InvokeTransaction",
        },
        contentSender,
      ),
    ).resolves.toEqual({ error: "origin not connected" });
  });
});

describe("executeStrk20InvokeApproval", () => {
  test("returns the resolve error when the wallet is locked at execution time", async () => {
    const session = createUnlockSession(); // never unlocked
    const deps = {
      activity: memoryActivityLog(),
      preferencesStore: {
        ...unavailablePreferencesStore,
        async read() {
          return { ...defaultWalletPreferences(), activeNetworkId: "SN_SEPOLIA" as const };
        },
      },
      runtimeRpc: rpcStub(),
      session,
      wallet: walletStub([account]),
    };

    await expect(
      executeStrk20InvokeApproval(deps, {
        actions: [{ calldata: ["0x1"], contract: token, type: "invoke" }],
        origin,
        plan: { feeAction: { amount: "0x1", recipient: token, token, type: "withdraw" } },
      }),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  // Builds strk20-execute deps for the keyless Ledger account: signing routes
  // through the injected device queue (never the vault). `onSubmit` fires only
  // after the signer verifies, so a failed sign leaves it false. A missing queue
  // exercises the fail-closed no-queue path.
  const ledgerDeps = (queue: LedgerSignQueue | undefined, onSubmit: () => void) => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    return {
      activity: memoryActivityLog(),
      ...(queue ? { ledgerSignQueue: queue } : {}),
      preferencesStore: {
        ...unavailablePreferencesStore,
        async read() {
          return { ...defaultWalletPreferences(), activeNetworkId: "SN_SEPOLIA" as const };
        },
      },
      runtimeRpc: rpcStub(undefined, {
        ...strk20Service,
        async submitActions(input) {
          // Drive the signer so the device round-trip and verify gate run
          // before "broadcast"; a verification failure throws first.
          await input.signHash("0xabc123");
          onSubmit();
          return { transactionHash: "0x123" };
        },
      }),
      session,
      // signHash must never run for a Ledger account (it has no vault key).
      wallet: walletStub([ledgerAccount]),
    };
  };

  test("routes a keyless Ledger account to the device and submits on a good signature", async () => {
    let submitted = false;
    const result = await executeStrk20InvokeApproval(
      ledgerDeps(deviceQueue(LEDGER_KEY), () => {
        submitted = true;
      }),
      {
        actions: [{ calldata: ["0x1"], contract: token, type: "invoke" }],
        origin,
        plan: { feeAction: { amount: "0x1", recipient: token, token, type: "withdraw" } },
      },
    );
    expect(result).toEqual({ ok: true, transactionHash: "0x123" });
    expect(submitted).toBe(true);
  });

  test("aborts with nothing submitted when the device signature does not verify", async () => {
    let submitted = false;
    const result = await executeStrk20InvokeApproval(
      ledgerDeps(deviceQueue("0xdeadbeef"), () => {
        submitted = true;
      }),
      {
        actions: [{ calldata: ["0x1"], contract: token, type: "invoke" }],
        origin,
        plan: { feeAction: { amount: "0x1", recipient: token, token, type: "withdraw" } },
      },
    );
    expect(result).toEqual({ error: "Ledger signature verification failed" });
    expect(submitted).toBe(false);
  });

  test("fails closed with nothing submitted when no device queue is wired", async () => {
    let submitted = false;
    const result = await executeStrk20InvokeApproval(
      ledgerDeps(undefined, () => {
        submitted = true;
      }),
      {
        actions: [{ calldata: ["0x1"], contract: token, type: "invoke" }],
        origin,
        plan: { feeAction: { amount: "0x1", recipient: token, token, type: "withdraw" } },
      },
    );
    expect(result).toEqual({ error: "Ledger signing unavailable" });
    expect(submitted).toBe(false);
  });

  test("submits the invoke and drives the signHash callback into the wallet", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const signInputs: SignHashInput[] = [];
    const submittedHashes: string[] = [];
    const runtimeRpc = rpcStub(undefined, {
      ...strk20Service,
      async submitActions(input) {
        // Drive the injected signer so the strk20-ops signHash callback runs.
        await input.signHash("0xabc123");
        submittedHashes.push("0xabc123");
        return { transactionHash: "0x123" };
      },
    });
    const activity = memoryActivityLog(() => 42);
    const deps = {
      activity,
      preferencesStore: {
        ...unavailablePreferencesStore,
        async read() {
          return { ...defaultWalletPreferences(), activeNetworkId: "SN_SEPOLIA" as const };
        },
      },
      runtimeRpc,
      session,
      wallet: walletStub([account], (input) => signInputs.push(input)),
    };

    const result = await executeStrk20InvokeApproval(deps, {
      actions: [{ calldata: ["0x1"], contract: token, type: "invoke" }],
      origin,
      plan: { feeAction: { amount: "0x1", recipient: token, token, type: "withdraw" } },
    });

    expect(result).toEqual({ ok: true, transactionHash: "0x123" });
    expect(submittedHashes).toEqual(["0xabc123"]);
    // The callback forwarded the account id, message hash, and session passphrase.
    expect(signInputs).toHaveLength(1);
    expect(signInputs[0]).toEqual({
      accountId: account.id,
      messageHash: "0xabc123",
      vaultPassphrase,
    });
    // A private-transaction entry was recorded without leaking action detail.
    const recorded = await activity.list();
    expect(recorded[0]?.summary).toContain("submitted a private transaction (1 action)");
  });
});
