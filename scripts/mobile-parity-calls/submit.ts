/**
 * The `submit` and `refusal` blocks of the call-review fixture. `submit` runs a batch through the
 * extension's invoke path, `estimateInvokeFee` for the review and `submitInvokeTransaction`
 * (`rpc/rpc-submit.ts`, the path `submitHeldInvoke` hands a dapp's approved calls to) against the
 * recording node of `../mobile-transactions-capture`: every request body in order with its reply,
 * so the execute calldata, the v3 hash signed and the fee bounds are pinned, ending in the hash
 * accepted or the refusal thrown. `refusal` is each batch the invoke path refuses before it
 * reads anything: an empty batch (`submitInvokeTransaction`), a call to the account itself
 * (`refuseOnAccountSelfCall`), and the bounds and grammar of `providerInvokeRequest`, with the
 * batches that sit exactly on each bound and pass.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import {
  estimateAccountDeploymentFee,
  estimateInvokeFee,
  submitInvokeTransaction,
} from "@bramble/starknet/rpc";
import { refuseOnAccountSelfCall } from "@bramble/transactions/verify";
import { deriveAccount } from "@bramble/vault/accounts";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { providerInvokeRequest } from "@bramble/wallet-protocol/invoke";
import { INVOKE_LIMITS } from "@bramble/wallet-protocol/invoke-limits";
import type { Call } from "starknet";
import {
  type CapturedExchange,
  type CapturedSignature,
  DEPLOY_ESTIMATE,
  INVOKE_ESTIMATE,
  type Injection,
  type MobileNetworkId,
  type NodeState,
  PLACEHOLDER_URLS,
  providerFactory,
  type Recorder,
  TRANSACTION_MNEMONIC,
} from "../mobile-transactions-capture";
import { call, ETH, ONE_AND_A_HALF, SPENDER, STRK, UNKNOWN } from "./shared";

type BatchSpec = {
  readonly name: string;
  readonly networkId: MobileNetworkId;
  readonly reviewState: NodeState;
  readonly submitState: NodeState;
  /** A fault the node shows only once the user confirms. */
  readonly inject?: Injection;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The batch every capture sends: an approve, two transfers and a call the wallet cannot name. */
const batchFor = (recipient: string): readonly Call[] => [
  call(STRK, "approve", [SPENDER, ONE_AND_A_HALF, 0]),
  call(STRK, "transfer", [recipient, ONE_AND_A_HALF, 0]),
  call(ETH, "transfer", [recipient, 7, 0]),
  call(UNKNOWN, "mint", [recipient, 1, 0]),
];

/** The phrase's OpenZeppelin account 0 on `networkId`, its key, and its account 1's address. */
const accounts = async (networkId: MobileNetworkId) => {
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const derive = (accountIndex: number) =>
    deriveAccount(kms, {
      accountContractType: "openzeppelin",
      accountIndex,
      mnemonic: TRANSACTION_MNEMONIC,
      networkId,
    });
  const sender = await derive(0);
  return { kms, recipient: (await derive(1)).account.address, sender };
};

/** One batch through the review estimate and the submission, every exchange recorded. */
const captureBatch = async (spec: BatchSpec) => {
  resetRpcEndpointCooldownsForTests();
  const { kms, recipient, sender } = await accounts(spec.networkId);
  const account = sender.account as DerivedAccountRef;
  const recorder: Recorder = {
    events: new Set(),
    exchanges: [],
    signatures: [],
    state: spec.reviewState,
  };
  const makeProvider = providerFactory(
    recorder,
    account,
    STARKNET_NETWORKS[spec.networkId].chainId,
  );
  const signatures: CapturedSignature[] = recorder.signatures;
  const signHash = async (hash: string) => {
    const signature = await kms.signStarkHash(sender.privateKey, hash);
    signatures.push({ hash, r: signature.r, s: signature.s });
    return signature;
  };
  const calls = batchFor(recipient);
  const take = (): CapturedExchange[] => recorder.exchanges.splice(0);
  const base = { account, rpcUrls: PLACEHOLDER_URLS, signHash };
  const reviewedFee = await estimateInvokeFee({ ...base, calls }, makeProvider);
  const reviewInvoke = take();
  const reviewedDeploymentFee = spec.reviewState.deployed
    ? null
    : await estimateAccountDeploymentFee(base, makeProvider);
  const reviewDeployment = take();
  recorder.state = spec.submitState;
  recorder.events.clear();
  if (spec.inject) recorder.inject = spec.inject;
  let outcome: { readonly transactionHash: string } | { readonly error: string };
  try {
    const submitted = await submitInvokeTransaction(
      { ...base, calls, ...(reviewedDeploymentFee ? { reviewedDeploymentFee } : {}), reviewedFee },
      makeProvider,
    );
    outcome = { transactionHash: submitted.transactionHash };
  } catch (error) {
    outcome = { error: messageOf(error) };
  }
  const { inject: _inject, ...rest } = spec;
  return {
    ...rest,
    account: { address: account.address },
    calls,
    flow: "invoke",
    reviewDeployment,
    reviewedDeploymentFee,
    reviewedFee,
    reviewInvoke,
    signatures,
    submit: take(),
    ...outcome,
  };
};

