/**
 * G5: the extension's own Argent multisig transaction paths, recorded for the Rust port (P1).
 * Deploy runs `argentMultisigDeployment` and the platform's `estimateAccountDeploymentFee` and
 * `submitAccountDeployment`; propose runs `prepareArgentMultisigInvokeV3` with its production
 * provider (the multisig fee-bound overhead included) and the background's call review, intent
 * id, config snapshot and intent package; co-signing merges each signature as the background's
 * `mergeImportedArgentMultisigIntent` does and checks every stage with the stored-intent
 * validator; submit runs `submitPreparedArgentMultisigInvokeV3`; change signers runs
 * `argentMultisigConfigChangeCall` and the review of that self-call before preparing it.
 *
 * Nothing reaches a network: every JSON-RPC request is answered by the canned node of
 * `mobile-transactions-capture.ts` and recorded with its reply. Signatures are Krusty's RFC-6979
 * `signStarkHash` over keys `deriveAccount` returns for the published E2E phrase, so every value
 * is public and every run is identical. `bun run mobile:parity` writes the fixture;
 * `tests/conformance/mobile-multisig-parity.test.ts` fails when it drifts.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import {
  type ArgentMultisigConfigChange,
  argentMultisigConfigChangeCall,
} from "@bramble/multisig/chain";
import {
  argentMultisigDeployment,
  canonicalArgentMultisigDeployConfig,
  predictArgentMultisigAddress,
} from "@bramble/multisig/deploy";
import {
  type ArgentMultisigRecord,
  type ArgentMultisigSigningIntent,
  argentMultisigIntentId,
  isArgentMultisigSigningIntent,
  memoryMultisigStore,
} from "@bramble/multisig/repository";
import { createPreferencesStore } from "@bramble/settings/preferences";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentSignerGuid,
  serializeArgentMultisigSignature,
} from "@bramble/starknet/account-contracts";
import {
  type PreparedArgentMultisigInvokeV3,
  prepareArgentMultisigInvokeV3,
  preparedArgentMultisigFee,
  submitPreparedArgentMultisigInvokeV3,
} from "@bramble/starknet/multisig-invoke";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { estimateAccountDeploymentFee, submitAccountDeployment } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog, systemClock } from "@bramble/transactions/activity";
import { deriveAccount } from "@bramble/vault/accounts";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { isNostrApplicationData } from "@bramble/wallet-model/nostr";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { reviewArgentMultisigCalls } from "../apps/extension/src/background/multisig/multisig-call-review";
import type { MultisigOpsDeps } from "../apps/extension/src/background/multisig/multisig-deps";
import {
  argentMultisigIntentPackage,
  mergeImportedArgentMultisigIntent,
} from "../apps/extension/src/background/multisig/multisig-inputs";
import { configSnapshot } from "../apps/extension/src/background/multisig/multisig-ops";
import {
  type MobileNetworkId,
  PLACEHOLDER_URLS,
  providerFactory,
  type Recorder,
  recordingFetch,
  STRK,
  TRANSACTION_MNEMONIC,
} from "./mobile-transactions-capture";

/** Repository-relative paths of the committed fixture parts. */
export const MULTISIG_TRANSACTION_FIXTURE_PATHS = {
  flows: "mobile/core/tests/fixtures/extension-multisig-transactions.json",
  refusals: "mobile/core/tests/fixtures/extension-multisig-transactions-refusals.json",
  signers: "mobile/core/tests/fixtures/extension-multisig-transactions-signers.json",
} as const;

/** Constructor salt the fixture's multisig is deployed with. */
export const MULTISIG_SALT = "0x6272616d626c65";

/** Initial members (account indexes), in the order a user typed them; GUID order differs. */
const MEMBERS = [2, 0, 1] as const;
const THRESHOLD = 2;
/** The account that joins in the change-signers cases, and one that never is a member. */
export const NEW_MEMBER = 3;
export const OUTSIDER = 4;
/** Members who sign the proposal, in signing order (not GUID order). */
const COSIGNERS = [1, 2] as const;
const NONCE = "0x5";

