import type { RpcProvider } from "starknet";
import { describe, expect, test, vi } from "vitest";
import { confirmTokenDeployment, createNetworkFor, createNetworkNames } from "./create-runtime";

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
  test("ships on Sepolia only: Mainnet is refused until it is turned on", () => {
    expect(createNetworkFor("0x534e5f5345504f4c4941")?.id).toBe("SN_SEPOLIA");
    expect(createNetworkFor("SN_SEPOLIA")?.id).toBe("SN_SEPOLIA");
    expect(createNetworkFor("0x534e5f4d41494e")).toBeNull();
    expect(createNetworkFor("0x534e5f4445564e4554")).toBeNull();
    expect(createNetworkFor(null)).toBeNull();
    expect(createNetworkNames()).toBe("Starknet Sepolia");
  });

  test("an enabled network still needs verified pins", () => {
    expect(createNetworkFor("0x534e5f4d41494e", ["SN_MAIN", "SN_SEPOLIA"])?.id).toBe("SN_MAIN");
    expect(createNetworkFor("0x534e5f4445564e4554", ["SN_DEVNET"])).toBeNull();
    expect(createNetworkNames(["SN_MAIN", "SN_SEPOLIA"])).toBe("Starknet Mainnet or Starknet Sepolia");
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

  test("refuses Mainnet while it is off, before any read", async () => {
    const rpc = provider(CLASS);
    await expect(confirmTokenDeployment("0x534e5f4d41494e", "0xabc", "0x99", CLASS, rpc)).rejects.toThrow(
      "Starknet Sepolia only",
    );
    expect(rpc.value.waitForTransaction).not.toHaveBeenCalled();
  });

  test("refuses an unsupported chain before any read", async () => {
    const rpc = provider(CLASS);
    await expect(confirmTokenDeployment("0x534e5f4445564e4554", "0xabc", "0x99", CLASS, rpc)).rejects.toThrow(
      "Create works on Starknet Sepolia only.",
    );
    expect(rpc.value.waitForTransaction).not.toHaveBeenCalled();
  });
});
