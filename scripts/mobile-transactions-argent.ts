/**
 * Wire capture for Ready (Argent) sends on mobile. Runs the extension's real send path
 * (`estimateInvokeFee`, `estimateAccountDeploymentFee`, `submitErc20Transfer`,
 * `submitAccountDeployment`) for Argent accounts derived from the published E2E phrase, against
 * the same recording JSON-RPC transport as `./mobile-transactions-capture`, and records every
 * request in order with its reply, every hash the extension signed, and the signature array it
 * put on the wire. Nothing reaches a network.
 *
 * What differs from OpenZeppelin, and so what this pins: the account's live class and signer
 * are read at one accepted block (`starknet_blockHashAndNumber`, `get_owner`, `get_owner_type`,
 * `get_guardian`); estimates validate with the shape-correct query signature instead of
 * `SKIP_VALIDATE`; the signature is Argent 0.4's signer array; and deployment uses the 0.4
 * constructor and the record's own salt. Each Argent deployment class is covered: a 0.4.0
 * record deploys and sends, and 0.3.x records send once upgraded to 0.4.0. The extension's
 * refusals (an un-upgraded 0.3.x class, a 0.3.x record that is not deployed, a foreign owner,
 * a guardian) are captured as the text it throws.
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
import { ACCOUNT_CLASSES, ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
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

/** The accepted block every Argent compatibility read is pinned to. */
const ACCEPTED_BLOCK = { block_hash: "0x5ea1ed0b10c4", block_number: 812_345 };

/** Chain state behind one Argent account. */
type ArgentNode = {
  readonly deployed: boolean;
  readonly nonce: string;
  /** The class the account runs; `null` means the record's own class. */
  readonly liveClass?: string;
  /** Owner public key the account reports; `null` means the wallet's signer. */
  readonly owner?: string;
  readonly ownerType?: string;
  readonly guardian?: string;
};

/** One Ready scenario: which deployment class the record names, and the node around it. */
export type ArgentScenarioSpec = {
  readonly name: string;
  readonly networkId: MobileNetworkId;
  /** Label of the record's deployment class in `ACCOUNT_CLASSES` (e.g. "argent 0.3.1"). */
  readonly recordClass: string;
  readonly flow: "deployment" | "transfer";
  readonly reviewState: ArgentNode;
  readonly submitState: ArgentNode;
};

/** The recorded traffic, hashes and signature arrays of one Ready scenario. */
export type CapturedArgentScenario = ArgentScenarioSpec & {
  readonly account: {
    readonly address: string;
    readonly classHash: string;
    readonly deploymentSalt: string;
    readonly publicKey: string;
  };
  readonly amount: string;
  readonly call: { readonly calldata: readonly string[]; readonly contractAddress: string };
  readonly recipient: string;
  readonly token: string;
  readonly reviewedFee: unknown;
  readonly reviewedDeploymentFee: unknown;
  readonly reviewInvoke: readonly CapturedExchange[];
  readonly reviewDeployment: readonly CapturedExchange[];
  readonly submit: readonly CapturedExchange[];
  /** Each signed hash with the Stark signature and the full array the transaction carried. */
  readonly signatures: readonly (CapturedSignature & { readonly array: readonly string[] })[];
  readonly transactionHash: string;
};

const classHashFor = (label: string): string => {
  const entry = ACCOUNT_CLASSES.find((candidate) => candidate.label === label);
  if (!entry) throw new Error(`no class ${label}`);
  return entry.classHash;
};

const SELECTORS = new Map(
  ["get_owner", "get_owner_type", "get_guardian"].map((name) => [
    BigInt(hash.getSelectorFromName(name)),
    name,
  ]),
);

// The Argent view of the chain: the live class and signer state at the accepted block. Every
// other method is the shared canned node's reply.
const argentReply =
  (spec: () => ArgentNode, publicKey: string): typeof reply =>
  (recorder, method, params, account, chainId) => {
    const node = spec();
    const deployedNow = node.deployed || recorder.events.has("deployWritten");
    switch (method) {
      case "starknet_blockHashAndNumber":
        return { result: ACCEPTED_BLOCK };
      case "starknet_getClassHashAt":
        return deployedNow
          ? { result: node.liveClass ?? account.classHash }
          : { error: CONTRACT_NOT_FOUND };
      case "starknet_call": {
        if (!deployedNow) return { error: CONTRACT_NOT_FOUND };
        const request = (params?.["request"] ?? {}) as { readonly entry_point_selector?: string };
        const name = SELECTORS.get(BigInt(request.entry_point_selector ?? "0x0"));
        if (name === "get_owner") return { result: [node.owner ?? publicKey] };
        if (name === "get_owner_type") return { result: [node.ownerType ?? "0x0"] };
        if (name === "get_guardian") return { result: [node.guardian ?? "0x0"] };
        return { error: { code: 21, message: "Invalid message selector" } };
      }
      default:
        return reply(recorder, method, params, account, chainId);
    }
  };

