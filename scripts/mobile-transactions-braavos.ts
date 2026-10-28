/**
 * Wire capture for Braavos sends and deployments on mobile. Runs the extension's real send path
 * (`estimateInvokeFee`, `estimateAccountDeploymentFee`, `submitErc20Transfer`,
 * `submitAccountDeployment`) for the Braavos account at index 0 of the published E2E phrase,
 * against the recording JSON-RPC transport of `./mobile-transactions-capture`, and records every
 * request in order with its reply, every hash the extension signed, and the signature array each
 * write carried. Nothing reaches a network.
 *
 * What differs from OpenZeppelin, and so what this pins: a deployed account's live class and
 * signers are read at one accepted block (`get_signers`, and `get_deferred_remove_signers` plus
 * the block's timestamp only when a 2FA signer exists); the modern deployment class deploys with
 * the public key as salt and sole constructor argument; and a deployment carries the extended
 * authorization `[r, s, ...params, aux_r, aux_s]`, the parameters' poseidon hash signed before
 * the transaction hash, with its estimate signed for real over the query-version hash. An
 * undeployed account is refused for anything but its own deployment, and the extension's other
 * refusals (a foreign first signer, an active 2FA signer, an unknown live class, the base class)
 * are captured as the text it throws.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import {
  estimateAccountDeploymentFee,
  estimateInvokeFee,
  submitAccountDeployment,
  submitErc20Transfer,
} from "@bramble/starknet/rpc";
import { deriveAccount } from "@bramble/vault/accounts";
import {
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { hash } from "starknet";
import {
  type CapturedExchange,
  type CapturedSignature,
  CONTRACT_NOT_FOUND,
  type MobileNetworkId,
  PLACEHOLDER_URLS,
  providerFactory,
  type Recorder,
  reply,
  STRK,
  TRANSACTION_AMOUNT,
  TRANSACTION_MNEMONIC,
} from "./mobile-transactions-capture";

/** The accepted block every Braavos compatibility read is pinned to. */
const ACCEPTED_BLOCK = { block_hash: "0xb7aa05", block_number: 812_345 };
/** The accepted block's timestamp, against which a deferred 2FA removal is judged. */
const BLOCK_TIMESTAMP = 1_760_000_000;

/** Chain state behind one Braavos account. */
type BraavosNode = {
  readonly deployed: boolean;
  readonly nonce: string;
  /** The class the account runs; absent means the current implementation. */
  readonly liveClass?: string;
  /** Stark signers the account reports; absent means the wallet's key alone. */
  readonly stark?: readonly string[];
  /** Number of secp256r1 (2FA) signers. */
  readonly strong?: number;
  /** `get_deferred_remove_signers`' expiry; 0 means no removal requested. */
  readonly expireAt?: number;
};

/** One Braavos scenario: which class the record names, and the node around it. */
export type BraavosScenarioSpec = {
  readonly name: string;
  readonly networkId: MobileNetworkId;
  readonly recordClass: string;
  readonly flow: "deployment" | "transfer";
  readonly reviewState: BraavosNode;
  readonly submitState: BraavosNode;
};

/** The recorded traffic, hashes and signature arrays of one Braavos scenario. */
export type CapturedBraavosScenario = BraavosScenarioSpec & {
  readonly account: { readonly address: string; readonly publicKey: string };
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
  readonly reviewedFee: unknown;
  readonly reviewedDeploymentFee: unknown;
  readonly reviewInvoke: readonly CapturedExchange[];
  readonly reviewDeployment: readonly CapturedExchange[];
  readonly submit: readonly CapturedExchange[];
  /** Every hash signed, in order: estimates and parameters included, not only writes. */
  readonly signed: readonly CapturedSignature[];
  /** The signature array each write carried, in write order. */
  readonly writeSignatures: readonly (readonly string[])[];
  readonly transactionHash: string;
};

const SELECTORS = new Map(
  ["get_signers", "get_deferred_remove_signers"].map((name) => [
    BigInt(hash.getSelectorFromName(name)),
    name,
  ]),
);

