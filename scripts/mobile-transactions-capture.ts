/**
 * Wire capture for the mobile transaction fixture. Runs the extension's real send path
 * (`estimateInvokeFee`, `estimateAccountDeploymentFee`, `submitErc20Transfer`,
 * `submitAccountDeployment`) against a recording JSON-RPC transport with canned node replies, and
 * records every request body in order with the reply it was given. Nothing reaches a network: the
 * transport is a local function and the endpoint URL is never resolved.
 *
 * The signer is the extension's own: Krusty WASM `signStarkHash` over the key `deriveAccount`
 * returns, through `krustyAccount`'s OpenZeppelin serialisation. The phrase is the repository's
 * published E2E phrase, so every hash and signature here is public.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { createRpcProvider, resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import {
  estimateAccountDeploymentFee,
  estimateInvokeFee,
  type FeeEstimate,
  submitAccountDeployment,
  submitErc20Transfer,
} from "@bramble/starknet/rpc";
import { deriveAccount } from "@bramble/vault/accounts";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

/** Networks the mobile core supports. */
export type MobileNetworkId = "SN_MAIN" | "SN_SEPOLIA";

/** One JSON-RPC exchange: the request as sent (without its id) and the reply the node gave. */
export type CapturedExchange = {
  readonly method: string;
  readonly params: unknown;
  readonly reply: { readonly result: unknown } | { readonly error: unknown };
};

/** One hash the extension signed, with the signature it produced. */
export type CapturedSignature = { readonly hash: string; readonly r: string; readonly s: string };

/** Node state a scenario's canned replies are drawn from. */
type NodeState = {
  deployed: boolean;
  nonce: string;
};

/** A canned-node scenario for one account on one network. */
export type ScenarioSpec = {
  readonly name: string;
  readonly networkId: MobileNetworkId;
  /** Node state while the review is estimated. */
  readonly reviewState: NodeState;
  /** Node state when the user confirms (may differ: deployed elsewhere, nonce advanced). */
  readonly submitState: NodeState;
  /** `transfer` runs the Send journey; `deployment` the standalone Deploy account flow. */
  readonly flow: "deployment" | "transfer";
};

/** The recorded wire traffic and signatures of one scenario. */
export type CapturedScenario = ScenarioSpec & {
  readonly accountIndex: number;
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
  readonly reviewedFee: FeeEstimate | null;
  readonly reviewedDeploymentFee: FeeEstimate | null;
  readonly reviewInvoke: readonly CapturedExchange[];
  readonly reviewDeployment: readonly CapturedExchange[];
  readonly submit: readonly CapturedExchange[];
  readonly signatures: readonly CapturedSignature[];
  readonly transactionHash: string;
};

/** Canned estimate for an INVOKE entry (RPC 0.10 `FEE_ESTIMATE`, hex quantities). */
const INVOKE_ESTIMATE = {
  l1_data_gas_consumed: "0x180",
  l1_data_gas_price: "0x5a0",
  l1_gas_consumed: "0x0",
  l1_gas_price: "0x2d5c6b1e1ef",
  l2_gas_consumed: "0x1234a0",
  l2_gas_price: "0xb2d05e00",
  overall_fee: "0x1bb0f4d6c0000",
  unit: "FRI",
};

/** Canned estimate for a DEPLOY_ACCOUNT entry; distinct so the two are never confused. */
const DEPLOY_ESTIMATE = {
  l1_data_gas_consumed: "0x1e0",
  l1_data_gas_price: "0x5a0",
  l1_gas_consumed: "0x0",
  l1_gas_price: "0x2d5c6b1e1ef",
  l2_gas_consumed: "0xf4240",
  l2_gas_price: "0xb2d05e00",
  overall_fee: "0xabc",
  unit: "FRI",
};

const CONTRACT_NOT_FOUND = { code: 20, message: "Contract not found" };

/** Published E2E phrase (tests/e2e/wallet-helpers.ts); never holds funds. */
export const TRANSACTION_MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

/** Amount the Send scenarios transfer, as typed. */
export const TRANSACTION_AMOUNT = "1.5";

