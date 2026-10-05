/** Phrase-driven Ready guardian escape: the owner-only carve-out and 2 steps. */
import { describe, expect, test } from "bun:test";
import { getArgentRecoveryState, reviewArgentRecovery } from "@bramble/starknet/rpc";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RPC = ["https://rpc.example"];

const account: AccountRef = {
  accountContractType: "argent",
  address: "0xa4e",
  classHash: canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) as string,
  deploymentSalt: PUBLIC_KEY,
  derivation: { addressIndex: 1, kind: "argentx-bip44" },
  id: "SN_MAIN:0xa4e",
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
};

// A guardian-restricted 0.4.0 account: owner is the wallet key, a guardian is
// set, with the escape read controllable per test.
const providerWith = (escapeState: {
  readyAt: string;
  escapeType?: string;
  status?: string;
  guardian?: string;
}): RpcProvider =>
  ({
    async getClassHashAt() {
      return canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH);
    },
    async callContract({ entrypoint }: { readonly entrypoint: string }) {
      switch (entrypoint) {
        case "get_owner":
          return [PUBLIC_KEY];
        case "get_owner_type":
          return ["0x0"];
        case "get_guardian":
          return [escapeState.guardian ?? "0xabc"];
        case "get_escape_and_status":
          // (ready_at, escape_type, new_signer=None [1], status)
          return [
            escapeState.readyAt,
            escapeState.escapeType ?? "0x1",
            "0x1",
            escapeState.status ?? "0x0",
          ];
        default:
          throw new Error(`unexpected read: ${entrypoint}`);
      }
    },
    async getInvokeEstimateFee() {
      return {};
    },
  }) as unknown as RpcProvider;

const fakeAccount = () =>
  ({
    async estimateInvokeFee() {
      return {
        overall_fee: 10n ** 15n,
        resourceBounds: {
          l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
          l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
          l2_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
        },
        unit: "FRI" as const,
      };
    },
  }) as never;

const signHash = async (_hash: string) => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" });

describe("argent recovery", () => {
  test("reports no escape when none is pending, and reviews the trigger step", async () => {
    const state = await getArgentRecoveryState(
      { accountAddress: account.address, rpcUrls: RPC },
      () => providerWith({ readyAt: "0x0", status: "0x0" }),
    );
    expect(state).toEqual({ readyAt: null, status: "none" });
    const fee = await reviewArgentRecovery(
      { account, rpcUrls: RPC, signHash },
      () => providerWith({ readyAt: "0x0", status: "0x0" }),
      () => fakeAccount(),
    );
    expect(fee.unit).toBe("FRI");
  });

  test("reads a pending and a ready guardian escape", async () => {
    const pending = await getArgentRecoveryState(
      { accountAddress: account.address, rpcUrls: RPC },
      () => providerWith({ readyAt: "0x2710", status: "0x1" }),
    );
    expect(pending).toEqual({ readyAt: 10_000, status: "pending" });
    const ready = await getArgentRecoveryState(
      { accountAddress: account.address, rpcUrls: RPC },
      () => providerWith({ readyAt: "0x2710", status: "0x2" }),
    );
    expect(ready).toEqual({ readyAt: 10_000, status: "ready" });
  });

  test("ignores an owner escape (the guardian's flow, not the phrase's)", async () => {
    const state = await getArgentRecoveryState(
      { accountAddress: account.address, rpcUrls: RPC },
      () => providerWith({ readyAt: "0x2710", escapeType: "0x2", status: "0x1" }),
    );
    expect(state).toEqual({ readyAt: null, status: "none" });
  });

  test("refuses an account with no guardian to remove", async () => {
    await expect(
      reviewArgentRecovery(
        { account, rpcUrls: RPC, signHash },
        () => providerWith({ readyAt: "0x0", guardian: "0x0" }),
        () => fakeAccount(),
      ),
    ).rejects.toThrow("no guardian to remove");
  });
});