// The Braavos view of the chain: the live class and signer state at the accepted block. Every
// other method is the shared canned node's reply.
const braavosReply =
  (spec: () => BraavosNode, publicKey: string): typeof reply =>
  (recorder, method, params, account, chainId) => {
    const node = spec();
    const deployedNow = node.deployed || recorder.events.has("deployWritten");
    switch (method) {
      case "starknet_blockHashAndNumber":
        return { result: ACCEPTED_BLOCK };
      case "starknet_getBlockWithTxHashes":
        return { result: { ...ACCEPTED_BLOCK, timestamp: BLOCK_TIMESTAMP, transactions: [] } };
      case "starknet_getClassHashAt":
        return deployedNow
          ? { result: node.liveClass ?? BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH }
          : { error: CONTRACT_NOT_FOUND };
      case "starknet_call": {
        if (!deployedNow) return { error: CONTRACT_NOT_FOUND };
        const request = (params?.["request"] ?? {}) as { readonly entry_point_selector?: string };
        const name = SELECTORS.get(BigInt(request.entry_point_selector ?? "0x0"));
        if (name === "get_signers") {
          const stark = node.stark ?? [publicKey];
          const strong = Array.from({ length: node.strong ?? 0 }, () => [
            "0x7",
            "0x8",
            "0x9",
            "0xa",
          ]);
          return {
            result: [
              `0x${stark.length.toString(16)}`,
              ...stark,
              `0x${(strong.length * 4).toString(16)}`,
              ...strong.flat(),
              "0x0",
            ],
          };
        }
        if (name === "get_deferred_remove_signers") {
          return { result: [`0x${(node.expireAt ?? 0).toString(16)}`, "0x0", "0x0"] };
        }
        return { error: { code: 21, message: "Invalid message selector" } };
      }
      default:
        return reply(recorder, method, params, account, chainId);
    }
  };

const writeSignature = (exchange: CapturedExchange): readonly string[] => {
  const params = exchange.params as Record<string, { readonly signature: readonly string[] }>;
  const tx = Object.values(params)[0];
  if (!tx) throw new Error("write without a transaction");
  return tx.signature;
};

// The account, recorder and provider one scenario runs against.
const setUp = async (spec: BraavosScenarioSpec) => {
  resetRpcEndpointCooldownsForTests();
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const sender = await deriveAccount(kms, {
    accountContractType: "braavos",
    accountIndex: 0,
    classHash: spec.recordClass,
    mnemonic: TRANSACTION_MNEMONIC,
    networkId: spec.networkId,
  });
  const recipient = (
    await deriveAccount(kms, {
      accountContractType: "openzeppelin",
      accountIndex: 1,
      mnemonic: TRANSACTION_MNEMONIC,
      networkId: spec.networkId,
    })
  ).account.address;
  const account = sender.account as DerivedAccountRef;
  if (account.accountContractType !== "braavos") throw new Error("not a Braavos record");
  const recorder: Recorder = {
    events: new Set(),
    exchanges: [],
    signatures: [],
    state: spec.reviewState,
  };
  const node = { current: spec.reviewState };
  const makeProvider = providerFactory(
    recorder,
    account,
    STARKNET_NETWORKS[spec.networkId].chainId,
    braavosReply(() => node.current, account.publicKeyX),
  );
  const signHash = async (messageHash: string) => {
    const signature = await kms.signStarkHash(sender.privateKey, messageHash);
    recorder.signatures.push({ hash: messageHash, r: signature.r, s: signature.s });
    return signature;
  };
  const token = STRK(spec.networkId);
  const call = {
    calldata: [recipient, "1500000000000000000", "0"],
    contractAddress: token.address,
    entrypoint: "transfer",
  };
  return {
    account,
    call,
    input: { account, rpcUrls: PLACEHOLDER_URLS, signHash },
    makeProvider,
    node,
    recipient,
    recorder,
    take: (): CapturedExchange[] => recorder.exchanges.splice(0),
    token,
  };
};

/**
 * Runs one Braavos scenario through the extension's real send path. Deterministic: canned
 * replies and RFC-6979 signatures give identical output on every run.
 */