const STRK = (networkId: MobileNetworkId) => {
  const token = DEFAULT_TOKENS.find(
    (entry) => entry.networkId === networkId && entry.symbol === "STRK",
  );
  if (!token) throw new Error(`no STRK on ${networkId}`);
  // A tracked token as the extension's preferences hold it (`TokenConfig` carries an id).
  return { ...token, id: `${networkId}:${token.address}` };
};

/** A fault injected into the node: a replacement reply, or a transport failure. */
type Injection = (
  method: string,
  params: Record<string, unknown> | undefined,
) => { readonly result: unknown } | { readonly error: unknown } | "transport" | undefined;

type Recorder = {
  readonly exchanges: CapturedExchange[];
  readonly signatures: CapturedSignature[];
  state: NodeState;
  /** Holds `deployWritten` once the node has accepted this scenario's DEPLOY_ACCOUNT. */
  readonly events: Set<string>;
  inject?: Injection;
};

const reply = (
  recorder: Recorder,
  method: string,
  params: Record<string, unknown> | undefined,
  account: DerivedAccountRef,
  chainId: string,
): { readonly result: unknown } | { readonly error: unknown } => {
  const lastSigned = recorder.signatures.at(-1)?.hash;
  const deployWritten = recorder.events.has("deployWritten");
  const deployedNow = recorder.state.deployed || deployWritten;
  switch (method) {
    case "starknet_chainId":
      return { result: chainId };
    case "starknet_getClassHashAt":
      return deployedNow ? { result: account.classHash } : { error: CONTRACT_NOT_FOUND };
    case "starknet_getNonce":
      if (deployWritten) return { result: "0x1" };
      return recorder.state.deployed
        ? { result: recorder.state.nonce }
        : { error: CONTRACT_NOT_FOUND };
    case "starknet_estimateFee": {
      const request = (params?.["request"] ?? []) as readonly { readonly type: string }[];
      return {
        result: request.map((entry) =>
          entry.type === "DEPLOY_ACCOUNT" ? DEPLOY_ESTIMATE : INVOKE_ESTIMATE,
        ),
      };
    }
    case "starknet_addDeployAccountTransaction":
      recorder.events.add("deployWritten");
      return { result: { contract_address: account.address, transaction_hash: lastSigned } };
    case "starknet_addInvokeTransaction":
      return { result: { transaction_hash: lastSigned } };
    case "starknet_getTransactionStatus":
      return { result: { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L2" } };
    case "starknet_getTransactionReceipt":
      return {
        result: {
          actual_fee: { amount: "0x1", unit: "FRI" },
          block_hash: "0x1",
          block_number: 1,
          contract_address: account.address,
          events: [],
          execution_resources: { l1_data_gas: 0, l1_gas: 0, l2_gas: 0 },
          execution_status: "SUCCEEDED",
          finality_status: "ACCEPTED_ON_L2",
          messages_sent: [],
          transaction_hash: lastSigned,
          type: "DEPLOY_ACCOUNT",
        },
      };
    default:
      return { error: { code: -32601, message: "Method not found" } };
  }
};

const providerFactory =
  (recorder: Recorder, account: DerivedAccountRef, chainId: string) =>
  (nodeUrl: string): RpcProvider =>
    createRpcProvider(nodeUrl, {
      baseFetch: (async (_input: unknown, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          readonly id: number;
          readonly method: string;
          readonly params?: Record<string, unknown>;
        };
        const injected = recorder.inject?.(request.method, request.params);
        if (injected === "transport") {
          throw new TypeError("fetch failed");
        }
        const answer =
          injected ?? reply(recorder, request.method, request.params, account, chainId);
        recorder.exchanges.push({
          method: request.method,
          params: request.params ?? null,
          reply: answer,
        });
        return new Response(JSON.stringify({ id: request.id, jsonrpc: "2.0", ...answer }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }) as never,
      // The deploy wait's poll interval is starknet.js's default (5 s, pinned in the fixture's
      // timing section); shortening it here changes no request body.
      transactionRetryIntervalFallback: 1,
    });

const PLACEHOLDER_URLS = ["https://capture.invalid/rpc"];

/**
 * Runs one scenario through the extension's real send path and returns its recorded traffic.
 * Deterministic: canned replies and RFC-6979 signatures give identical output on every run.
 */
export const captureScenario = async (
  spec: ScenarioSpec,
  inject?: Injection,
): Promise<CapturedScenario> => {
  // A captured transport failure cools its endpoint down process-wide; every run starts clean.
  resetRpcEndpointCooldownsForTests();
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const derive = (accountIndex: number) =>
    deriveAccount(kms, {
      accountContractType: "openzeppelin",
      accountIndex,
      mnemonic: TRANSACTION_MNEMONIC,
      networkId: spec.networkId,
    });
  const sender = await derive(0);
  const recipient = (await derive(1)).account.address;
  const account = sender.account as DerivedAccountRef;
  const chainId = STARKNET_NETWORKS[spec.networkId].chainId;
  const recorder: Recorder = {
    exchanges: [],
    signatures: [],
    events: new Set(),
    state: spec.reviewState,
  };
  const makeProvider = providerFactory(recorder, account, chainId);
  const signHash = async (hash: string) => {
    const signature = await kms.signStarkHash(sender.privateKey, hash);
    recorder.signatures.push({ hash, r: signature.r, s: signature.s });
    return signature;
  };
  const token = STRK(spec.networkId);
  const call = {
    calldata: [recipient, "1500000000000000000", "0"],
    contractAddress: token.address,
    entrypoint: "transfer",
  };
  const take = (): CapturedExchange[] => recorder.exchanges.splice(0);

  const reviewedFee =
    spec.flow === "transfer"
      ? await estimateInvokeFee(
          { account, calls: [call], rpcUrls: PLACEHOLDER_URLS, signHash },
          makeProvider,
        )
      : null;
  const reviewInvoke = take();
  const reviewedDeploymentFee = spec.reviewState.deployed
    ? null
    : await estimateAccountDeploymentFee(
        { account, rpcUrls: PLACEHOLDER_URLS, signHash },
        makeProvider,
      );
  const reviewDeployment = take();

  recorder.state = spec.submitState;
  recorder.events.clear();
  if (inject) recorder.inject = inject;
  let transactionHash: string;
  if (spec.flow === "transfer") {
    if (!reviewedFee) throw new Error("transfer review produced no fee");
    const submitted = await submitErc20Transfer(
      {
        account,
        amount: TRANSACTION_AMOUNT,
        recipient,
        ...(reviewedDeploymentFee ? { reviewedDeploymentFee } : {}),
        reviewedFee,
        rpcUrls: PLACEHOLDER_URLS,
        signHash,
        token,
      },
      makeProvider,
    );
    transactionHash = submitted.transactionHash;
  } else {
    if (!reviewedDeploymentFee) throw new Error("deployment review produced no fee");
    const submitted = await submitAccountDeployment(
      { account, reviewedFee: reviewedDeploymentFee, rpcUrls: PLACEHOLDER_URLS, signHash },
      makeProvider,
    );
    transactionHash = submitted.transactionHash;
  }
  return {
    ...spec,
    accountIndex: 0,
    amount: TRANSACTION_AMOUNT,
    recipient,
    reviewDeployment,
    reviewedDeploymentFee,
    reviewedFee,
    reviewInvoke,
    signatures: recorder.signatures,
    submit: take(),
    token: token.address,
    transactionHash,
  };
};

/** Every scenario the mobile plan is pinned against. */
export const TRANSACTION_SCENARIOS: readonly ScenarioSpec[] = [
  ...(["SN_SEPOLIA", "SN_MAIN"] as const).flatMap((networkId) => [
    {
      flow: "transfer" as const,
      name: `deployed-${networkId}`,
      networkId,
      reviewState: { deployed: true, nonce: "0x5" },
      submitState: { deployed: true, nonce: "0x5" },
    },
    {
      flow: "transfer" as const,
      name: `undeployed-${networkId}`,
      networkId,
      reviewState: { deployed: false, nonce: "0x0" },
      submitState: { deployed: false, nonce: "0x0" },
    },
  ]),
  {
    flow: "transfer",
    name: "deployed-after-review-SN_SEPOLIA",
    networkId: "SN_SEPOLIA",
    reviewState: { deployed: false, nonce: "0x0" },
    submitState: { deployed: true, nonce: "0x1" },
  },
  {
    flow: "transfer",
    name: "nonce-advanced-SN_SEPOLIA",
    networkId: "SN_SEPOLIA",
    reviewState: { deployed: true, nonce: "0x5" },
    submitState: { deployed: true, nonce: "0x6" },
  },
  {
    flow: "deployment",
    name: "standalone-deployment-SN_SEPOLIA",
    networkId: "SN_SEPOLIA",
    reviewState: { deployed: false, nonce: "0x0" },
    submitState: { deployed: false, nonce: "0x0" },
  },
];

/** Runs every scenario. */
export const captureTransactionScenarios = async (): Promise<readonly CapturedScenario[]> => {
  const scenarios: CapturedScenario[] = [];
  for (const spec of TRANSACTION_SCENARIOS) {
    scenarios.push(await captureScenario(spec));
  }
  return scenarios;
};

const spec = (name: string, deployed: boolean, flow: ScenarioSpec["flow"] = "transfer") => ({
  flow,
  name,
  networkId: "SN_SEPOLIA" as const,
  reviewState: { deployed: flow === "deployment" ? false : deployed, nonce: "0x5" },
  submitState: { deployed, nonce: "0x5" },
});

const isDeployOnlyEstimate = (method: string, params: Record<string, unknown> | undefined) =>
  method === "starknet_estimateFee" &&
  (params?.["request"] as readonly { readonly type: string }[] | undefined)
    ?.map((tx) => tx.type)
    .join() === "DEPLOY_ACCOUNT";

const FAILURES: readonly (readonly [string, ScenarioSpec, Injection])[] = [
  [
    "preparationUnavailable",
    spec("f", true),
    (m) => (m === "starknet_getClassHashAt" ? "transport" : undefined),
  ],
  [
    "wrongChain",
    spec("f", true),
    (m) => (m === "starknet_chainId" ? { result: "0x534e5f4d41494e" } : undefined),
  ],
  [
    "indeterminate",
    spec("f", true),
    (m) => (m === "starknet_addInvokeTransaction" ? "transport" : undefined),
  ],
  [
    "hashMismatch",
    spec("f", true),
    (m) =>
      m === "starknet_addInvokeTransaction" ? { result: { transaction_hash: "0x1" } } : undefined,
  ],
  [
    "unrecognisedUnit",
    spec("f", true),
    (m) =>
      m === "starknet_estimateFee" ? { result: [{ ...INVOKE_ESTIMATE, unit: "STRK" }] } : undefined,
  ],
  [
    "deploymentStatusUnknown",
    spec("f", false),
    (m, p) => (isDeployOnlyEstimate(m, p) ? "transport" : undefined),
  ],
  [
    "autoDeploymentFailed",
    spec("f", false),
    (m, p) =>
      isDeployOnlyEstimate(m, p)
        ? { error: { code: 41, message: "Transaction execution error" } }
        : undefined,
  ],
  [
    "deploymentUnconfirmed",
    spec("f", false),
    (m) => (m === "starknet_getTransactionStatus" ? "transport" : undefined),
  ],
  [
    "deploymentThenInvokeUnconfirmed",
    spec("f", false),
    (m) => (m === "starknet_addInvokeTransaction" ? "transport" : undefined),
  ],
  ["alreadyDeployed", spec("f", true, "deployment"), () => undefined],
];

/**
 * The extension's own refusal text for each failure the mobile plan reports, produced by
 * injecting the fault into the recorded transport and reading the error the real path throws.
 * A transaction hash inside a message is replaced by `{hash}`.
 */
export const captureFailureCopy = async (): Promise<Readonly<Record<string, string>>> => {
  const copy: Record<string, string> = {};
  for (const [code, scenario, inject] of FAILURES) {
    try {
      await captureScenario(scenario, inject);
      throw new Error(`${code}: the extension path did not fail`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      copy[code] = message.replace(/0x[0-9a-f]{50,64}/g, "{hash}");
    }
  }
  return copy;
};
