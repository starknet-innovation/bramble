/**
 * The Send review for an undeployed Braavos account says to deploy first. Its
 * deployment is a separate reviewed step, so a "fee unavailable — retry" card
 * would offer a retry that can never succeed. The refusal is identified by
 * account state and by the platform's typed error, never by message text, and
 * every other estimate failure keeps degrading to a retryable review.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { UndeployedBraavosError } from "@bramble/starknet/deployment";
import { memoryActivityLog } from "@bramble/transactions/activity";
import {
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  UNDEPLOYED_BRAAVOS_REFUSAL,
} from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { reviewWalletFundedFees } from "../../../apps/extension/src/background/transactions/transfer-fee-review";
import { testExtension } from "../../support/background-wallet-stub";
import {
  fixedInvokePreferences,
  invokeAccount,
  invokeExtensionSender,
  invokeVaultPassphrase,
  invokeWalletStub,
} from "../../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const braavos = (classHash: string): AccountRef =>
  ({ ...invokeAccount, accountContractType: "braavos", classHash }) as AccountRef;
const CALL = { calldata: [], contractAddress: "0x123", entrypoint: "transfer" };
const FEE = { overallFee: "1", unit: "FRI" } as const;

// A stub that reports `deployed` and records every estimate it is asked for.
const recordingRpc = (deployed: boolean, overrides: Partial<RuntimeRpc> = {}) => {
  const estimates: string[] = [];
  const rpc = makeRuntimeRpc({
    async estimateAccountDeploymentFee() {
      estimates.push("deployment");
      return FEE;
    },
    async estimateInvokeFee() {
      estimates.push("invoke");
      return FEE;
    },
    async getDeploymentStatus() {
      return deployed;
    },
    ...overrides,
  });
  return { estimates, rpc };
};

const review = (rpc: RuntimeRpc, account: AccountRef) =>
  reviewWalletFundedFees(rpc, {
    account,
    calls: [CALL],
    rpcUrls: ["https://rpc.example"],
    signHash: async () => ({ publicKey: account.publicKeyX, r: "0x1", s: "0x2" }),
  });

describe("reviewWalletFundedFees", () => {
  test("refuses an undeployed modern-class Braavos account before estimating", async () => {
    const { estimates, rpc } = recordingRpc(false);
    const refusal = review(rpc, braavos(BRAAVOS_DEPLOYMENT_CLASS_HASH));
    await expect(refusal).rejects.toBeInstanceOf(UndeployedBraavosError);
    await expect(refusal).rejects.toThrow(UNDEPLOYED_BRAAVOS_REFUSAL);
    // Nothing estimated, so the deployment's query signature is never produced.
    expect(estimates).toEqual([]);
  });

  test("passes the platform's typed refusal through when the reads disagree", async () => {
    const { rpc } = recordingRpc(true, {
      async estimateInvokeFee() {
        throw new UndeployedBraavosError();
      },
    });
    await expect(review(rpc, braavos(BRAAVOS_DEPLOYMENT_CLASS_HASH))).rejects.toBeInstanceOf(
      UndeployedBraavosError,
    );
  });

  test("keeps every other estimate failure retryable, whatever its message", async () => {
    const { rpc } = recordingRpc(true, {
      async estimateInvokeFee() {
        throw new Error(UNDEPLOYED_BRAAVOS_REFUSAL);
      },
    });
    await expect(review(rpc, invokeAccount)).resolves.toMatchObject({
      fee: null,
      feeEstimateFailed: true,
    });
  });

  test("still estimates an undeployed OpenZeppelin or older-class Braavos account", async () => {
    for (const account of [invokeAccount, braavos(BRAAVOS_BASE_CLASS_HASH)]) {
      const { estimates, rpc } = recordingRpc(false);
      await review(rpc, account);
      expect(estimates.sort()).toEqual(["deployment", "invoke"]);
    }
  });
});

test("the Send review answers with the deploy-first refusal", async () => {
  const eth = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
  const preferences: WalletPreferences = {
    ...defaultWalletPreferences(),
    activeNetworkId: "SN_MAIN",
    tokens: [
      {
        address: eth,
        decimals: 18,
        id: `SN_MAIN:${eth}`,
        name: "Ether",
        networkId: "SN_MAIN",
        symbol: "ETH",
      },
    ],
  };
  const session = createUnlockSession();
  session.unlock(invokeVaultPassphrase);
  const handler = createMessageHandler(invokeWalletStub([invokeAccount]), testExtension, {
    activity: memoryActivityLog(),
    preferencesStore: fixedInvokePreferences(preferences),
    runtimeRpc: makeRuntimeRpc({
      async estimateInvokeFee() {
        throw new UndeployedBraavosError();
      },
    }),
    session,
  });
  await expect(
    handler(
      {
        accountId: invokeAccount.id,
        amount: "1",
        recipient: "0x0511a2b3c4d5e6f7",
        tokenId: `SN_MAIN:${eth}`,
        type: "wallet.reviewTransfer",
      },
      invokeExtensionSender,
    ),
  ).resolves.toEqual({ error: UNDEPLOYED_BRAAVOS_REFUSAL });
});