/** The node's re-estimate at submission: every INVOKE entry costs more than it did at review. */
const feeRose: Injection = (method, params) => {
  if (method !== "starknet_estimateFee") return undefined;
  const request = (params?.["request"] ?? []) as readonly { readonly type: string }[];
  const rose = { ...INVOKE_ESTIMATE, l2_gas_consumed: "0x48d280" };
  return {
    result: request.map((entry) => (entry.type === "DEPLOY_ACCOUNT" ? DEPLOY_ESTIMATE : rose)),
  };
};

const SCENARIOS: readonly BatchSpec[] = [
  {
    name: "a multicall from a deployed account",
    networkId: "SN_SEPOLIA",
    reviewState: { deployed: true, nonce: "0x5" },
    submitState: { deployed: true, nonce: "0x5" },
  },
  {
    name: "a multicall on mainnet",
    networkId: "SN_MAIN",
    reviewState: { deployed: true, nonce: "0x2a" },
    submitState: { deployed: true, nonce: "0x2a" },
  },
  {
    name: "a multicall that deploys the account first",
    networkId: "SN_SEPOLIA",
    reviewState: { deployed: false, nonce: "0x0" },
    submitState: { deployed: false, nonce: "0x0" },
  },
  {
    name: "a multicall whose fee rose past the reviewed one",
    networkId: "SN_SEPOLIA",
    reviewState: { deployed: true, nonce: "0x5" },
    submitState: { deployed: true, nonce: "0x5" },
    inject: feeRose,
  },
  {
    name: "a multicall that deploys first whose fee rose past the reviewed one",
    networkId: "SN_SEPOLIA",
    reviewState: { deployed: false, nonce: "0x0" },
    submitState: { deployed: false, nonce: "0x0" },
    inject: feeRose,
  },
];

/** Every capture, in order (each resets the endpoint cooldowns it may leave). */
export const computeSubmits = async () => {
  const captured = [];
  for (const spec of SCENARIOS) captured.push(await captureBatch(spec));
  return captured;
};

const repeat = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => make(index));

/** Batches the invoke path refuses before reading anything, and the ones on each bound. */
export const computeRefusals = async () => {
  const { sender } = await accounts("SN_MAIN");
  const self = sender.account.address;
  const one = call(STRK, "transfer", [SPENDER, 1, 0]);
  const parsed = (name: string, calls: readonly Call[]) => ({
    accepted: providerInvokeRequest({ calls: calls as never }) !== null,
    calls,
    check: "providerInvokeRequest",
    error: null,
    name,
  });
  const empty = await submitInvokeTransaction({
    account: sender.account,
    calls: [],
    rpcUrls: PLACEHOLDER_URLS,
    signHash: () => Promise.reject(new Error("unreachable")),
  }).then(
    () => null,
    (error: unknown) => messageOf(error),
  );
  const named = (entrypoint: string) => [call(STRK, entrypoint, [SPENDER, 1, 0])];
  return [
    {
      accepted: false,
      calls: [],
      check: "submitInvokeTransaction",
      error: empty,
      name: "an empty batch",
    },
    ...[self, `0x${self.slice(2).padStart(64, "0").toUpperCase()}`].map((contract, index) => {
      const calls = [one, call(contract, "upgrade", [1])];
      const refusal = refuseOnAccountSelfCall(calls, self);
      return {
        accepted: refusal === null,
        account: self,
        calls,
        check: "refuseOnAccountSelfCall",
        error: refusal?.error ?? null,
        name: index === 0 ? "a call to the account itself" : "the account in another spelling",
      };
    }),
    parsed(
      "the most calls",
      repeat(INVOKE_LIMITS.calls, () => one),
    ),
    parsed(
      "one call too many",
      repeat(INVOKE_LIMITS.calls + 1, () => one),
    ),
    parsed("the longest calldata", [
      call(
        UNKNOWN,
        "mint",
        repeat(INVOKE_LIMITS.calldataFelts, (i) => i),
      ),
    ]),
    parsed("calldata one felt too long", [
      call(
        UNKNOWN,
        "mint",
        repeat(INVOKE_LIMITS.calldataFelts + 1, (i) => i),
      ),
    ]),
    parsed(
      "the longest entrypoint",
      named(`_${"a".repeat(INVOKE_LIMITS.entrypointCharacters - 1)}`),
    ),
    parsed(
      "an entrypoint one character too long",
      named(`_${"a".repeat(INVOKE_LIMITS.entrypointCharacters)}`),
    ),
    parsed("an entrypoint starting with a digit", named("1transfer")),
    parsed("an entrypoint with a hyphen", named("transfer-from")),
    parsed("an empty entrypoint", named("")),
    parsed("a zero contract", [call("0x0", "transfer", [SPENDER, 1, 0])]),
  ];
};
