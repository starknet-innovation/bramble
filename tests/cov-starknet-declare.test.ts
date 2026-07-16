/**
 * submitDeclareTransaction unit coverage: the real function is driven against a
 * fake starknet provider/account so the sign+submit path runs end to end. The
 * provider reports the account already deployed (so ensureAccountDeployed short
 * circuits) and the account's declare returns node hashes, which the function
 * must surface as { classHash, transactionHash }. The optional classHash hint is
 * forwarded when present and omitted when absent.
 *
 * `starknet` is module-mocked only for this file (real exports are spread so the
 * Krusty signer's base class stays intact) and restored in afterAll so sibling
 * suites keep the genuine module.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import * as realStarknet from "starknet";
import type { AccountRef } from "../src/storage/vault-schema";

// Snapshot the genuine module before any mock replaces it in the registry.
const realExports = { ...realStarknet };

const declareCalls: Array<Record<string, unknown>> = [];
const classHashAtCalls: string[] = [];

class FakeRpcProvider {
  public constructor(_config: unknown) {}
  public async getClassHashAt(address: string): Promise<string> {
    classHashAtCalls.push(address);
    // A resolving getClassHashAt means the contract exists, so deployment is
    // skipped and the declare proceeds directly.
    return "0x1";
  }
}

class FakeAccount {
  public readonly address: string;
  public constructor(config: { address: string }) {
    this.address = config.address;
  }
  public async declare(payload: Record<string, unknown>): Promise<{
    class_hash: string;
    transaction_hash: string;
  }> {
    declareCalls.push(payload);
    return { class_hash: "0xc1a55", transaction_hash: "0x7dec1a5e" };
  }
}

let submitDeclareTransaction: typeof import("../src/starknet/declare").submitDeclareTransaction;

beforeAll(async () => {
  mock.module("starknet", () => ({
    ...realExports,
    Account: FakeAccount,
    RpcProvider: FakeRpcProvider,
  }));
  ({ submitDeclareTransaction } = await import("../src/starknet/declare"));
});

afterAll(() => {
  mock.module("starknet", () => realExports);
});

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const contractClass = { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] };
const signHash = async () => ({ publicKey: account.publicKeyX, r: "0x1", s: "0x2" });

describe("submitDeclareTransaction", () => {
  test("signs, submits, and returns the node's class and transaction hashes", async () => {
    declareCalls.length = 0;
    classHashAtCalls.length = 0;

    const result = await submitDeclareTransaction({
      account,
      classHash: "0x5abc",
      compiledClassHash: "0x6def",
      contractClass,
      rpcUrls: ["https://rpc.example"],
      signHash,
    });

    expect(result).toEqual({ classHash: "0xc1a55", transactionHash: "0x7dec1a5e" });
    // Deployment was checked (and found already deployed) before declaring.
    expect(classHashAtCalls).toEqual([account.address]);
    // The declare payload carries the compiled class hash and forwards the hint.
    expect(declareCalls).toHaveLength(1);
    expect(declareCalls[0]).toMatchObject({
      classHash: "0x5abc",
      compiledClassHash: "0x6def",
    });
    expect(declareCalls[0]?.["contract"]).toBe(contractClass);
  });

  test("omits the optional classHash from the declare payload when not provided", async () => {
    declareCalls.length = 0;

    const result = await submitDeclareTransaction({
      account,
      compiledClassHash: "0x6def",
      contractClass,
      rpcUrls: ["https://rpc.example"],
      signHash,
    });

    expect(result).toEqual({ classHash: "0xc1a55", transactionHash: "0x7dec1a5e" });
    expect(declareCalls[0]).toMatchObject({ compiledClassHash: "0x6def" });
    expect(declareCalls[0]).not.toHaveProperty("classHash");
  });
});
