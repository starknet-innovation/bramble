/**
 * Background STRK20 message checks prove private reads, prepare, and the
 * held-approval invoke keep spec error codes and never auto-submit.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeRpc } from "../src/background/runtime-rpc";
import { unavailablePreferencesStore } from "../src/background/runtime-state";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { toProviderPayload } from "../src/provider/bridge";
import type { InvokeInput } from "../src/starknet/rpc";
import type { Strk20Service } from "../src/starknet/strk20/service";
import { defaultWalletPreferences } from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";
import type { WalletStatus } from "../src/wallet/vault-service";
import { flushHeld, latestApprovalId } from "./support/held";

const token = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const recipient = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const origin = "https://example.com";
// The spec's literal `${openNoteIds[0]}` calldata placeholder, assembled by
// interpolation so the source carries no bare "${" template token.
const openNotePlaceholder = `${"$"}{openNoteIds[0]}`;
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
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/popup.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
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

const walletStub = () => ({
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
    return target === origin ? [account] : [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
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
    return { publicKey: "0xabc", r: "0x1", s: "0x2" };
  },
  async status() {
    return status;
  },
});

const rpcStub = (strk20: Strk20Service, invoked: InvokeInput[]): RuntimeRpc => ({
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
  async submitInvokeTransaction(input) {
    invoked.push(input);
    return { calls: input.calls, transactionHash: "0x123" };
  },
  async submitDeclareTransaction() {
    return { classHash: "0x1", transactionHash: "0x1" };
  },
  strk20,
});

const buildHandler = (options?: {
  readonly registered?: boolean;
  readonly balance?: string;
  readonly invoked?: InvokeInput[];
}) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const preferences = { ...defaultWalletPreferences(), activeNetworkId: "SN_SEPOLIA" as const };
  const strk20: Strk20Service = {
    async privateBalances({ tokens }) {
      return tokens.map((entry) => ({ balance: options?.balance ?? "0x64", token: entry }));
    },
    proving: {
      async prove() {
        return callAndProof;
      },
    },
    async registered() {
      return options?.registered ?? true;
    },
  };
  return createMessageHandler(walletStub(), "extension-id", {
    preferencesStore: {
      ...unavailablePreferencesStore,
      async read() {
        return preferences;
      },
    },
    runtimeRpc: rpcStub(strk20, options?.invoked ?? []),
    session,
  });
};

describe("background strk20 messages", () => {
  test("reads private balances for a connected account", async () => {
    const handler = buildHandler();
    const result = await handler(
      { origin, tokens: [token], type: "wallet.strk20Balances" },
      contentSender,
    );
    expect(result).toEqual({ balances: [{ balance: "0x64", token }], ok: true });
    expect(toProviderPayload(result, "wallet_strk20Balances")).toEqual({
      result: [{ balance: "0x64", token }],
    });
  });

  test("maps an unregistered account to NOT_REGISTERED (118)", async () => {
    const handler = buildHandler({ registered: false });
    const result = await handler(
      { origin, tokens: [token], type: "wallet.strk20Balances" },
      contentSender,
    );
    expect(toProviderPayload(result, "wallet_strk20Balances").error?.code).toBe(118);
  });

  test("prepares a call-and-proof envelope without submitting", async () => {
    const invoked: InvokeInput[] = [];
    const handler = buildHandler({ invoked });
    const result = await handler(
      {
        actions: [{ amount: "0x0a", recipient, token, type: "withdraw" }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      contentSender,
    );
    expect(result).toEqual({ callAndProof, ok: true });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke")).toEqual({
      result: callAndProof,
    });
    expect(invoked).toHaveLength(0);
  });

  test("rejects an action exceeding the private balance (119)", async () => {
    const handler = buildHandler({ balance: "0x1" });
    const result = await handler(
      {
        actions: [{ amount: "0x3e8", recipient, token, type: "withdraw" }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      contentSender,
    );
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke").error?.code).toBe(119);
  });

  test("rejects a leaking deposit/withdraw batch (120)", async () => {
    const handler = buildHandler();
    const result = await handler(
      {
        actions: [
          { amount: "0x05", token, type: "deposit" },
          { amount: "0x05", recipient, token, type: "withdraw" },
        ],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      contentSender,
    );
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke").error?.code).toBe(120);
  });

  test("rejects a malformed prepare payload (114)", async () => {
    const handler = buildHandler();
    const result = await handler(
      { actions: [], origin, simulate: false, type: "wallet.strk20PrepareInvoke" },
      contentSender,
    );
    expect(result).toEqual({ error: "invalid strk20 prepare request" });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke").error?.code).toBe(114);
  });

  test("prepares an OPEN transfer plus a placeholder-bearing invoke in simulate mode", async () => {
    const handler = buildHandler();
    const result = await handler(
      {
        actions: [
          { amount: "OPEN", recipient, token, type: "transfer" },
          { calldata: ["0x1", openNotePlaceholder], contract: token, type: "invoke" },
        ],
        origin,
        simulate: true,
        type: "wallet.strk20PrepareInvoke",
      },
      contentSender,
    );
    expect(result).toEqual({ callAndProof, ok: true });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke")).toEqual({
      result: callAndProof,
    });
  });

  test("prepares a numeric transfer within the private balance", async () => {
    const handler = buildHandler();
    const result = await handler(
      {
        actions: [{ amount: "0x0a", recipient, token, type: "transfer" }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      contentSender,
    );
    expect(result).toEqual({ callAndProof, ok: true });
  });

  test("rejects the old `action`-discriminated shape at routing (114)", async () => {
    const handler = buildHandler();
    const result = await handler(
      {
        actions: [{ action: "withdraw", amount: "10", token }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      contentSender,
    );
    expect(result).toEqual({ error: "invalid strk20 prepare request" });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke").error?.code).toBe(114);
  });

  test("holds the invoke until approval, then submits a padded hash", async () => {
    const invoked: InvokeInput[] = [];
    const handler = buildHandler({ invoked });
    const held = handler(
      {
        actions: [{ amount: "0x0a", recipient, token, type: "withdraw" }],
        origin,
        type: "wallet.strk20InvokeTransaction",
      },
      contentSender,
    );
    await flushHeld();
    const listed = (await handler({ type: "wallet.pendingApprovals" }, sender)) as {
      readonly pending: readonly { readonly kind?: string }[];
    };
    expect(listed.pending.at(-1)).toMatchObject({ kind: "strk20-invoke", origin });
    expect(invoked).toHaveLength(0);

    const id = await latestApprovalId(handler, sender);
    await expect(handler({ id, type: "wallet.approveOrigin" }, sender)).resolves.toMatchObject({
      ok: true,
      pending: [],
    });
    const result = await held;
    expect(result).toEqual({ ok: true, transactionHash: "0x123" });
    expect(toProviderPayload(result, "wallet_strk20InvokeTransaction")).toEqual({
      result: { transaction_hash: `0x${"123".padStart(64, "0")}` },
    });
    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.calls[0]).toEqual({
      calldata: ["0x1"],
      contractAddress: token,
      entrypoint: "shielded_execute",
    });
  });

  test("threads the configured prover url from preferences into the service", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const preferences = {
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_SEPOLIA" as const,
      strk20ProverUrl: "https://prover.example/strk20",
    };
    const seenProverUrls: (string | null)[] = [];
    const strk20: Strk20Service = {
      async privateBalances({ proverUrl, tokens }) {
        seenProverUrls.push(proverUrl);
        return tokens.map((entry) => ({ balance: "0x64", token: entry }));
      },
      proving: {
        async prove() {
          return callAndProof;
        },
      },
      async registered({ proverUrl }) {
        seenProverUrls.push(proverUrl);
        return true;
      },
    };
    const handler = createMessageHandler(walletStub(), "extension-id", {
      preferencesStore: {
        ...unavailablePreferencesStore,
        async read() {
          return preferences;
        },
      },
      runtimeRpc: rpcStub(strk20, []),
      session,
    });

    await handler({ origin, tokens: [token], type: "wallet.strk20Balances" }, contentSender);
    expect(seenProverUrls).toEqual([
      "https://prover.example/strk20",
      "https://prover.example/strk20",
    ]);
  });

  test("maps a denied invoke to USER_REFUSED_OP (113)", async () => {
    const invoked: InvokeInput[] = [];
    const handler = buildHandler({ invoked });
    const held = handler(
      {
        actions: [{ amount: "0x0a", recipient, token, type: "withdraw" }],
        origin,
        type: "wallet.strk20InvokeTransaction",
      },
      contentSender,
    );
    await flushHeld();
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    const result = await held;
    expect(toProviderPayload(result, "wallet_strk20InvokeTransaction").error?.code).toBe(113);
    expect(invoked).toHaveLength(0);
  });
});
