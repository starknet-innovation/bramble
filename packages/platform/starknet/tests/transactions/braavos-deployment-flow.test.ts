/**
 * The explicit Braavos deployment end to end through the real signer: the
 * estimate and the submission both validate (Braavos constructors check the
 * deploy authorization even on query versions), both sign with the account's
 * own key rather than a mock, every signature in the extended layout must come
 * from that key, and the node's accepted hash must be the deploy hash — the
 * last one signed — never the parameters hash signed before it.
 */
import { expect, test } from "bun:test";
import { familyAccountAddress } from "@bramble/starknet/account-contracts";
import {
  estimateAccountDeploymentFee,
  submitAccountDeployment,
} from "@bramble/starknet/deployment";
import {
  accountClassEntry,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import type {
  AccountRef,
  DerivedAccountRef,
  LedgerAccountRef,
} from "@bramble/wallet-model/accounts";
import { hash, logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
// Sepolia, so a hard-coded mainnet chain id in the parameters would show.
const CHAIN_ID = "0x534e5f5345504f4c4941";
const REVIEWED = { overallFee: "1000", unit: "FRI" } as const;

const modern = accountClassEntry(BRAAVOS_DEPLOYMENT_CLASS_HASH);
if (!modern) throw new Error("Braavos deployment class missing from the class table");
const ADDRESS = familyAccountAddress(modern, PUBLIC_KEY);
const braavos: DerivedAccountRef = {
  accountContractType: "braavos",
  address: ADDRESS,
  classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
  deploymentSalt: PUBLIC_KEY,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_SEPOLIA:${ADDRESS}`,
  networkId: "SN_SEPOLIA",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

// The same Braavos account, but owned by a Ledger key: keyless and x-only, at
// Ready's `argentx` Ledger scheme. The deploy path is key-source-agnostic, so a
// Ledger-owned Braavos must produce the identical extended signature.
const braavosLedger: LedgerAccountRef = {
  accountContractType: "braavos",
  address: ADDRESS,
  classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
  deploymentSalt: PUBLIC_KEY,
  derivation: {
    accountIndex: 0,
    eip2645application: "argentx",
    kind: "ledger",
    path: "m/2645'/1195502025'/1148870696'/0'/0'/0",
  },
  id: `SN_SEPOLIA:${ADDRESS}`,
  networkId: "SN_SEPOLIA",
  publicKeyX: PUBLIC_KEY,
};

// The AdditionalDeploymentParams the signer must bind, and their hash.
const PARAMS = [BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH, ...Array(9).fill("0x0"), CHAIN_ID];
const AUX_HASH = hash.computePoseidonHashOnElements(PARAMS);

type Invocation = { readonly signature: readonly string[] };
type Recorded = { readonly args: readonly unknown[]; readonly method: string };

// An undeployed Braavos address on Sepolia. `accept` picks the hash the node
// reports for a broadcast from the hashes signed so far.
const harness = (
  options: {
    readonly accept?: (signed: readonly string[]) => string;
    readonly account?: AccountRef;
    readonly auxKey?: string;
  } = {},
) => {
  const calls: Recorded[] = [];
  const signed: string[] = [];
  const channel = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        const method = String(property);
        return async (...args: readonly unknown[]) => {
          calls.push({ args, method });
          if (method === "getEstimateFee") {
            return [
              {
                l1_data_gas_consumed: "0x1",
                l1_data_gas_price: "0x1",
                l1_gas_consumed: "0x1",
                l1_gas_price: "0x1",
                l2_gas_consumed: "0x1",
                l2_gas_price: "0x1",
                overall_fee: "0x3",
                unit: "FRI",
              },
            ];
          }
          if (method === "deployAccount") {
            const accepted = options.accept ? options.accept(signed) : signed.at(-1);
            return { contract_address: ADDRESS, transaction_hash: accepted };
          }
          if (method === "getChainId") return CHAIN_ID;
          if (method === "specVersion") return "0.8.1";
          return undefined;
        };
      },
    },
  );
  const provider = {
    channel,
    getBlockLatestAccepted: async () => ({ block_hash: "0xabc", block_number: 1 }),
    getChainId: async () => CHAIN_ID,
    getClassHashAt: async () => {
      throw Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });
    },
  } as unknown as RpcProvider;
  const signHash = async (messageHash: string) => {
    signed.push(messageHash);
    const publicKey = messageHash === AUX_HASH ? (options.auxKey ?? PUBLIC_KEY) : PUBLIC_KEY;
    return { publicKey, r: messageHash, s: "0x5" };
  };
  const input = {
    account: options.account ?? braavos,
    reviewedFee: REVIEWED,
    rpcUrls: [],
    signHash,
  };
  return { calls, input, makeProvider: () => provider, signed };
};

const rpcUrls = (label: string): readonly string[] => [`https://braavos-${label}.example`];

const of = (calls: readonly Recorded[], method: string): readonly Recorded[] =>
  calls.filter((call) => call.method === method);

// The 15-felt extended deploy signature: (r, s) over the deploy hash, the
// params, then (r, s) over poseidon(params). The fake signer's r is the hash
// it signed, so the layout names which hash each pair covers.
const expectExtendedSignature = (signature: readonly string[], deployHash: string): void => {
  const felts = signature.map((felt) => BigInt(felt));
  expect(felts).toHaveLength(15);
  expect(felts[0]).toBe(BigInt(deployHash));
  expect(felts[1]).toBe(5n);
  expect(felts.slice(2, 13)).toEqual(PARAMS.map((felt) => BigInt(felt)));
  expect(felts[2]).toBe(BigInt(BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH));
  expect(felts[12]).toBe(BigInt(CHAIN_ID));
  expect(felts[13]).toBe(BigInt(AUX_HASH));
  expect(felts[14]).toBe(5n);
};

const estimateArgs = (call: Recorded | undefined) => {
  if (!call) throw new Error("no estimate was requested");
  const [invocations, options] = call.args as [readonly Invocation[], { skipValidate?: boolean }];
  const invocation = invocations[0];
  if (!invocation) throw new Error("the estimate carried no invocation");
  return { options, signature: invocation.signature };
};

test("estimates a Braavos deployment with validation on and the real extended signature", async () => {
  const h = harness();
  const fee = await estimateAccountDeploymentFee(
    { ...h.input, rpcUrls: rpcUrls("estimate") },
    h.makeProvider,
  );
  expect(fee).toEqual({ overallFee: "3", unit: "FRI" });
  const estimates = of(h.calls, "getEstimateFee");
  expect(estimates).toHaveLength(1);
  const { options, signature } = estimateArgs(estimates[0]);
  expect(options.skipValidate).toBe(false);
  // Parameters first, deploy hash last — both by the account's own key.
  expect(h.signed).toHaveLength(2);
  expect(h.signed[0]).toBe(AUX_HASH);
  expectExtendedSignature(signature, h.signed[1] as string);
});

test("submits a Braavos deployment whose accepted hash is the last one signed", async () => {
  const h = harness();
  const result = await submitAccountDeployment(
    { ...h.input, rpcUrls: rpcUrls("submit") },
    h.makeProvider,
  );
  // The pre-flight estimate validated with a real signature, not a mock one.
  const { options, signature: estimated } = estimateArgs(of(h.calls, "getEstimateFee")[0]);
  expect(options.skipValidate).toBe(false);
  expectExtendedSignature(estimated, h.signed[1] as string);
  // Then the broadcast: its own aux + deploy pair, and the node's hash is the
  // deploy hash, never the parameters hash.
  const broadcasts = of(h.calls, "deployAccount");
  expect(broadcasts).toHaveLength(1);
  expect(h.signed).toHaveLength(4);
  expect(h.signed[2]).toBe(AUX_HASH);
  expect(result.transactionHash).toBe(h.signed[3] as string);
  expect(result.transactionHash).not.toBe(AUX_HASH);
  const [transaction] = (broadcasts[0]?.args ?? []) as [Invocation];
  expectExtendedSignature(transaction.signature, result.transactionHash);
});

test("treats a node answering with the parameters hash as an unknown outcome", async () => {
  const h = harness({ accept: () => AUX_HASH });
  await expect(
    submitAccountDeployment({ ...h.input, rpcUrls: rpcUrls("aux-accepted") }, h.makeProvider),
  ).rejects.toThrow("RPC accepted a different transaction hash");
});

test("refuses a Braavos deployment whose parameters signature is from another key", async () => {
  for (const [label, operation] of [
    ["estimate", estimateAccountDeploymentFee],
    ["submit", submitAccountDeployment],
  ] as const) {
    const h = harness({ auxKey: "0x123" });
    await expect(
      operation({ ...h.input, rpcUrls: rpcUrls(`foreign-${label}`) }, h.makeProvider),
    ).rejects.toThrow("Signature public key does not match the account");
    expect(of(h.calls, "getEstimateFee")).toHaveLength(0);
    expect(of(h.calls, "deployAccount")).toHaveLength(0);
  }
});

test("deploys a Ledger-owned Braavos account through the identical extended signature", async () => {
  // A keyless, x-only Braavos account owned by a Ledger key signs its deploy no
  // differently from a phrase-derived one: the same aux-then-deploy pair, the
  // deploy hash signed last and accepted by the node. Guards against a keyless
  // guard ever blocking the one family a device can own but not create here.
  const h = harness({ account: braavosLedger });
  const result = await submitAccountDeployment(
    { ...h.input, rpcUrls: rpcUrls("ledger") },
    h.makeProvider,
  );
  const broadcasts = of(h.calls, "deployAccount");
  expect(broadcasts).toHaveLength(1);
  expect(h.signed).toHaveLength(4);
  expect(h.signed[2]).toBe(AUX_HASH);
  expect(result.transactionHash).toBe(h.signed[3] as string);
  expect(result.transactionHash).not.toBe(AUX_HASH);
  const [transaction] = (broadcasts[0]?.args ?? []) as [Invocation];
  expectExtendedSignature(transaction.signature, result.transactionHash);
});
