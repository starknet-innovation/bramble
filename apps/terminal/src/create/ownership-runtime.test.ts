import type { RpcProvider } from "starknet";
import { describe, expect, test, vi } from "vitest";
import { assertOwnerDeployed, confirmOwnershipChange, readContractOwnership } from "./ownership-runtime";
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
    await expect(assertOwnerDeployed(MAINNET, "0x1", rpc)).rejects.toThrow("Sepolia only");
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

describe("assertOwnerDeployed", () => {
  test("passes for a deployed account and refuses an empty address", async () => {
    await expect(assertOwnerDeployed(SEPOLIA, "0x5", provider({ classHash: "0xabc" }))).resolves.toBeUndefined();
    await expect(assertOwnerDeployed(SEPOLIA, "0x5", provider({ classHash: rpcError(20) }))).rejects.toThrow(
      "No account is deployed at the new owner address.",
    );
    await expect(assertOwnerDeployed(SEPOLIA, "0x5", provider({ classHash: rpcError(24) }))).rejects.toThrow("rpc 24");
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
