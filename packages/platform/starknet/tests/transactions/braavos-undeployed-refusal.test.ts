/**
 * An undeployed Braavos account deploys only through the explicit deployment
 * flow. Folding its deployment into an invoke or a declaration cannot work:
 * the bulk estimate would skip validation (an empty deploy signature its
 * constructor rejects), and the submission would hold the deploy signature's
 * parameters hash, not the broadcast one, as the expected transaction. Every
 * such path is refused before anything is signed, estimated, or broadcast.
 */
import { describe, expect, test } from "bun:test";
import { familyAccountAddress } from "@bramble/starknet/account-contracts";
import { estimateDeclareFee, submitDeclareTransaction } from "@bramble/starknet/declare";
import { ensureAccountDeployed, UNDEPLOYED_BRAAVOS_REFUSAL } from "@bramble/starknet/deployment";
import { estimateInvokeFee, submitInvokeTransaction } from "@bramble/starknet/rpc";
import {
  accountClassEntry,
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import type { Account, RpcProvider } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RPC_URLS = ["https://rpc.example"];
const FEE = { overallFee: "1000", unit: "FRI" } as const;

const braavosAt = (classHash: string): DerivedAccountRef => {
  const entry = accountClassEntry(classHash);
  if (!entry) throw new Error("Braavos class missing from the class table");
  const address = familyAccountAddress(entry, PUBLIC_KEY);
  return {
    accountContractType: "braavos",
    address,
    classHash,
    deploymentSalt: PUBLIC_KEY,
    derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: PUBLIC_KEY,
    publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  };
};
const modern = braavosAt(BRAAVOS_DEPLOYMENT_CLASS_HASH);

// Answers only the reads that establish "undeployed on this chain"; any other
// node call (an estimate, a nonce, a broadcast) is recorded and fails the test.
const undeployedProvider = (unexpected: string[]): RpcProvider => {
  const channel = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        return async () => {
          if (property === "specVersion") return "0.8.1";
          unexpected.push(property);
          throw new Error(`unexpected RPC: ${property}`);
        };
      },
    },
  );
  return {
    channel,
    getBlockLatestAccepted: async () => ({ block_hash: "0xb", block_number: 1 }),
    getChainId: async () => "0x534e5f4d41494e",
    getClassHashAt: async () => {
      throw Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });
    },
  } as unknown as RpcProvider;
};

const harness = () => {
  const unexpected: string[] = [];
  const signed: string[] = [];
  return {
    makeProvider: () => undeployedProvider(unexpected),
    signHash: async (messageHash: string) => {
      signed.push(messageHash);
      return { publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" };
    },
    signed,
    unexpected,
  };
};

const CALLS = [{ calldata: [], contractAddress: "0x123", entrypoint: "transfer" }];
const DECLARATION = {
  compiledClassHash: "0x6def",
  contractClass: {
    abi: [],
    contract_class_version: "0.1.0",
    entry_points_by_type: { CONSTRUCTOR: [], EXTERNAL: [], L1_HANDLER: [] },
    sierra_program: ["0x1"],
  },
};

describe("an undeployed modern-class Braavos account", () => {
  test("refuses an invoke estimate before signing or estimating", async () => {
    const h = harness();
    await expect(
      estimateInvokeFee(
        { account: modern, calls: CALLS, rpcUrls: RPC_URLS, signHash: h.signHash },
        h.makeProvider,
      ),
    ).rejects.toThrow(UNDEPLOYED_BRAAVOS_REFUSAL);
    expect(h.signed).toEqual([]);
    expect(h.unexpected).toEqual([]);
  });

  test("refuses an invoke submission before signing or broadcasting", async () => {
    const h = harness();
    await expect(
      submitInvokeTransaction(
        {
          account: modern,
          calls: CALLS,
          reviewedDeploymentFee: FEE,
          reviewedFee: FEE,
          rpcUrls: RPC_URLS,
          signHash: h.signHash,
        },
        h.makeProvider,
      ),
    ).rejects.toThrow(UNDEPLOYED_BRAAVOS_REFUSAL);
    expect(h.signed).toEqual([]);
    expect(h.unexpected).toEqual([]);
  });

  test("refuses a declaration estimate and submission before signing", async () => {
    const h = harness();
    const input = {
      ...DECLARATION,
      account: modern,
      reviewedDeploymentFee: FEE,
      reviewedFee: FEE,
      rpcUrls: RPC_URLS,
      signHash: h.signHash,
    };
    for (const operation of [
      () => estimateDeclareFee(input, h.makeProvider),
      () => submitDeclareTransaction(input, h.makeProvider),
    ]) {
      await expect(operation()).rejects.toThrow(UNDEPLOYED_BRAAVOS_REFUSAL);
    }
    expect(h.signed).toEqual([]);
    expect(h.unexpected).toEqual([]);
  });

  test("is never deployed as a side effect, whatever hash the caller expects", async () => {
    const unexpected: string[] = [];
    const touched: string[] = [];
    const starknetAccount = new Proxy({} as Account, {
      get(_target, property) {
        return async () => {
          touched.push(String(property));
          throw new Error("the account must not be used");
        };
      },
    });
    await expect(
      ensureAccountDeployed(
        undeployedProvider(unexpected),
        starknetAccount,
        modern,
        FEE,
        () => "0xaux",
      ),
    ).rejects.toThrow(UNDEPLOYED_BRAAVOS_REFUSAL);
    expect(touched).toEqual([]);
    expect(unexpected).toEqual([]);
  });
});

test("an undeployed older-class Braavos account is refused as undeployable", async () => {
  const h = harness();
  await expect(
    submitInvokeTransaction(
      {
        account: braavosAt(BRAAVOS_BASE_CLASS_HASH),
        calls: CALLS,
        reviewedDeploymentFee: FEE,
        reviewedFee: FEE,
        rpcUrls: RPC_URLS,
        signHash: h.signHash,
      },
      h.makeProvider,
    ),
  ).rejects.toThrow("This wallet does not deploy Braavos accounts");
  expect(h.signed).toEqual([]);
  expect(h.unexpected).toEqual([]);
});