export const captureBraavosScenario = async (
  spec: BraavosScenarioSpec,
): Promise<CapturedBraavosScenario> => {
  const { account, call, input, makeProvider, node, recipient, recorder, take, token } =
    await setUp(spec);
  const reviewedFee =
    spec.flow === "transfer"
      ? await estimateInvokeFee({ ...input, calls: [call] }, makeProvider)
      : null;
  const reviewInvoke = take();
  const reviewedDeploymentFee =
    spec.flow === "deployment" ? await estimateAccountDeploymentFee(input, makeProvider) : null;
  const reviewDeployment = take();

  node.current = spec.submitState;
  recorder.state = spec.submitState;
  recorder.events.clear();
  const submitted =
    spec.flow === "transfer"
      ? await submitErc20Transfer(
          {
            ...input,
            amount: TRANSACTION_AMOUNT,
            recipient,
            ...(reviewedFee ? { reviewedFee } : {}),
            token,
          },
          makeProvider,
        )
      : await submitAccountDeployment(
          { ...input, ...(reviewedDeploymentFee ? { reviewedFee: reviewedDeploymentFee } : {}) },
          makeProvider,
        );
  const submit = take();
  return {
    ...spec,
    account: { address: account.address, publicKey: account.publicKeyX },
    amount: TRANSACTION_AMOUNT,
    recipient,
    reviewDeployment,
    reviewedDeploymentFee,
    reviewedFee,
    reviewInvoke,
    signed: recorder.signatures,
    submit,
    token: token.address,
    transactionHash: submitted.transactionHash,
    writeSignatures: submit
      .filter((exchange) => exchange.method.startsWith("starknet_add"))
      .map(writeSignature),
  };
};

const deployed = (extra: Partial<BraavosNode> = {}): BraavosNode => ({
  deployed: true,
  nonce: "0x5",
  ...extra,
});
const undeployed: BraavosNode = { deployed: false, nonce: "0x0" };

/** Every Braavos scenario the mobile plan is pinned against. */
export const BRAAVOS_SCENARIOS: readonly BraavosScenarioSpec[] = (
  ["SN_SEPOLIA", "SN_MAIN"] as const
)
  .flatMap((networkId) => [
    {
      flow: "transfer" as const,
      name: `braavos-deployed-${networkId}`,
      networkId,
      recordClass: BRAAVOS_DEPLOYMENT_CLASS_HASH,
      reviewState: deployed(),
      submitState: deployed(),
    },
    {
      flow: "deployment" as const,
      name: `braavos-standalone-deployment-${networkId}`,
      networkId,
      recordClass: BRAAVOS_DEPLOYMENT_CLASS_HASH,
      reviewState: undeployed,
      submitState: undeployed,
    },
  ])
  .concat([
    {
      flow: "transfer",
      name: "braavos-legacy-implementation-SN_MAIN",
      networkId: "SN_MAIN",
      recordClass: BRAAVOS_BASE_CLASS_HASH,
      reviewState: deployed({ liveClass: BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH }),
      submitState: deployed({ liveClass: BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH }),
    },
    {
      flow: "transfer",
      name: "braavos-2fa-removal-expired-SN_MAIN",
      networkId: "SN_MAIN",
      recordClass: BRAAVOS_DEPLOYMENT_CLASS_HASH,
      reviewState: deployed({ expireAt: BLOCK_TIMESTAMP - 1, strong: 1 }),
      submitState: deployed({ expireAt: BLOCK_TIMESTAMP - 1, strong: 1 }),
    },
  ]);

/** Runs every Braavos scenario. */
export const captureBraavosScenarios = async (): Promise<readonly CapturedBraavosScenario[]> => {
  const scenarios: CapturedBraavosScenario[] = [];
  for (const spec of BRAAVOS_SCENARIOS) {
    scenarios.push(await captureBraavosScenario(spec));
  }
  return scenarios;
};

type RefusalSpec = BraavosScenarioSpec & { readonly code: string };

const refusal = (
  code: string,
  flow: "deployment" | "transfer",
  recordClass: string,
  reviewState: BraavosNode,
  submitState: BraavosNode = reviewState,
): RefusalSpec => ({
  code,
  flow,
  name: `${code}-${flow}-${reviewState === submitState ? "review" : "submit"}`,
  networkId: "SN_MAIN",
  recordClass,
  reviewState,
  submitState,
});

const FOREIGN = "0x1234";

/**
 * The Braavos accounts the extension will not send from or deploy, by the mobile failure code
 * that names each refusal. A `-review` case is refused while the fee is estimated; a `-submit`
 * case passes review and is refused at confirmation because the chain changed in between.
 */