/** One derived wallet account usable as a multisig signer. */
export type MultisigSigner = {
  readonly accountIndex: number;
  readonly guid: string;
  readonly privateKey: string;
  readonly publicKey: string;
};

const kmsPromise = import("@starknetfoundation/krusty-kms-wasm").then(createKrustyKms);

/** OpenZeppelin accounts 0..4 of the published phrase on `networkId`, as signer keys. */
export const multisigSigners = async (
  networkId: MobileNetworkId,
): Promise<readonly MultisigSigner[]> => {
  const kms = await kmsPromise;
  const signers: MultisigSigner[] = [];
  for (let accountIndex = 0; accountIndex <= OUTSIDER; accountIndex += 1) {
    const derived = await deriveAccount(kms, {
      accountContractType: "openzeppelin",
      accountIndex,
      mnemonic: TRANSACTION_MNEMONIC,
      networkId,
    });
    const publicKey = derived.account.publicKeyX;
    signers.push({
      accountIndex,
      guid: argentSignerGuid(publicKey),
      privateKey: derived.privateKey,
      publicKey,
    });
  }
  return signers;
};

/** Krusty's signature over `hash` by `signer`, recorded when a recorder is given. */
export const signAs = async (
  signer: MultisigSigner,
  hash: string,
  recorder?: Recorder,
): Promise<StarkSignature> => {
  const signed = await (await kmsPromise).signStarkHash(signer.privateKey, hash);
  recorder?.signatures.push({ hash, r: signed.r, s: signed.s });
  return { publicKey: signed.publicKey, r: signed.r, s: signed.s };
};

/** A fresh recorder for a node that holds the multisig deployed (or not) at `NONCE`. */
export const newRecorder = (deployed: boolean): Recorder => {
  resetRpcEndpointCooldownsForTests();
  return { events: new Set(), exchanges: [], signatures: [], state: { deployed, nonce: NONCE } };
};

