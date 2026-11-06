import type { RpcProvider } from "starknet";
import { describe, expect, test, vi } from "vitest";
import { assertOwnerIsAccount, confirmOwnershipChange, readContractOwnership } from "./ownership-runtime";
import { TOKEN_PRESETS } from "./token-presets";

const SEPOLIA = "0x534e5f5345504f4c4941";
const MAINNET = "0x534e5f4d41494e";
const CONTRACT = "0x99";

const rpcError = (code: number): Error =>
  Object.assign(new Error(`rpc ${code}`), { baseError: { code, message: "x" } });

const provider = (state: { classHash?: string | Error; owner?: readonly string[] }) => {
  const value = {
    callContract: vi.fn(async () => state.owner ?? ["0x123"]),
    getClassHashAt: vi.fn(async () => {
      if (state.classHash instanceof Error) throw state.classHash;
      return state.classHash ?? TOKEN_PRESETS.erc721.classHash;
    }),
    waitForTransaction: vi.fn(async () => ({})),
  };
  return { makeProvider: () => value as unknown as RpcProvider, value };
};

describe("readContractOwnership", () => {
  test("returns the preset and the canonical owner", async () => {
    const rpc = provider({ owner: ["0x00123"] });
    await expect(readContractOwnership(SEPOLIA, CONTRACT, rpc)).resolves.toEqual({
      contract: CONTRACT,
      owner: "0x123",
      standard: "erc721",
    });
    expect(rpc.value.getClassHashAt).toHaveBeenCalledWith(CONTRACT);
    expect(rpc.value.callContract).toHaveBeenCalledWith({
      calldata: [],
      contractAddress: CONTRACT,
      entrypoint: "owner",
    });
  });

  test("refuses Mainnet while Create is Sepolia only, before any read", async () => {
    const rpc = provider({});
    await expect(readContractOwnership(MAINNET, CONTRACT, rpc)).rejects.toThrow(
      "Ownership changes work on Starknet Sepolia only.",
    );
    await expect(confirmOwnershipChange(MAINNET, "0xabc", CONTRACT, "0x1", rpc)).rejects.toThrow("Sepolia only");
    await expect(assertOwnerIsAccount(MAINNET, "0x1", rpc)).rejects.toThrow("Sepolia only");
    expect(rpc.value.getClassHashAt).not.toHaveBeenCalled();
    expect(rpc.value.waitForTransaction).not.toHaveBeenCalled();
  });

  test("refuses a contract that doesn't run a pinned preset, without reading its owner", async () => {
    const rpc = provider({ classHash: "0x1234" });
    await expect(readContractOwnership(SEPOLIA, CONTRACT, rpc)).rejects.toThrow(
      "This contract doesn't run an OpenZeppelin preset that Create deploys.",
    );
    expect(rpc.value.callContract).not.toHaveBeenCalled();
  });

  test("says when nothing is deployed, and keeps other RPC errors", async () => {
    await expect(readContractOwnership(SEPOLIA, CONTRACT, provider({ classHash: rpcError(20) }))).rejects.toThrow(
      "No contract is deployed at this address.",
    );
    await expect(readContractOwnership(SEPOLIA, CONTRACT, provider({ classHash: rpcError(24) }))).rejects.toThrow(
      "rpc 24",
    );
  });

  test("refuses an owner reply that isn't one felt", async () => {
    await expect(readContractOwnership(SEPOLIA, CONTRACT, provider({ owner: [] }))).rejects.toThrow(
      "The contract returned an unexpected owner.",
    );
    await expect(readContractOwnership(SEPOLIA, CONTRACT, provider({ owner: ["0x1", "0x2"] }))).rejects.toThrow(
      "unexpected owner",
    );
  });
});

describe("assertOwnerIsAccount", () => {
  const SRC6 = "0x2ceccef7f994940b3962a6c67e0ba4fcd37df7d131417c604f91e03caecc1cd";

  test("passes only for an account that says it supports SRC6", async () => {
    const rpc = provider({ owner: ["0x1"] });
    await expect(assertOwnerIsAccount(SEPOLIA, "0x5", rpc)).resolves.toBeUndefined();
    expect(rpc.value.callContract).toHaveBeenCalledWith({
      calldata: [SRC6],
      contractAddress: "0x5",
      entrypoint: "supports_interface",
    });
  });

  test("refuses an empty address, a token contract, and a contract without SRC5", async () => {
    const notAccount = "The new owner address isn't a Starknet account.";
    const failing = (error: Error) => {
      const rpc = provider({});
      rpc.value.callContract.mockRejectedValue(error);
      return rpc;
    };
    await expect(assertOwnerIsAccount(SEPOLIA, "0x5", failing(rpcError(20)))).rejects.toThrow(
      "No account is deployed at the new owner address.",
    );
    // A pinned token answers SRC5 with false for the account interface.
    await expect(assertOwnerIsAccount(SEPOLIA, "0x5", provider({ owner: ["0x0"] }))).rejects.toThrow(notAccount);
    await expect(assertOwnerIsAccount(SEPOLIA, "0x5", provider({ owner: [] }))).rejects.toThrow(notAccount);
    // Missing entry point (21) or a failed call (40): not an account either.
    await expect(assertOwnerIsAccount(SEPOLIA, "0x5", failing(rpcError(21)))).rejects.toThrow(notAccount);
    await expect(assertOwnerIsAccount(SEPOLIA, "0x5", failing(rpcError(40)))).rejects.toThrow(notAccount);
  });

  test("a transport fault stays a transport fault, never a verdict", async () => {
    await expect(
      assertOwnerIsAccount(
        SEPOLIA,
        "0x5",
        (() => {
          const rpc = provider({});
          rpc.value.callContract.mockRejectedValue(new TypeError("fetch failed"));
          return rpc;
        })(),
      ),
    ).rejects.toThrow("fetch failed");
  });
});

describe("confirmOwnershipChange", () => {
  test("waits for the transaction, then needs the expected owner", async () => {
    const rpc = provider({ owner: ["0x5"] });
    await confirmOwnershipChange(SEPOLIA, "0xabc", CONTRACT, "0x05", rpc);
    expect(rpc.value.waitForTransaction).toHaveBeenCalledWith("0xabc", { retryInterval: 2_000 });
    await expect(confirmOwnershipChange(SEPOLIA, "0xabc", CONTRACT, "0x0", rpc)).rejects.toThrow(
      "The contract doesn't show the expected owner after this transaction.",
    );
  });

  test("a renounce is confirmed only by a zero owner", async () => {
    await expect(
      confirmOwnershipChange(SEPOLIA, "0xabc", CONTRACT, "0x0", provider({ owner: ["0x0"] })),
    ).resolves.toBeUndefined();
  });

  test("a reverted transaction is never reported as a change", async () => {
    const rpc = provider({ owner: ["0x5"] });
    rpc.value.waitForTransaction.mockRejectedValueOnce(new Error("REVERTED: Caller is not the owner"));
    await expect(confirmOwnershipChange(SEPOLIA, "0xabc", CONTRACT, "0x5", rpc)).rejects.toThrow("REVERTED");
    expect(rpc.value.callContract).not.toHaveBeenCalled();
  });
});