const BRAAVOS_REFUSALS: readonly RefusalSpec[] = [
  refusal("braavosDeployFirst", "transfer", BRAAVOS_DEPLOYMENT_CLASS_HASH, undeployed),
  refusal("braavosNotDeployable", "transfer", BRAAVOS_BASE_CLASS_HASH, undeployed),
  refusal("braavosNotDeployable", "deployment", BRAAVOS_BASE_CLASS_HASH, undeployed),
  refusal(
    "braavosClassUnrecognised",
    "transfer",
    BRAAVOS_DEPLOYMENT_CLASS_HASH,
    deployed({ liveClass: BRAAVOS_DEPLOYMENT_CLASS_HASH }),
  ),
  refusal(
    "braavosOwnerMismatch",
    "transfer",
    BRAAVOS_DEPLOYMENT_CLASS_HASH,
    deployed({ stark: [FOREIGN] }),
  ),
  refusal(
    "braavosOwnerMismatch",
    "transfer",
    BRAAVOS_DEPLOYMENT_CLASS_HASH,
    deployed(),
    deployed({ stark: [FOREIGN] }),
  ),
  refusal(
    "braavosStrongSigner",
    "transfer",
    BRAAVOS_DEPLOYMENT_CLASS_HASH,
    deployed({ strong: 1 }),
  ),
  refusal(
    "braavosStrongSigner",
    "transfer",
    BRAAVOS_DEPLOYMENT_CLASS_HASH,
    deployed(),
    deployed({ expireAt: BLOCK_TIMESTAMP, strong: 1 }),
  ),
];

/** One refusal: what the extension threw, and the traffic up to that point. */
export type CapturedBraavosRefusal = RefusalSpec & {
  /** The review's estimate refusal, or null when the review passed. */
  readonly reviewMessage: string | null;
  readonly reviewInvoke: readonly CapturedExchange[];
  readonly reviewDeployment: readonly CapturedExchange[];
  readonly reviewedFee: unknown;
  /** The confirmation's refusal, or null when the review already refused. */
  readonly submitMessage: string | null;
  readonly submit: readonly CapturedExchange[];
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The extension's refusal for each Braavos account it will not act for, with the traffic up to
 * it. A case the extension no longer refuses is drift and fails the capture.
 */
export const captureBraavosRefusals = async (): Promise<readonly CapturedBraavosRefusal[]> => {
  const out: CapturedBraavosRefusal[] = [];
  for (const spec of BRAAVOS_REFUSALS) {
    const { call, input, makeProvider, node, recipient, recorder, take, token } = await setUp(spec);
    let reviewMessage: string | null = null;
    const estimate =
      spec.flow === "transfer"
        ? estimateInvokeFee({ ...input, calls: [call] }, makeProvider)
        : estimateAccountDeploymentFee(input, makeProvider);
    const reviewedFee = await estimate.catch((error: unknown) => {
      reviewMessage = messageOf(error);
      return null;
    });
    const review = take();
    let submitMessage: string | null = null;
    if (reviewedFee) {
      node.current = spec.submitState;
      recorder.state = spec.submitState;
      recorder.signatures.splice(0);
      submitMessage = await submitErc20Transfer(
        { ...input, amount: TRANSACTION_AMOUNT, recipient, reviewedFee, token },
        makeProvider,
      ).then(() => null, messageOf);
    }
    if ((reviewMessage === null) === (submitMessage === null)) {
      throw new Error(`${spec.name}: expected exactly one refusal`);
    }
    if (recorder.signatures.length > 0) throw new Error(`${spec.name}: signed before refusing`);
    out.push({
      ...spec,
      reviewDeployment: spec.flow === "deployment" ? review : [],
      reviewInvoke: spec.flow === "transfer" ? review : [],
      reviewMessage,
      reviewedFee,
      submit: take(),
      submitMessage,
    });
  }
  return out;
};

/** The extension's text for each Braavos refusal, keyed by mobile failure code. */
export const braavosFailureCopy = (
  refusals: readonly CapturedBraavosRefusal[],
): Readonly<Record<string, string>> => {
  const copy: Record<string, string> = {};
  for (const captured of refusals) {
    const message = captured.submitMessage ?? captured.reviewMessage ?? "";
    if (copy[captured.code] !== undefined && copy[captured.code] !== message) {
      throw new Error(`${captured.code}: two different refusal texts`);
    }
    copy[captured.code] = message;
  }
  return copy;
};