/** Runs `run` with the global `fetch` answered by the canned node, so production providers run. */
export const withCannedNode = async <T>(
  recorder: Recorder,
  record: ArgentMultisigRecord,
  run: () => Promise<T>,
): Promise<T> => {
  const original = globalThis.fetch;
  const chainId = STARKNET_NETWORKS[record.networkId].chainId;
  globalThis.fetch = recordingFetch(recorder, record, chainId) as unknown as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

/**
 * Takes the recorded exchanges, one compact JSON string each, as the transaction fixture stores
 * them; intents and prepared transactions are stored the same way, to stay within Bramble's
 * 500-line limit. Readers decode them.
 */
export const takeWire = (recorder: Recorder): readonly string[] =>
  recorder.exchanges.splice(0).map((exchange) => JSON.stringify(exchange));

/** A multisig record created here, so it carries its counterfactual deployment. */
type CreatedRecord = ArgentMultisigRecord & {
  readonly deployment: NonNullable<ArgentMultisigRecord["deployment"]>;
};

/** The fixture's multisig on `networkId`: its record, as deployed and as currently configured. */
export const multisigRecord = (
  networkId: MobileNetworkId,
  signers: readonly MultisigSigner[],
): CreatedRecord => {
  const input = {
    salt: MULTISIG_SALT,
    signerPublicKeys: MEMBERS.map((index) => signers[index]?.publicKey ?? ""),
    threshold: THRESHOLD,
  };
  const deployment = canonicalArgentMultisigDeployConfig(input);
  const address = predictArgentMultisigAddress(input);
  return {
    accountContractType: "argent-multisig",
    address,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    currentConfig: { signerPublicKeys: deployment.signerPublicKeys, threshold: THRESHOLD },
    deployment,
    id: `${networkId}:${address}`,
    networkId,
  };
};

const captureDeploy = async (networkId: MobileNetworkId, signers: readonly MultisigSigner[]) => {
  const input = {
    salt: MULTISIG_SALT,
    signerPublicKeys: MEMBERS.map((index) => signers[index]?.publicKey ?? ""),
    threshold: THRESHOLD,
  };
  const { currentConfig: _observed, ...account } = multisigRecord(networkId, signers);
  const deployer = signers[MEMBERS[0]] as MultisigSigner;
  const recorder = newRecorder(false);
  const makeProvider = providerFactory(recorder, account, STARKNET_NETWORKS[networkId].chainId);
  const signHash = (hash: string) => signAs(deployer, hash, recorder);
  const reviewedFee = await estimateAccountDeploymentFee(
    { account, rpcUrls: PLACEHOLDER_URLS, signHash },
    makeProvider,
  );
  const review = takeWire(recorder);
  const submitted = await submitAccountDeployment(
    { account, isAuthorized: () => true, reviewedFee, rpcUrls: PLACEHOLDER_URLS, signHash },
    makeProvider,
  );
  return {
    canonical: canonicalArgentMultisigDeployConfig(input),
    deployerAccountIndex: deployer.accountIndex,
    deployment: argentMultisigDeployment(input),
    input,
    predictedAddress: predictArgentMultisigAddress(input),
    review,
    reviewedFee,
    signatures: recorder.signatures,
    submit: takeWire(recorder),
    transactionHash: submitted.transactionHash,
  };
};

// What the call review reads beside the record: a fresh wallet's preferences, an empty activity
// log and registry, and a locked session (so no vault account joins the trusted recipients).
const reviewDeps = (): MultisigOpsDeps =>
  ({
    activity: memoryActivityLog(systemClock),
    multisigStore: memoryMultisigStore(),
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    session: { peekPassphrase: () => null },
    wallet: {},
  }) as unknown as MultisigOpsDeps;

/** Prepares `calls` for the fixture's deployed multisig through the extension's own path. */
export const prepareFor = async (
  record: ArgentMultisigRecord,
  calls: PreparedArgentMultisigInvokeV3["calls"],
  recorder: Recorder,
) => {
  const config = record.currentConfig;
  if (!config) throw new Error("the fixture multisig has no current config");
  const review = await reviewArgentMultisigCalls(
    reviewDeps(),
    { record } as Parameters<typeof reviewArgentMultisigCalls>[1],
    calls,
    config,
  );
  if ("error" in review) throw new Error(review.error);
  const prepared = await withCannedNode(recorder, record, () =>
    prepareArgentMultisigInvokeV3({ account: record, calls, config, rpcUrls: PLACEHOLDER_URLS }),
  );
  return { prepare: takeWire(recorder), prepared, review };
};

/** The collecting intent the background's `prepareIntent` stores for `prepared`. */
export const proposedIntent = (
  record: ArgentMultisigRecord,
  prepared: PreparedArgentMultisigInvokeV3,
  summary: string,
): ArgentMultisigSigningIntent => {
  const config = record.currentConfig;
  const id = argentMultisigIntentId(record.id, prepared.transactionHash);
  if (!config || !id) throw new Error("the fixture intent has no config or id");
  return {
    accountId: record.id,
    // What the chain's authority read returns for this account (`getArgentMultisigConfig`).
    configSnapshot: configSnapshot({
      classHash: record.classHash,
      signerGuids: config.signerPublicKeys.map(argentSignerGuid),
      threshold: config.threshold,
    }),
    id,
    prepared,
    signatures: [],
    state: "collecting",
    summary,
  };
};

const captureProposal = async (networkId: MobileNetworkId, signers: readonly MultisigSigner[]) => {
  const record = multisigRecord(networkId, signers);
  const recipient = await recipientAddress(networkId);
  // A 1.5 STRK transfer, in the canonical felts the side panel sends (`readPrepareIntentInput`).
  const calls = [
    {
      calldata: [canonicalFelt(recipient) ?? "", `0x${(15n * 10n ** 17n).toString(16)}`, "0x0"],
      contractAddress: canonicalFelt(STRK(networkId).address) ?? "",
      entrypoint: "transfer",
    },
  ];
  const recorder = newRecorder(true);
  const { prepare, prepared, review } = await prepareFor(record, calls, recorder);
  let intent = proposedIntent(record, prepared, review.summary);
  const stages = [{ intent: JSON.stringify(intent), valid: isArgentMultisigSigningIntent(intent) }];
  const proposalPackage = JSON.stringify(argentMultisigIntentPackage(intent));
  for (const index of COSIGNERS) {
    const signature = await signAs(
      signers[index] as MultisigSigner,
      prepared.transactionHash,
      recorder,
    );
    intent = mergeImportedArgentMultisigIntent(intent, {
      ...intent,
      signatures: [...intent.signatures, signature],
    });
    stages.push({ intent: JSON.stringify(intent), valid: isArgentMultisigSigningIntent(intent) });
  }
  const config = {
    signerPublicKeys: intent.signatures.map((fragment) => fragment.publicKey),
    threshold: intent.configSnapshot.threshold,
  };
  const transactionHash = await withCannedNode(recorder, record, () =>
    submitPreparedArgentMultisigInvokeV3({
      config,
      isAuthorized: () => true,
      prepared,
      rpcUrls: PLACEHOLDER_URLS,
      signatures: intent.signatures,
    }),
  );
  return {
    calls,
    cosignerAccountIndexes: COSIGNERS,
    feeReview: preparedArgentMultisigFee(prepared),
    prepare,
    proposalPackage,
    proposalPackageFitsNostr: isNostrApplicationData(proposalPackage),
    readyPackage: JSON.stringify(argentMultisigIntentPackage(intent)),
    signature: serializeArgentMultisigSignature(intent.signatures, config),
    signatures: recorder.signatures,
    stages,
    submit: takeWire(recorder),
    transactionHash,
  };
};

const recipientAddress = async (networkId: MobileNetworkId): Promise<string> =>
  (
    await deriveAccount(await kmsPromise, {
      accountContractType: "openzeppelin",
      accountIndex: 9,
      mnemonic: TRANSACTION_MNEMONIC,
      networkId,
    })
  ).account.address;

/** One change of each kind against the fixture's 2-of-3 configuration. */
export const signerChanges = (
  signers: readonly MultisigSigner[],
): Readonly<Record<string, ArgentMultisigConfigChange>> => {
  const key = (index: number) => signers[index]?.publicKey ?? "";
  return {
    addSigners: { kind: "add_signers", signerPublicKeys: [key(NEW_MEMBER)], threshold: 3 },
    changeThreshold: { kind: "change_threshold", threshold: 3 },
    removeSigners: { kind: "remove_signers", signerPublicKeys: [key(MEMBERS[2])], threshold: 1 },
    replaceSigner: {
      addSignerPublicKey: key(NEW_MEMBER),
      kind: "replace_signer",
      removeSignerPublicKey: key(MEMBERS[1]),
    },
  };
};

/** The change-signers cases: each change, the self-call it becomes, its review and preparation. */
const captureSignerChanges = async (signers: readonly MultisigSigner[]) => {
  const record = multisigRecord("SN_SEPOLIA", signers);
  const cases = [];
  for (const [name, change] of Object.entries(signerChanges(signers))) {
    const call = argentMultisigConfigChangeCall(record.address, change);
    const recorder = newRecorder(true);
    const { prepare, prepared, review } = await prepareFor(record, [call], recorder);
    cases.push({ call, change, name, prepare, prepared: JSON.stringify(prepared), review });
  }
  return { account: record, cases };
};

/** Every flow on both networks, plus the change-signers cases on Sepolia. */
export const computeMultisigFlows = async () => {
  const networks = [];
  for (const networkId of ["SN_SEPOLIA", "SN_MAIN"] as const) {
    const signers = await multisigSigners(networkId);
    networks.push({
      account: multisigRecord(networkId, signers),
      deploy: await captureDeploy(networkId, signers),
      networkId,
      proposal: await captureProposal(networkId, signers),
      signers: signers.map(({ privateKey: _secret, ...signer }) => signer),
    });
  }
  return {
    flows: { networks },
    signers: await captureSignerChanges(await multisigSigners("SN_SEPOLIA")),
  };
};
