/** Seed-driven Braavos 2FA removal: the stark-key carve-out, fee cap, state. */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS,
  getBraavosRecoveryState,
  reviewBraavosRecovery,
} from "@bramble/starknet/rpc";
import { BRAAVOS_DEPLOYMENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { RpcProvider } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RPC = ["https://rpc.example"];

const account: AccountRef = {
  accountContractType: "braavos",
  address: "0xb4a",
  classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
  deploymentSalt: PUBLIC_KEY,
  derivation: { accountIndex: 0, addressIndex: 1, kind: "starknet-bip44" },
  id: "SN_MAIN:0xb4a",
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x1",
};

// A strong-signer account: stark key registered, a secp256r1 signer present,
// no deferred request pending.
const guardedReads: Record<string, readonly string[]> = {
  get_deferred_remove_signers: ["0x0"],
  get_execution_time_delay: ["0x0"],
  get_signers: ["0x1", PUBLIC_KEY, "0x1", "0xaa", "0x0"],
};

const providerWith = (
  reads: Record<string, readonly string[]>,
  estimate = 10n ** 15n,
): RpcProvider =>
  ({
    async getClassHashAt() {
      return BRAAVOS_DEPLOYMENT_CLASS_HASH;
    },
    async getBlock() {
      return { block_hash: "0xb", timestamp: 1 };
    },
    async callContract({ entrypoint }: { readonly entrypoint: string }) {
      const result = reads[entrypoint];
      if (!result) throw new Error(`unexpected read: ${entrypoint}`);
      return [...result];
    },
    async getInvokeEstimateFee() {
      return { overall_fee: estimate, resourceBounds: {} };
    },
  }) as unknown as RpcProvider;

// A stand-in starknet Account whose estimate/execute the review and submit use;
// the deployment helpers accept a makeAccount factory for exactly this.
const fakeAccount = (estimate: bigint, onSign?: (hash: string) => void) =>
  ({
    async estimateInvokeFee() {
      // The authorized spend is read from the bounds, so size the l2_gas bound
      // to the intended fee (amount × price) rather than overall_fee.
      return {
        overall_fee: estimate,
        resourceBounds: {
          l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
          l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
          l2_gas: { max_amount: `0x${estimate.toString(16)}`, max_price_per_unit: "0x1" },
        },
        unit: "FRI" as const,
      };
    },
    async execute() {
      onSign?.("0x5");
      return { transaction_hash: "0x5" };
    },
  }) as never;

const signHash = async (_hash: string) => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" });

describe("braavos recovery", () => {
  test("reviews a strong-signer account's removal fee", async () => {
    const fee = await reviewBraavosRecovery(
      { account, rpcUrls: RPC, signHash },
      () => providerWith(guardedReads),
      () => fakeAccount(10n ** 15n),
    );
    expect(fee.unit).toBe("FRI");
  });

  test("refuses an account with no strong signer to remove", async () => {
    await expect(
      reviewBraavosRecovery(
        { account, rpcUrls: RPC, signHash },
        () => providerWith({ ...guardedReads, get_signers: ["0x1", PUBLIC_KEY, "0x0", "0x0"] }),
        () => fakeAccount(10n ** 15n),
      ),
    ).rejects.toThrow("no 2FA signer to remove");
  });

  test("refuses a fee over the account's on-chain cap", async () => {
    await expect(
      reviewBraavosRecovery(
        { account, rpcUrls: RPC, signHash },
        () => providerWith(guardedReads, 200n * 10n ** 18n),
        () => fakeAccount(200n * 10n ** 18n),
      ),
    ).rejects.toThrow("on-chain cap");
  });

  test("reads the pending state and the account's delay", async () => {
    const none = await getBraavosRecoveryState(
      { accountAddress: account.address, rpcUrls: RPC },
      () => providerWith(guardedReads),
    );
    expect(none).toEqual({
      delaySeconds: DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS,
      pendingUntil: null,
    });
    const pending = await getBraavosRecoveryState(
      { accountAddress: account.address, rpcUrls: RPC },
      () =>
        providerWith({
          ...guardedReads,
          get_deferred_remove_signers: ["0x2710"],
          get_execution_time_delay: ["0x15180"],
        }),
    );
    expect(pending).toEqual({ delaySeconds: 86_400, pendingUntil: 10_000 });
  });
});
