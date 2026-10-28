/**
 * `wallet.lock` during proving stops a relayed unshield or private send
 * (Sherlock #175).
 *
 * Drives the real background router, unlock session, preparation store, job
 * registry and op context, with the real official-SDK relay branch of
 * `submitActions` and the real paymaster client behind it. The quote and the
 * private reads are stubbed so the case stays about the broadcast: the user
 * presses Lock while the proof is being generated, and the relay must never be
 * asked to execute, the job must settle `wallet locked`, and no activity entry
 * may claim the transfer happened.
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import type { Strk20Service, Strk20SubmissionPlan } from "@bramble/privacy/service";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import {
  executeResult,
  officialBuilder,
  sdkRuntime,
  strk20ProviderFor,
} from "../../../packages/features/privacy/tests/support/official-sdk";
import {
  buildStrk20Handler,
  executeStrk20Preparation,
  STRK20_EXTENSION_SENDER,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
  type Strk20Handler,
} from "../../support/strk20-background";

const POOL = "0x123";

const preferences = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: {
    SN_SEPOLIA: {
      discoveryUrl: "https://discovery.example/strk20",
      paymaster: { feeToken: STRK_TOKEN_ADDRESS, url: "https://relay.example" },
      poolAddress: POOL,
      proverUrl: "https://prover.example/strk20",
    },
  },
});

const token = preferences().tokens.find(
  (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
);
if (!token) {
  throw new Error("Sepolia token fixture missing");
}

const RELAY_PLAN: Strk20SubmissionPlan = {
  feeAction: { amount: "0x2a", recipient: "0x4", token: STRK_TOKEN_ADDRESS, type: "withdraw" },
  mode: "private-relay",
};

// The real relay branch, behind stubbed quote and private reads. `onProve`
// runs inside the SDK's proving step, after every signer check has passed.
const relayStack = (onProve: () => Promise<void>) => {
  const relayed: string[] = [];
  const official = createOfficialStrk20Service({
    http: async (_url, init) => {
      relayed.push(String((JSON.parse(String(init?.body)) as { method?: unknown }).method));
      return Response.json({
        id: "bramble-strk20",
        jsonrpc: "2.0",
        result: { transaction_hash: "0xabc" },
      });
    },
    nowSeconds: () => 1_000,
    providerFor: strk20ProviderFor(),
    sdk: sdkRuntime(() => ({
      build: () => officialBuilder(),
      discoverNotes: async () => ({ notes: new Map() }),
      async executeWithInvocation() {
        await onProve();
        return {
          ...executeResult(),
          callAndProof: {
            ...executeResult().callAndProof,
            call: { ...executeResult().callAndProof.call, contractAddress: POOL },
          },
        };
      },
    })),
  });
  const service: Strk20Service = {
    ...official,
    async privateBalances({ tokens }) {
      return tokens.map((entry) => ({ balance: "0xde0b6b3a7640000", token: entry }));
    },
    async quoteActions() {
      return RELAY_PLAN;
    },
    async registrationStatus() {
      return "registered";
    },
  };
  return { relayed, service };
};

const PREPARE = {
  transfer: "wallet.strk20PrepareTransfer",
  withdraw: "wallet.strk20PrepareWithdraw",
} as const;

describe("a lock during proving refuses the relayed broadcast", () => {
  for (const kind of ["withdraw", "transfer"] as const) {
    test(`${kind}: the job settles locked and nothing is relayed or logged`, async () => {
      const activity = memoryActivityLog();
      let handler: Strk20Handler | undefined;
      const { relayed, service } = relayStack(async () => {
        await handler?.({ type: "wallet.lock" }, STRK20_EXTENSION_SENDER);
      });
      handler = buildStrk20Handler({ activity, preferences: preferences(), strk20: service });

      const prepared = (await handler(
        { amount: "0.25", recipient: STRK20_RECIPIENT, tokenId: token.id, type: PREPARE[kind] },
        STRK20_EXTENSION_SENDER,
      )) as { readonly strk20Preparation: { readonly id: string } };

      await expect(
        executeStrk20Preparation(handler, prepared.strk20Preparation.id),
      ).resolves.toEqual({ error: "wallet locked" });
      expect(relayed).not.toContain("paymaster_executeTransaction");
      expect(await activity.list()).toEqual([]);
    });
  }

  test("without a lock the same relay settles with its hash", async () => {
    const { relayed, service } = relayStack(async () => undefined);
    const handler = buildStrk20Handler({ preferences: preferences(), strk20: service });

    const prepared = (await handler(
      {
        amount: "0.25",
        recipient: STRK20_RECIPIENT,
        tokenId: token.id,
        type: "wallet.strk20PrepareWithdraw",
      },
      STRK20_EXTENSION_SENDER,
    )) as { readonly strk20Preparation: { readonly id: string } };

    await expect(executeStrk20Preparation(handler, prepared.strk20Preparation.id)).resolves.toEqual(
      { ok: true, transactionHash: "0xabc" },
    );
    expect(relayed).toEqual(["paymaster_executeTransaction"]);
  });
});
