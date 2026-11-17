/**
 * A send from an undeployed account deploys it first (mc-wallet 712). Activity
 * records that deployment beside the transfer, under the same summary as an
 * explicit deploy, so the deploy is never missing from history.
 */
import { describe, expect, test } from "bun:test";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { postDeploymentFailure } from "@bramble/starknet/rpc-submit";
import { memoryActivityLog } from "@bramble/transactions/activity";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { DEPLOY_ACTIVITY_SUMMARY } from "../../../apps/extension/src/background/accounts/deployment-ops";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const tokenId = `SN_MAIN:ETH:${ETH}`;

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const vaultPassphrase = "correct horse battery staple";
const reviewedFee = { overallFee: "2500000000000000", unit: "FRI" } as const;
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const signHashCalls: string[] = [];

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
    return "unused";
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
  async signHash(input: { messageHash: string }) {
    signHashCalls.push(input.messageHash);
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const DEPLOY_HASH = "0x5d1";
const TRANSFER_HASH = "0x7ab";

const rpc = (deploymentTransactionHash?: string, failure?: Error) =>
  ({
    async estimateInvokeFee() {
      return { overallFee: "2500000000000000", unit: "FRI" };
    },
    async getDeploymentStatus() {
      return deploymentTransactionHash === undefined;
    },
    async getTokenBalances() {
      return [];
    },
    async getTransactionStatuses() {
      return {};
    },
    async submitErc20Transfer() {
      if (failure) throw failure;
      return {
        call: {
          calldata: ["0x777", "1500000000000000000", "0"],
          contractAddress: ETH,
          entrypoint: "transfer",
        },
        ...(deploymentTransactionHash === undefined ? {} : { deploymentTransactionHash }),
        transactionHash: TRANSFER_HASH,
      };
    },
  }) as unknown as RuntimeRpc;

const send = async (deploymentTransactionHash?: string, failure?: Error) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const activity = memoryActivityLog(() => 10);
  const handler = createMessageHandler(walletStub, testExtension, {
    activity,
    runtimeRpc: rpc(deploymentTransactionHash, failure),
    session,
  });
  const response = await handler(
    {
      accountId: account.id,
      amount: "1.5",
      recipient: "0x777",
      reviewedFee,
      speed: "standard",
      tokenId,
      type: "wallet.transfer",
    },
    sender,
  );
  return { activity: await activity.list(), response };
};

describe("a send that deploys the account first", () => {
  test("records the deployment in Activity beside the transfer", async () => {
    const { activity, response } = await send(DEPLOY_HASH);
    expect(response).toEqual({ ok: true, transactionHash: TRANSFER_HASH });
    const deploy = activity.find((entry) => entry.hash === DEPLOY_HASH);
    expect(deploy).toMatchObject({
      accountId: account.id,
      kind: "deploy",
      networkId: "SN_MAIN",
      summary: DEPLOY_ACTIVITY_SUMMARY,
    });
    expect(
      activity.some((entry) => entry.hash === TRANSFER_HASH && entry.kind === "transfer"),
    ).toBe(true);
  });

  test("a send from a deployed account records only the transfer", async () => {
    const { activity } = await send();
    expect(activity.map((entry) => entry.kind)).toEqual(["transfer"]);
  });

  // mc-wallet 712 review: the deployment's fee is spent even when the
  // transfer after it fails, so the deployment is recorded either way.
  test("records the accepted deployment when the transfer after it is refused", async () => {
    const failure = postDeploymentFailure(DEPLOY_HASH, new Error("invoke rejected"));
    const { activity, response } = await send(DEPLOY_HASH, failure);
    expect(response).toMatchObject({ error: expect.any(String) });
    expect(activity.map((entry) => [entry.kind, entry.hash])).toEqual([["deploy", DEPLOY_HASH]]);
  });

  test("records the accepted deployment when the transfer's reply is lost", async () => {
    const failure = postDeploymentFailure(
      DEPLOY_HASH,
      new IndeterminateRpcWriteError("reply lost"),
    );
    const { activity, response } = await send(DEPLOY_HASH, failure);
    expect(response).toMatchObject({ submissionUnknown: true });
    expect(activity.find((entry) => entry.hash === DEPLOY_HASH)).toMatchObject({
      kind: "deploy",
      summary: DEPLOY_ACTIVITY_SUMMARY,
    });
  });

  test("an ordinary failure with no deployment records nothing", async () => {
    const { activity } = await send(undefined, new Error("invoke rejected"));
    expect(activity).toEqual([]);
  });
});
