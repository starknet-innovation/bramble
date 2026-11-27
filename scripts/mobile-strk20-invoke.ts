/**
 * The proof-bearing STRK20 INVOKE (SNIP-36) vectors for wallet-core: the self-paid ("account")
 * route, run through the extension's real code. Each `invoke` case reviews the fee with
 * `estimateInvokeFee` and sends with the production service's `submitPrepared` (shape rule,
 * maturity wait, `submitInvokeTransaction`), against a recording JSON-RPC node with scripted
 * replies; the one `ordinary` case sends the same batch with no proof through
 * `submitInvokeTransaction`, today's plain invoke. Each run yields a `hash` line (the hash the
 * extension handed `signHash`, and every input it depends on, read back from the
 * `starknet_addInvokeTransaction` body) and an `rpc` line (every request body in order, with the
 * reply it got). `refusal` lines run the shape rule's failures; `maturity` lines drive
 * `provingBlock` over scripted block heights.
 *
 * The signer is Krusty over the published E2E phrase (`TRANSACTION_MNEMONIC`), so every hash and
 * signature is public. Proof data and facts are fake felts. Sepolia has no bundled STRK20 routing,
 * so its cases use the mainnet routing record (pool address) on the Sepolia chain id; the hash
 * depends only on the chain id and the calldata.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { DEFAULT_STRK20_NETWORKS, STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { memoryStrk20MaturityStore, type Strk20MaturityRecord } from "@bramble/privacy/maturity";
import { createStrk20MaturityRuntime } from "@bramble/privacy/official-sdk-maturity";
import type { PrivacySdkRuntime } from "@bramble/privacy/official-sdk-runtime";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { createRpcProvider, resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { estimateInvokeFee } from "@bramble/starknet/rpc";
import { submitInvokeTransaction } from "@bramble/starknet/rpc-submit";
import { deriveAccount } from "@bramble/vault/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { Strk20Proof } from "@bramble/wallet-protocol/strk20";
import { type Call, hash, logger, type RpcProvider } from "starknet";
import { bytesHex, labelledStream, withRandomStream } from "./mobile-strk20-primitives";
import { STRK, TRANSACTION_MNEMONIC } from "./mobile-transactions-capture";

logger.setLogLevel("FATAL");

/** Repository-relative path of the committed vectors, one JSON line each. */
export const STRK20_INVOKE_PATH = "mobile/core/tests/fixtures/extension-strk20-invoke.jsonl";

type NetworkId = "SN_MAIN" | "SN_SEPOLIA";
const RPC_URLS = ["https://capture.invalid/rpc"];
const CLOCK_MS = 1_800_000_000_000;
const NONCE = "0x7";
const LATEST_BLOCK = 1_000_000;
const ACCEPTED_BLOCK = 1_000_002;
const config = DEFAULT_STRK20_NETWORKS.SN_MAIN ?? null;
const pool = STRK20_MAINNET_POOL;

// The canned node's FEE_ESTIMATE for one INVOKE (RPC 0.10, hex quantities).
const INVOKE_ESTIMATE = {
  l1_data_gas_consumed: "0x2c0",
  l1_data_gas_price: "0x5a0",
  l1_gas_consumed: "0x0",
  l1_gas_price: "0x2d5c6b1e1ef",
  l2_gas_consumed: "0x5f5e100",
  l2_gas_price: "0xb2d05e00",
  overall_fee: "0x4563918244f40000",
  unit: "FRI",
};

type Exchange = { body: unknown; reply: unknown };
type Node = {
  exchanges: Exchange[];
  signed: { hash: string; r: string; s: string }[];
  blocks: number[];
  chainId: string;
  address: string;
  classHash: string;
};

