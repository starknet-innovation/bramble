import type { RpcProvider } from "starknet";
import { describe, expect, test, vi } from "vitest";
import { confirmTokenDeployment, createNetworkFor } from "./create-runtime";

const CLASS = "0x0385b75aa04cfee201d2e2de42daf00a839367cfd740e9042766b447d891fea0";

const provider = (classHash: string | Error) => {
  const value = {
    getClassHashAt: vi.fn(async () => {
      if (classHash instanceof Error) throw classHash;
      return classHash;
    }),
    waitForTransaction: vi.fn(async () => ({})),
  };
  return { makeProvider: () => value as unknown as RpcProvider, value };
};

describe("createNetworkFor", () => {
  test("accepts only Mainnet and Sepolia", () => {
    expect(createNetworkFor("0x534e5f4d41494e")?.id).toBe("SN_MAIN");
    expect(createNetworkFor("SN_SEPOLIA")?.id).toBe("SN_SEPOLIA");
    expect(createNetworkFor("0x534e5f4445564e4554")).toBeNull();
    expect(createNetworkFor(null)).toBeNull();
  });
});

describe("confirmTokenDeployment", () => {
  test("passes when the new address runs the pinned class (leading zeros ignored)", async () => {
    const rpc = provider("0x385b75aa04cfee201d2e2de42daf00a839367cfd740e9042766b447d891fea0");
    await confirmTokenDeployment("SN_SEPOLIA", "0xabc", "0x99", CLASS, rpc);
    expect(rpc.value.waitForTransaction).toHaveBeenCalledWith("0xabc", { retryInterval: 2_000 });
    expect(rpc.value.getClassHashAt).toHaveBeenCalledWith("0x99");
  });

  test("refuses when the address runs any other class", async () => {
    await expect(
      confirmTokenDeployment("SN_SEPOLIA", "0xabc", "0x99", CLASS, provider("0x1234")),
    ).rejects.toThrow("expected OpenZeppelin class");
  });

  test("a reverted transaction propagates and the class is never read", async () => {
    const rpc = provider(CLASS);
    rpc.value.waitForTransaction.mockRejectedValue(new Error("REVERTED"));
    await expect(confirmTokenDeployment("SN_SEPOLIA", "0xabc", "0x99", CLASS, rpc)).rejects.toThrow("REVERTED");
    expect(rpc.value.getClassHashAt).not.toHaveBeenCalled();
  });

  test("refuses an unsupported chain before any read", async () => {
    const rpc = provider(CLASS);
    await expect(confirmTokenDeployment("0x534e5f4445564e4554", "0xabc", "0x99", CLASS, rpc)).rejects.toThrow(
      "Mainnet and Sepolia",
    );
    expect(rpc.value.waitForTransaction).not.toHaveBeenCalled();
  });
});