const signatureArray = (exchange: CapturedExchange): readonly string[] => {
  const params = exchange.params as Record<string, { readonly signature: readonly string[] }>;
  const tx = Object.values(params)[0];
  if (!tx) throw new Error("write without a transaction");
  return tx.signature;
};

// The account, recorder and provider one scenario runs against.
const setUp = async (spec: ArgentScenarioSpec) => {
  resetRpcEndpointCooldownsForTests();
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const sender = await deriveAccount(kms, {
    accountContractType: "argent",
    accountIndex: 0,
    classHash: classHashFor(spec.recordClass),
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
  if (account.accountContractType !== "argent") throw new Error("not an Argent record");
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
    argentReply(() => node.current, account.publicKeyX),
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
 * Runs one Ready scenario through the extension's real send path. Deterministic: canned
 * replies and RFC-6979 signatures give identical output on every run.
 */
export const captureArgentScenario = async (
  spec: ArgentScenarioSpec,
): Promise<CapturedArgentScenario> => {
  const { account, call, input, makeProvider, node, recipient, recorder, take, token } =
    await setUp(spec);
  const reviewedFee =
    spec.flow === "transfer"
      ? await estimateInvokeFee({ ...input, calls: [call] }, makeProvider)
      : null;
  const reviewInvoke = take();
  const reviewedDeploymentFee = spec.reviewState.deployed
    ? null
    : await estimateAccountDeploymentFee(input, makeProvider);
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
            ...(reviewedDeploymentFee ? { reviewedDeploymentFee } : {}),
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
  const writes = submit.filter((exchange) => exchange.method.startsWith("starknet_add"));
  if (writes.length !== recorder.signatures.length) {
    throw new Error(
      `${spec.name}: ${writes.length} writes for ${recorder.signatures.length} hashes`,
    );
  }
  return {
    ...spec,
    account: {
      address: account.address,
      classHash: account.classHash,
      deploymentSalt: account.deploymentSalt,
      publicKey: account.publicKeyX,
    },
    amount: TRANSACTION_AMOUNT,
    call: { calldata: call.calldata, contractAddress: call.contractAddress },
    recipient,
    reviewDeployment,
    reviewedDeploymentFee,
    reviewedFee,
    reviewInvoke,
    signatures: recorder.signatures.map((signature, index) => ({
      ...signature,
      array: signatureArray(writes[index] as CapturedExchange),
    })),
    submit,
    token: token.address,
    transactionHash: submitted.transactionHash,
  };
};

const deployed = (extra: Partial<ArgentNode> = {}): ArgentNode => ({
  deployed: true,
  nonce: "0x5",
  ...extra,
});
const undeployed: ArgentNode = { deployed: false, nonce: "0x0" };
const upgraded = deployed({ liveClass: ARGENT_ACCOUNT_CLASS_HASH });

/** Every Ready scenario the mobile plan is pinned against. */
export const ARGENT_SCENARIOS: readonly ArgentScenarioSpec[] = [
  ...(["SN_SEPOLIA", "SN_MAIN"] as const).flatMap((networkId) => [
    {
      flow: "transfer" as const,
      name: `argent-0.4.0-deployed-${networkId}`,
      networkId,
      recordClass: "argent 0.4.0",
      reviewState: deployed(),
      submitState: deployed(),
    },
    {
      flow: "transfer" as const,
      name: `argent-0.4.0-undeployed-${networkId}`,
      networkId,
      recordClass: "argent 0.4.0",
      reviewState: undeployed,
      submitState: undeployed,
    },
  ]),
  {
    flow: "deployment",
    name: "argent-0.4.0-standalone-deployment-SN_SEPOLIA",
    networkId: "SN_SEPOLIA",
    recordClass: "argent 0.4.0",
    reviewState: undeployed,
    submitState: undeployed,
  },
  ...["argent 0.3.1", "argent 0.3.0"].map((recordClass) => ({
    flow: "transfer" as const,
    name: `${recordClass.replace(" ", "-")}-upgraded-SN_MAIN`,
    networkId: "SN_MAIN" as const,
    recordClass,
    reviewState: upgraded,
    submitState: upgraded,
  })),
];

/** Runs every Ready scenario. */
export const captureArgentScenarios = async (): Promise<readonly CapturedArgentScenario[]> => {
  const scenarios: CapturedArgentScenario[] = [];
  for (const spec of ARGENT_SCENARIOS) {
    scenarios.push(await captureArgentScenario(spec));
  }
  return scenarios;
};

const refusal = (
  code: string,
  recordClass: string,
  reviewState: ArgentNode,
  submitState: ArgentNode = reviewState,
): ArgentScenarioSpec & { readonly code: string } => ({
  code,
  flow: "transfer",
  name: `${code}-${reviewState === submitState ? "review" : "submit"}`,
  networkId: "SN_MAIN",
  recordClass,
  reviewState,
  submitState,
});

const liveClass = (label: string) => deployed({ liveClass: classHashFor(label) });

/**
 * The Ready accounts the extension will not send from, by the mobile failure code that names
 * each refusal. A `-review` case is refused while the transfer is reviewed (the side panel shows
 * a failed fee estimate, which blocks confirmation); a `-submit` case passes review and is
 * refused at confirmation because the chain changed in between.
 */
const ARGENT_REFUSALS = [
  refusal("accountClassUnsupported", "argent 0.3.1", deployed()),
  refusal("accountClassUnsupported", "argent 0.4.0", deployed(), liveClass("argent 0.3.1")),
  refusal(
    "accountClassUnrecognised",
    "argent 0.4.0",
    deployed(),
    deployed({ liveClass: "0x1234" }),
  ),
  refusal("accountNotDeployable", "argent 0.3.1", undeployed),
  refusal("accountNotDeployable", "argent 0.3.1", upgraded, undeployed),
  refusal("accountOwnerMismatch", "argent 0.4.0", deployed({ owner: "0x1234" })),
  refusal("accountOwnerMismatch", "argent 0.4.0", deployed(), deployed({ owner: "0x1234" })),
  refusal(
    "accountOwnerTypeUnsupported",
    "argent 0.4.0",
    deployed(),
    deployed({ ownerType: "0x1" }),
  ),
  refusal(
    "accountGuardianUnsupported",
    "argent 0.4.0",
    deployed(),
    deployed({ guardian: "0x1234" }),
  ),
];

/** One refusal: what the extension threw, and the traffic up to that point. */
export type CapturedArgentRefusal = {
  readonly code: string;
  readonly name: string;
  readonly networkId: MobileNetworkId;
  readonly recordClass: string;
  readonly reviewState: ArgentNode;
  readonly submitState: ArgentNode;
  /** The review's invoke estimate refusal, or null when the review passed. */
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
 * The extension's refusal for each Ready account it will not send from, with the traffic up to
 * it. A case the extension no longer refuses is drift and fails the capture.
 */
export const captureArgentRefusals = async (): Promise<readonly CapturedArgentRefusal[]> => {
  const out: CapturedArgentRefusal[] = [];
  for (const spec of ARGENT_REFUSALS) {
    const { call, input, makeProvider, node, recipient, recorder, take, token } = await setUp(spec);
    let reviewMessage: string | null = null;
    const reviewedFee = await estimateInvokeFee({ ...input, calls: [call] }, makeProvider).catch(
      (error: unknown) => {
        reviewMessage = messageOf(error);
        return null;
      },
    );
    const reviewInvoke = take();
    if (!spec.reviewState.deployed) {
      await estimateAccountDeploymentFee(input, makeProvider).catch(() => null);
    }
    const reviewDeployment = take();
    let submitMessage: string | null = null;
    if (reviewedFee) {
      node.current = spec.submitState;
      recorder.state = spec.submitState;
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
      code: spec.code,
      name: spec.name,
      networkId: spec.networkId,
      recordClass: spec.recordClass,
      reviewDeployment,
      reviewedFee,
      reviewInvoke,
      reviewMessage,
      reviewState: spec.reviewState,
      submit: take(),
      submitMessage,
      submitState: spec.submitState,
    });
  }
  return out;
};

/**
 * The extension's text for each Ready refusal, keyed by mobile failure code. A class label
 * inside a message ("argent 0.3.1") is replaced by `{label}`, as `{hash}` marks a hash.
 */
export const argentFailureCopy = (
  refusals: readonly CapturedArgentRefusal[],
): Readonly<Record<string, string>> => {
  const copy: Record<string, string> = {};
  for (const captured of refusals) {
    const message = (captured.submitMessage ?? captured.reviewMessage ?? "").replace(
      /argent \d+\.\d+\.\d+/,
      "{label}",
    );
    if (copy[captured.code] !== undefined && copy[captured.code] !== message) {
      throw new Error(`${captured.code}: two different refusal texts`);
    }
    copy[captured.code] = message;
  }
  return copy;
};
