/**
 * The gasless signing gate reuses the ordinary invoke compatibility check.
 * A probe failure is not a deployed account, and a Braavos account is judged
 * by the class at its address.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { accountSignsGaslessV2 } from "@bramble/privacy/gasless-account";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import { type AccountRef, OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import type { RpcProvider } from "starknet";
import { gaslessAccountState } from "../../../apps/extension/src/background/transactions/gasless-review";

const RPC = ["https://rpc.example/gasless-account-state"];

const account = (
  accountContractType: AccountRef["accountContractType"],
  classHash: string,
): AccountRef =>
  ({
    accountContractType,
    address: "0x11",
    classHash,
    publicKeyX: "0x22",
  }) as AccountRef;

const provider = (methods: Partial<RpcProvider>): RpcProvider => methods as RpcProvider;

describe("gaslessAccountState", () => {
  test("a failed probe is not treated as deployed", async () => {
    const broken = provider({
      async getClassHashAt() {
        throw new Error("node down");
      },
    });
    await expect(
      gaslessAccountState(
        account("openzeppelin", OPENZEPPELIN_ACCOUNT_CLASS_HASH),
        RPC,
        () => broken,
      ),
    ).rejects.toThrow("node down");
  });

  test("an absent contract is undeployed", async () => {
    const missing = provider({
      async getClassHashAt() {
        throw new Error("Contract not found");
      },
    });
    await expect(
      gaslessAccountState(
        account("openzeppelin", OPENZEPPELIN_ACCOUNT_CLASS_HASH),
        RPC,
        () => missing,
      ),
    ).resolves.toEqual({ deployed: false, liveClassHash: null });
  });

  test("an Argent guardian refuses before a gasless signature", async () => {
    const guarded = provider({
      async getBlockLatestAccepted() {
        return { block_hash: "0x10" } as Awaited<ReturnType<RpcProvider["getBlockLatestAccepted"]>>;
      },
      async getClassHashAt() {
        return ARGENT_ACCOUNT_CLASS_HASH;
      },
      async callContract(call) {
        if (call.entrypoint === "get_owner") return ["0x22"];
        if (call.entrypoint === "get_owner_type") return ["0x0"];
        if (call.entrypoint === "get_guardian") return ["0x99"];
        throw new Error(call.entrypoint);
      },
    });
    await expect(
      gaslessAccountState(account("argent", ARGENT_ACCOUNT_CLASS_HASH), RPC, () => guarded),
    ).rejects.toThrow(WalletError);
  });

  test("a deployed Braavos account reports its live implementation class", async () => {
    const live = provider({
      async getBlockLatestAccepted() {
        return { block_hash: "0x10" } as Awaited<ReturnType<RpcProvider["getBlockLatestAccepted"]>>;
      },
      async getClassHashAt() {
        return BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH;
      },
      async callContract() {
        return ["0x1", "0x22", "0x0", "0x0"];
      },
    });
    const state = await gaslessAccountState(
      account("braavos", BRAAVOS_DEPLOYMENT_CLASS_HASH),
      RPC,
      () => live,
    );
    expect(state.deployed).toBe(true);
    expect(
      accountSignsGaslessV2({
        accountContractType: "braavos",
        classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
        deployed: state.deployed,
        ...(state.liveClassHash === null ? {} : { liveClassHash: state.liveClassHash }),
      }),
    ).toBe(true);
  });
});
