/**
 * rememberDeployedAccounts: a "deployed" answer is served from memory per
 * canonical address and endpoint list, so a deployed account costs one
 * `getClassHashAt`; "not deployed", failures and addresses the reader refuses
 * always reach the chain and are never stored.
 */
import { describe, expect, test } from "bun:test";
import { getDeploymentStatus } from "@bramble/starknet/deployment";
import { type DeploymentStatusInput, rememberDeployedAccounts } from "@bramble/starknet/rpc";
import { logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const ADDRESS = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const PADDED_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const OTHER_ADDRESS = "0x2b31e19e45c06f29234e06e2ee98a9966479ba3067f8785ed972794fdb0065c";
const THIRD_ADDRESS = "0x36078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";
const CLASS_HASH = "0x29927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";
const MAINNET_RPC = ["https://mainnet.rpc.example"];
const SEPOLIA_RPC = ["https://sepolia.rpc.example"];

// A "contract not found" RPC error the way starknet.js surfaces code 20.
const notFoundError = (): Error =>
  Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });

// A stub reader that records every input reaching it and answers from `answer`.
const stubRead = (answer: (input: DeploymentStatusInput) => boolean | Error) => {
  const calls: DeploymentStatusInput[] = [];
  const read = async (input: DeploymentStatusInput): Promise<boolean> => {
    calls.push(input);
    const result = answer(input);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { calls, read };
};

describe("rememberDeployedAccounts", () => {
  test("answers a deployed address from memory after the first read", async () => {
    const { calls, read } = stubRead(() => true);
    const status = rememberDeployedAccounts(read);
    const input = { accountAddress: ADDRESS, rpcUrls: MAINNET_RPC };
    expect(await status(input)).toBe(true);
    expect(await status(input)).toBe(true);
    expect(await status(input)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("never remembers an undeployed address, so a later deployment is seen", async () => {
    let deployed = false;
    const { calls, read } = stubRead(() => deployed);
    const status = rememberDeployedAccounts(read);
    const input = { accountAddress: ADDRESS, rpcUrls: MAINNET_RPC };
    expect(await status(input)).toBe(false);
    expect(await status(input)).toBe(false);
    deployed = true;
    expect(await status(input)).toBe(true);
    expect(await status(input)).toBe(true);
    expect(calls).toHaveLength(3);
  });

  test("never remembers a failed read; the next call reads again", async () => {
    let failing = true;
    const { calls, read } = stubRead(() => (failing ? new Error("node unavailable") : true));
    const status = rememberDeployedAccounts(read);
    const input = { accountAddress: ADDRESS, rpcUrls: MAINNET_RPC };
    await expect(status(input)).rejects.toThrow("node unavailable");
    failing = false;
    expect(await status(input)).toBe(true);
    expect(await status(input)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("keys on the endpoint list, so one address on another network reads again", async () => {
    const { calls, read } = stubRead((input) => input.rpcUrls === MAINNET_RPC);
    const status = rememberDeployedAccounts(read);
    expect(await status({ accountAddress: ADDRESS, rpcUrls: MAINNET_RPC })).toBe(true);
    expect(await status({ accountAddress: ADDRESS, rpcUrls: SEPOLIA_RPC })).toBe(false);
    expect(await status({ accountAddress: ADDRESS, rpcUrls: SEPOLIA_RPC })).toBe(false);
    expect(calls.map((call) => call.rpcUrls)).toEqual([MAINNET_RPC, SEPOLIA_RPC, SEPOLIA_RPC]);
  });

  test("a changed endpoint list for the same network reads again", async () => {
    const { calls, read } = stubRead(() => true);
    const status = rememberDeployedAccounts(read);
    await status({ accountAddress: ADDRESS, rpcUrls: MAINNET_RPC });
    await status({ accountAddress: ADDRESS, rpcUrls: ["https://custom.rpc.example"] });
    await status({ accountAddress: ADDRESS, rpcUrls: [...MAINNET_RPC, "https://b.rpc.example"] });
    expect(calls).toHaveLength(3);
  });

  test("treats zero-padded spellings of one address as the same account", async () => {
    const { calls, read } = stubRead(() => true);
    const status = rememberDeployedAccounts(read);
    expect(await status({ accountAddress: PADDED_ADDRESS, rpcUrls: MAINNET_RPC })).toBe(true);
    expect(await status({ accountAddress: ADDRESS, rpcUrls: MAINNET_RPC })).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("passes a spelling the reader refuses through to it, even once its felt is known", async () => {
    const { calls, read } = stubRead((input) =>
      input.accountAddress === ADDRESS ? true : new Error("Invalid account address"),
    );
    const status = rememberDeployedAccounts(read);
    await status({ accountAddress: ADDRESS, rpcUrls: MAINNET_RPC });
    const decimal = BigInt(ADDRESS).toString(10);
    for (const accountAddress of [decimal, ADDRESS.toUpperCase().replace("0X", "0x"), "0x0"]) {
      await expect(status({ accountAddress, rpcUrls: MAINNET_RPC })).rejects.toThrow(
        "Invalid account address",
      );
    }
    expect(calls).toHaveLength(4);
  });

  test("evicts the oldest remembered address once at capacity", async () => {
    const { calls, read } = stubRead(() => true);
    const status = rememberDeployedAccounts(read, 2);
    const lookup = (accountAddress: string) => status({ accountAddress, rpcUrls: MAINNET_RPC });
    await lookup(ADDRESS);
    await lookup(OTHER_ADDRESS);
    await lookup(THIRD_ADDRESS);
    expect(calls).toHaveLength(3);
    await lookup(OTHER_ADDRESS);
    await lookup(THIRD_ADDRESS);
    expect(calls).toHaveLength(3);
    await lookup(ADDRESS);
    expect(calls.map((call) => call.accountAddress)).toEqual([
      ADDRESS,
      OTHER_ADDRESS,
      THIRD_ADDRESS,
      ADDRESS,
    ]);
  });
});

describe("rememberDeployedAccounts over getDeploymentStatus", () => {
  // Counts the getClassHashAt reads that reach the node.
  const countingChain = (deployed: ReadonlySet<string>) => {
    const reads: string[] = [];
    const provider = {
      async getClassHashAt(address: string) {
        reads.push(address);
        if (!deployed.has(address)) {
          throw notFoundError();
        }
        return CLASS_HASH;
      },
    } as unknown as RpcProvider;
    const status = rememberDeployedAccounts((input) => getDeploymentStatus(input, () => provider));
    return { reads, status };
  };

  test("a deployed account costs one getClassHashAt; an undeployed one costs one per read", async () => {
    const { reads, status } = countingChain(new Set([ADDRESS]));
    for (let round = 0; round < 3; round += 1) {
      expect(await status({ accountAddress: ADDRESS, rpcUrls: MAINNET_RPC })).toBe(true);
      expect(await status({ accountAddress: OTHER_ADDRESS, rpcUrls: MAINNET_RPC })).toBe(false);
    }
    expect(reads).toEqual([ADDRESS, OTHER_ADDRESS, OTHER_ADDRESS, OTHER_ADDRESS]);
  });

  test("still refuses an invalid address before any RPC call", async () => {
    const { reads, status } = countingChain(new Set([ADDRESS]));
    await expect(status({ accountAddress: "0x0", rpcUrls: MAINNET_RPC })).rejects.toThrow(
      "Invalid account address",
    );
    expect(reads).toEqual([]);
  });
});