// The canned node: an OpenZeppelin account at `NONCE`, a pool past maturity, an accepted send.
const answer = (node: Node, method: string): { result: unknown } | { error: unknown } => {
  const last = node.signed.at(-1)?.hash;
  switch (method) {
    case "starknet_chainId":
      return { result: node.chainId };
    case "starknet_getClassHashAt":
      return { result: node.classHash };
    case "starknet_getNonce":
      return { result: NONCE };
    case "starknet_estimateFee":
      return { result: [INVOKE_ESTIMATE] };
    case "starknet_blockNumber": {
      const block = node.blocks.shift();
      return block === undefined
        ? { error: { code: -1, message: "unscripted" } }
        : { result: block };
    }
    case "starknet_addInvokeTransaction":
      return { result: { transaction_hash: last } };
    case "starknet_getTransactionStatus":
      return { result: { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L2" } };
    case "starknet_getTransactionReceipt":
      return {
        result: {
          actual_fee: { amount: "0x1", unit: "FRI" },
          block_hash: "0x1",
          block_number: ACCEPTED_BLOCK,
          events: [],
          execution_resources: { l1_data_gas: 0, l1_gas: 0, l2_gas: 0 },
          execution_status: "SUCCEEDED",
          finality_status: "ACCEPTED_ON_L2",
          messages_sent: [],
          transaction_hash: last,
          type: "INVOKE",
        },
      };
    default:
      return { error: { code: -32601, message: "Method not found" } };
  }
};

const providerFor =
  (node: Node) =>
  (nodeUrl: string): RpcProvider =>
    createRpcProvider(nodeUrl, {
      baseFetch: (async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        const reply = { id: body.id, jsonrpc: "2.0", ...answer(node, body.method) };
        node.exchanges.push({ body, reply });
        return new Response(JSON.stringify(reply), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }) as never,
      transactionRetryIntervalFallback: 1,
    });

// The RPC spells a DA mode `L1`/`L2`; the hash takes its integer.
const daMode = (mode: string) => ({ L1: 0, L2: 1 })[mode] as never;

const errorRecord = (error: unknown) => ({
  class: error instanceof Error ? error.constructor.name : typeof error,
  message: error instanceof Error ? error.message : String(error),
});

/** Runs `work` with `fetch` refused, `Date.now` fixed and `getRandomValues` on a fixed stream. */
const sealed = async <T>(label: string, work: () => Promise<T>) => {
  const saved = { fetch: globalThis.fetch, now: Date.now };
  globalThis.fetch = (() => Promise.reject(new Error("no network"))) as unknown as typeof fetch;
  Date.now = () => CLOCK_MS;
  resetRpcEndpointCooldownsForTests();
  try {
    const drawn = await withRandomStream(labelledStream(label, 1024), work);
    return { random: { bytes: bytesHex(drawn.consumed), reads: drawn.reads }, value: drawn.value };
  } finally {
    globalThis.fetch = saved.fetch;
    Date.now = saved.now;
  }
};

const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const sender = async (networkId: NetworkId) => {
  const derived = await deriveAccount(kms, {
    accountContractType: "openzeppelin",
    accountIndex: 0,
    mnemonic: TRANSACTION_MNEMONIC,
    networkId,
  });
  return { account: derived.account, privateKey: derived.privateKey };
};

const felt = (label: string, index: number): string =>
  `0x${bytesHex(labelledStream(`${label}:${index}`, 31))}`;
const proofWith = (facts: number): Strk20Proof => ({
  data: Buffer.from(labelledStream("strk20-invoke-proof-data", 192)).toString("base64"),
  output: Array.from({ length: 4 }, (_, i) => felt("strk20-invoke-proof-output", i)),
  // The ninth fact is zero-padded to 64 digits, as a prover may spell it; the body canonicalises it.
  proof_facts: Array.from({ length: facts }, (_, i) =>
    i === 8
      ? `0x${felt("strk20-invoke-proof-fact", i).slice(2).padStart(64, "0")}`
      : felt("strk20-invoke-proof-fact", i),
  ),
});
const applyActions = (contractAddress = pool): Call => ({
  calldata: ["0x2", felt("apply-actions", 0), felt("apply-actions", 1), "0x0"],
  contractAddress,
  entrypoint: "apply_actions",
});
const approve = (networkId: NetworkId): Call => ({
  calldata: [pool, "0xde0b6b3a7640000", "0x0"],
  contractAddress: STRK(networkId).address,
  entrypoint: "approve",
});

type InvokeCase = {
  readonly id: string;
  readonly networkId: NetworkId;
  readonly calls: (networkId: NetworkId) => Call[];
  readonly proof: Strk20Proof | null;
};
const both = (n: NetworkId) => [approve(n), applyActions()];
const alone = () => [applyActions()];
// [id, network, calls, proof facts (0: no proof, today's ordinary invoke)]
const INVOKE_CASES: readonly InvokeCase[] = (
  [
    ["ordinary-approve-apply-main", "SN_MAIN", both, 0],
    ["proof-1-approve-apply-main", "SN_MAIN", both, 1],
    ["proof-9-approve-apply-main", "SN_MAIN", both, 9],
    ["proof-9-apply-main", "SN_MAIN", alone, 9],
    ["ordinary-apply-sepolia", "SN_SEPOLIA", alone, 0],
    ["proof-1-apply-sepolia", "SN_SEPOLIA", alone, 1],
    ["proof-9-approve-apply-sepolia", "SN_SEPOLIA", both, 9],
  ] as const
).map(([id, networkId, calls, facts]) => ({
  calls,
  id,
  networkId,
  proof: facts === 0 ? null : proofWith(facts),
}));

const service = (node: Node) => {
  const makeProvider = providerFor(node);
  return createOfficialStrk20Service({
    maturityStore: memoryStrk20MaturityStore(),
    pauseForMaturity: async () => undefined,
    providerFor: makeProvider,
    // `submitPrepared` never reaches the SDK; no bundle is loaded.
    sdk: {} as PrivacySdkRuntime,
    submitInvoke: (input) => submitInvokeTransaction(input, makeProvider),
  });
};

/** One send: the fee review, then the submission, through the extension's own functions. */
const runInvoke = async (spec: InvokeCase) => {
  const { account, privateKey } = await sender(spec.networkId);
  const chainId = STARKNET_NETWORKS[spec.networkId].chainId;
  const node: Node = {
    address: account.address,
    blocks: [LATEST_BLOCK],
    chainId,
    classHash: account.classHash,
    exchanges: [],
    signed: [],
  };
  const signHash = async (messageHash: string) => {
    const signature = await kms.signStarkHash(privateKey, messageHash);
    node.signed.push({ hash: messageHash, r: signature.r, s: signature.s });
    return signature;
  };
  const calls = spec.calls(spec.networkId);
  const proof = spec.proof ?? undefined;
  const run = await sealed(`strk20-invoke-${spec.id}`, async () => {
    const reviewedFee = await estimateInvokeFee(
      { account, calls, ...(proof ? { proof } : {}), rpcUrls: RPC_URLS, signHash },
      providerFor(node),
    );
    const review = node.exchanges.splice(0);
    const submitted = proof
      ? await service(node).submitPrepared({
          account,
          calls,
          config,
          isAuthorized: () => true,
          proof,
          reviewedFee,
          rpcUrls: RPC_URLS,
          signHash,
          viewingKey: () => Promise.reject(new Error("unused")),
        })
      : await submitInvokeTransaction(
          { account, calls, reviewedFee, rpcUrls: RPC_URLS, signHash },
          providerFor(node),
        );
    return { review, reviewedFee, submit: node.exchanges.splice(0), submitted };
  });
  const { review, reviewedFee, submit, submitted } = run.value;
  const sent = submit.find(
    (exchange) => (exchange.body as { method: string }).method === "starknet_addInvokeTransaction",
  )?.body as { params: { invoke_transaction: Record<string, unknown> } } | undefined;
  const tx = sent?.params.invoke_transaction;
  if (!tx) throw new Error(`${spec.id}: no addInvokeTransaction`);
  const signedHash = node.signed.at(-1)?.hash;
  if (!signedHash || signedHash !== submitted.transactionHash) {
    throw new Error(`${spec.id}: the signed hash is not the accepted one`);
  }
  const bounds = tx["resource_bounds"] as Record<
    string,
    { max_amount: string; max_price_per_unit: string }
  >;
  const hashInputs = {
    senderAddress: tx["sender_address"] as string,
    version: tx["version"] as string,
    compiledCalldata: tx["calldata"] as string[],
    chainId,
    nonce: tx["nonce"] as string,
    resourceBounds: bounds,
    tip: tx["tip"] as string,
    paymasterData: tx["paymaster_data"] as string[],
    accountDeploymentData: tx["account_deployment_data"] as string[],
    nonceDataAvailabilityMode: tx["nonce_data_availability_mode"] as string,
    feeDataAvailabilityMode: tx["fee_data_availability_mode"] as string,
    proofFacts: (tx["proof_facts"] as string[] | undefined) ?? null,
  };
  // Cross-check only: the recorded inputs alone must give the hash the extension signed.
  const check = hash.calculateInvokeTransactionHash({
    accountDeploymentData: hashInputs.accountDeploymentData,
    chainId: chainId as never,
    compiledCalldata: hashInputs.compiledCalldata,
    feeDataAvailabilityMode: daMode(hashInputs.feeDataAvailabilityMode),
    nonce: hashInputs.nonce,
    nonceDataAvailabilityMode: daMode(hashInputs.nonceDataAvailabilityMode),
    paymasterData: hashInputs.paymasterData,
    ...(hashInputs.proofFacts ? { proofFacts: hashInputs.proofFacts } : {}),
    resourceBounds: Object.fromEntries(
      Object.entries(bounds).map(([key, value]) => [
        key,
        {
          max_amount: BigInt(value.max_amount),
          max_price_per_unit: BigInt(value.max_price_per_unit),
        },
      ]),
    ) as never,
    senderAddress: hashInputs.senderAddress,
    tip: hashInputs.tip,
    version: hashInputs.version as never,
  });
  if (BigInt(check) !== BigInt(signedHash)) {
    throw new Error(
      `${spec.id}: recorded inputs give ${check}, the extension signed ${signedHash}`,
    );
  }
  const route = proof ? "submitPrepared" : "submitInvokeTransaction";
  return [
    {
      kind: "hash",
      id: spec.id,
      source: `extension:${route}`,
      networkId: spec.networkId,
      calls,
      proof: spec.proof,
      inputs: hashInputs,
      hash: signedHash,
      signature: node.signed.at(-1),
      accountPublicKey: (await kms.signStarkHash(privateKey, "0x1")).publicKey,
    },
    {
      kind: "rpc",
      id: spec.id,
      source: `extension:estimateInvokeFee+${route}`,
      networkId: spec.networkId,
      rpcUrls: RPC_URLS,
      calls,
      proof: spec.proof,
      reviewedFee,
      review,
      submit,
      transactionHash: submitted.transactionHash,
      random: run.random,
    },
  ];
};

type RefusalCase = { id: string; calls: (n: NetworkId) => Call[]; proof: Strk20Proof };
const one = proofWith(1);
const REFUSALS: readonly RefusalCase[] = (
  [
    ["empty-proof-data", both, { ...one, data: "" }],
    ["empty-output", both, { ...one, output: [] }],
    ["empty-proof-facts", both, proofWith(0)],
    ["apply-actions-not-last", (n: NetworkId) => [applyActions(), approve(n)], one],
    [
      "non-approve-before",
      (n: NetworkId) => [{ ...approve(n), entrypoint: "transfer" }, applyActions()],
      one,
    ],
    ["two-apply-actions", () => [applyActions(), applyActions()], one],
    ["apply-actions-wrong-contract", () => [applyActions("0xc0ffee")], one],
    ["no-calls", () => [], one],
  ] as const
).map(([id, calls, proof]) => ({ calls, id, proof }));

const runRefusal = async (spec: RefusalCase) => {
  const { account } = await sender("SN_MAIN");
  const node: Node = {
    address: account.address,
    blocks: [],
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    classHash: account.classHash,
    exchanges: [],
    signed: [],
  };
  const calls = spec.calls("SN_MAIN");
  let outcome: unknown;
  await sealed(`strk20-invoke-refusal-${spec.id}`, async () => {
    try {
      await service(node).submitPrepared({
        account,
        calls,
        config,
        isAuthorized: () => true,
        proof: spec.proof,
        rpcUrls: RPC_URLS,
        signHash: () => Promise.reject(new Error("refusal must not sign")),
        viewingKey: () => Promise.reject(new Error("unused")),
      });
      outcome = { result: "submitted" };
    } catch (error) {
      outcome = { error: errorRecord(error) };
    }
  });
  return {
    kind: "refusal",
    id: spec.id,
    source: "extension:submitPrepared",
    pool: config?.poolAddress ?? null,
    calls,
    proof: spec.proof,
    outcome,
    requests: node.exchanges,
  };
};

type MaturityCase = {
  id: string;
  prior: Strk20MaturityRecord | null;
  blocks: number[];
};
const PRIOR_HASH = "0x5afe5afe";
const MATURITY: readonly MaturityCase[] = [
  { blocks: [LATEST_BLOCK], id: "no-prior-write", prior: null },
  { blocks: [5], id: "young-chain", prior: null },
  {
    // A candidate equal to the prior block is not past it: 1_000_013 waits, 1_000_014 proceeds.
    blocks: [1_000_005, 1_000_013, 1_000_014],
    id: "prior-accepted-waits",
    prior: { acceptedBlock: 1_000_003, state: "submitted", transactionHash: PRIOR_HASH },
  },
  {
    // `MAX_MATURITY_POLLS` is 120: 121 reads, 120 pauses, then the refusal.
    blocks: Array.from({ length: 121 }, () => 1_000_005),
    id: "poll-cap",
    prior: { acceptedBlock: 1_000_003, state: "submitted", transactionHash: PRIOR_HASH },
  },
  {
    blocks: [1_000_012, 1_000_013],
    id: "prior-submitted-reads-receipt",
    prior: { state: "submitted", transactionHash: PRIOR_HASH },
  },
];

const runMaturity = async (spec: MaturityCase) => {
  const { account } = await sender("SN_MAIN");
  const node: Node = {
    address: account.address,
    blocks: [...spec.blocks],
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    classHash: account.classHash,
    exchanges: [],
    signed: [{ hash: PRIOR_HASH, r: "0x0", s: "0x0" }],
  };
  const store = memoryStrk20MaturityStore();
  const scope = { accountId: account.id, networkId: account.networkId, poolAddress: pool };
  if (spec.prior) await store.write(scope, spec.prior);
  const pauses: number[] = [];
  const runtime = createStrk20MaturityRuntime({
    pause: async () => {
      pauses.push(node.exchanges.length);
    },
    store,
  });
  let outcome: unknown;
  await sealed(`strk20-invoke-maturity-${spec.id}`, async () => {
    try {
      outcome = {
        provingBlock: await runtime.provingBlock(providerFor(node)(RPC_URLS[0] ?? ""), scope),
      };
    } catch (error) {
      outcome = { error: errorRecord(error) };
    }
  });
  if (node.blocks.length > 0) throw new Error(`${spec.id}: unused block replies`);
  return {
    kind: "maturity",
    id: spec.id,
    source: "extension:createStrk20MaturityRuntime.provingBlock",
    provingBlockDepth: 10,
    prior: spec.prior,
    requests: node.exchanges,
    // Each pause, as the number of requests made before it.
    pausesAfterRequest: pauses,
    stored: await store.read(scope),
    outcome,
  };
};

/** Every vector, one compact JSON line each. */
export const renderStrk20Invoke = async (): Promise<string> => {
  const lines: unknown[] = [];
  for (const spec of INVOKE_CASES) lines.push(...(await runInvoke(spec)));
  for (const spec of REFUSALS) lines.push(await runRefusal(spec));
  for (const spec of MATURITY) lines.push(await runMaturity(spec));
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
};
