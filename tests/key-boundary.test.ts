/**
 * Key-boundary regression: no runtime message response may ever carry key
 * material out of the background. The stub vault is salted with recognizable
 * secrets; every handled message's serialized response is scanned for them.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

const SECRET_PRIVATE_KEY = "0x7e57ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8";
const SECRET_PASSPHRASE = "correct horse battery staple";
const SECRET_MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

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
  mnemonic: SECRET_MNEMONIC,
  originGrants: [{ accountIds: [account.id], origin: "https://dapp.example" }],
  schemaVersion: 2,
  signingKeys: [{ accountId: account.id, privateKey: SECRET_PRIVATE_KEY }],
} as unknown as Vault;

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://dapp.example/swap" };

const walletStub = {
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
    return SECRET_MNEMONIC;
  },
  async grantOrigin() {
    return [account];
  },
  async readVault(passphrase: string) {
    if (passphrase !== SECRET_PASSPHRASE) {
      throw new Error("bad passphrase");
    }
    return vault;
  },
  async revokeOrigin() {
    return [];
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

const runtimeRpcStub = {
  async estimateInvokeFee() {
    return { overallFee: "1", unit: "FRI" };
  },
  async getDeploymentStatus() {
    return false;
  },
  async getNftOwner() {
    return "0x0";
  },
  async getTokenBalances() {
    return [];
  },
  async getTokenMetadata() {
    return { decimals: 18, name: "Token", symbol: "TKN" };
  },
  async getTransactionStatuses() {
    return {};
  },
  async submitDeclareTransaction() {
    return { classHash: "0x1", transactionHash: "0x1" };
  },
  async submitAccountDeployment() {
    return { transactionHash: "0x7abc" };
  },
  async submitErc20Transfer() {
    return {
      call: { calldata: [], contractAddress: "0x1", entrypoint: "transfer" },
      transactionHash: "0x7abc",
    };
  },
  async submitInvokeTransaction() {
    return { calls: [], transactionHash: "0x7abc" };
  },
};

const MESSAGES: readonly {
  readonly message: Record<string, unknown>;
  readonly sender: RuntimeSender;
}[] = [
  { message: { type: "wallet.status" }, sender: extensionSender },
  {
    message: { type: "wallet.unlock", vaultPassphrase: SECRET_PASSPHRASE },
    sender: extensionSender,
  },
  { message: { type: "wallet.getBalances" }, sender: extensionSender },
  { message: { type: "wallet.deploymentStatus" }, sender: extensionSender },
  { message: { type: "wallet.deployAccount" }, sender: extensionSender },
  { message: { type: "wallet.pendingApprovals" }, sender: extensionSender },
  { message: { type: "wallet.preferences" }, sender: extensionSender },
  {
    message: { origin: "https://dapp.example", type: "wallet.requestAccounts" },
    sender: contentSender,
  },
  {
    message: { origin: "https://dapp.example", type: "wallet.getGrantedAccounts" },
    sender: contentSender,
  },
  { message: { origin: "https://dapp.example", type: "wallet.getChainId" }, sender: contentSender },
  {
    message: {
      calls: [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "transfer" }],
      origin: "https://dapp.example",
      type: "wallet.addInvokeTransaction",
    },
    sender: contentSender,
  },
  {
    message: {
      chainId: "0x534e5f4d41494e",
      origin: "https://dapp.example",
      type: "wallet.switchChain",
    },
    sender: contentSender,
  },
  { message: { accountId: account.id, type: "wallet.setActiveAccount" }, sender: extensionSender },
  { message: { networkId: "SN_MAIN", type: "wallet.setActiveNetwork" }, sender: extensionSender },
  {
    message: {
      accountId: account.id,
      messageHash: "0x1",
      type: "wallet.signHash",
      vaultPassphrase: SECRET_PASSPHRASE,
    },
    sender: extensionSender,
  },
  {
    message: { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
    sender: extensionSender,
  },
  {
    message: {
      accountId: account.id,
      amount: "1.0",
      recipient: account.address,
      tokenId: "SN_MAIN:ETH:0x1",
      type: "wallet.transfer",
    },
    sender: extensionSender,
  },
  { message: { networkId: "SN_MAIN", type: "wallet.addAccount" }, sender: extensionSender },
  {
    message: { accountId: account.id, origin: "https://dapp.example", type: "wallet.grantOrigin" },
    sender: extensionSender,
  },
  {
    message: { id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14", type: "wallet.approveOrigin" },
    sender: extensionSender,
  },
  {
    message: { id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14", type: "wallet.denyOrigin" },
    sender: extensionSender,
  },
  {
    message: { origin: "https://dapp.example", type: "wallet.revokeOrigin" },
    sender: extensionSender,
  },
  { message: { type: "wallet.connectedSites" }, sender: extensionSender },
  {
    message: { origin: "https://dapp.example", type: "wallet.getPermissions" },
    sender: contentSender,
  },
  {
    message: {
      accountId: account.id,
      amount: "1.0",
      recipient: account.address,
      tokenId: "SN_MAIN:ETH:0x1",
      type: "wallet.reviewTransfer",
    },
    sender: extensionSender,
  },
  {
    message: {
      contractAddress: account.classHash,
      recipient: account.address,
      tokenId: "1",
      type: "wallet.transferNft",
    },
    sender: extensionSender,
  },
  {
    message: {
      allowanceId: "SN_MAIN:0x1:0x2",
      type: "wallet.revokeAllowance",
    },
    sender: extensionSender,
  },
  { message: { type: "wallet.allowances" }, sender: extensionSender },
  { message: { type: "wallet.activity" }, sender: extensionSender },
  {
    message: {
      options: { address: account.classHash, decimals: 18, symbol: "TKN" },
      origin: "https://dapp.example",
      type: "wallet.watchAsset",
    },
    sender: contentSender,
  },
  { message: { address: account.classHash, type: "wallet.addToken" }, sender: extensionSender },
  { message: { type: "wallet.detectTokens" }, sender: extensionSender },
  { message: { type: "wallet.prices" }, sender: extensionSender },
  { message: { address: account.classHash, type: "wallet.tokenChart" }, sender: extensionSender },
  {
    message: { accountId: account.id, label: "Main", type: "wallet.setAccountLabel" },
    sender: extensionSender,
  },
  { message: { displayCurrency: "usd", type: "wallet.setDisplay" }, sender: extensionSender },
  {
    message: {
      origin: "https://dapp.example",
      typedData: { domain: {}, message: {}, primaryType: "X", types: {} },
      type: "wallet.signTypedData",
    },
    sender: contentSender,
  },
  { message: { type: "wallet.lock" }, sender: extensionSender },
  { message: { type: "wallet.status" }, sender: contentSender },
  {
    message: { vaultPassphrase: "wrong passphrase!!", type: "wallet.unlock" },
    sender: extensionSender,
  },
];

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe("key boundary", () => {
  test("no handled message response ever carries key material", async () => {
    const session = createUnlockSession();
    session.unlock(SECRET_PASSPHRASE);
    const handler = createMessageHandler(
      walletStub,
      "extension-id",
      session,
      undefined,
      undefined,
      runtimeRpcStub,
    );

    // State-changing dapp methods (invoke, switchChain, signTypedData) hold their
    // response until approved. Fire the request, approve any approval it queues,
    // then scan the settled response — the held result must also carry no secret.
    const settle = async (
      message: Record<string, unknown>,
      sender: RuntimeSender,
    ): Promise<unknown> => {
      const held = handler(message, sender);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await flush();
        const listed = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
          readonly pending?: readonly { readonly id: string }[];
        };
        const pending = listed.pending ?? [];
        if (pending.length === 0) {
          break;
        }
        for (const approval of pending) {
          await handler({ id: approval.id, type: "wallet.approveOrigin" }, extensionSender);
        }
      }
      return held;
    };

    for (const { message, sender } of MESSAGES) {
      const response = await settle(message, sender);
      const serialized = JSON.stringify(response);
      const sanctionedReveal =
        message.type === "wallet.generateMnemonic" || message.type === "wallet.revealSecrets";
      expect(serialized).not.toContain(SECRET_PASSPHRASE);
      expect(serialized).not.toContain("signingKeys");
      if (message.type !== "wallet.revealSecrets") {
        expect(serialized).not.toContain(SECRET_PRIVATE_KEY);
      }
      if (!sanctionedReveal) {
        expect(serialized).not.toContain(SECRET_MNEMONIC);
      }
    }
  });

  test("mnemonic generation reveals only to extension pages", async () => {
    const session = createUnlockSession();
    const handler = createMessageHandler(
      walletStub,
      "extension-id",
      session,
      undefined,
      undefined,
      runtimeRpcStub,
    );

    expect(await handler({ type: "wallet.generateMnemonic" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
    expect(await handler({ type: "wallet.generateMnemonic" }, extensionSender)).toEqual({
      mnemonic: SECRET_MNEMONIC,
      ok: true,
    });
  });

  test("reveal secrets require an extension page and the re-entered passphrase", async () => {
    const session = createUnlockSession();
    const handler = createMessageHandler(
      walletStub,
      "extension-id",
      session,
      undefined,
      undefined,
      runtimeRpcStub,
    );

    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
        contentSender,
      ),
    ).toEqual({ error: "privileged sender required" });
    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: "wrong passphrase!!" },
        extensionSender,
      ),
    ).toEqual({ error: "bad passphrase" });
    expect(
      await handler(
        { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
        extensionSender,
      ),
    ).toEqual({ mnemonic: SECRET_MNEMONIC, ok: true, privateKey: SECRET_PRIVATE_KEY });
  });
});
