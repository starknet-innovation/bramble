/**
 * G5's refusals: what the extension's multisig code refuses, and the words it refuses with,
 * each produced by handing the real function a bad input (or the canned node a bad reply) and
 * recording the error it throws or the verdict it returns. Inputs are built from the flows in
 * `mobile-multisig-transactions.ts`, so a port can replay each one against the same keys.
 */
import {
  type ArgentMultisigCall,
  nextArgentMultisigPublicConfig,
  parseArgentMultisigConfigChange,
  requireSafeArgentMultisigCalls,
} from "@bramble/multisig/chain";
import { canonicalArgentMultisigDeployConfig } from "@bramble/multisig/deploy";
import {
  type ArgentMultisigSigningIntent,
  canReplaceArgentMultisigSigningIntent,
  isArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import { serializeArgentMultisigSignature } from "@bramble/starknet/account-contracts";
import {
  prepareArgentMultisigInvokeV3,
  submitPreparedArgentMultisigInvokeV3,
} from "@bramble/starknet/multisig-invoke";
import { estimateAccountDeploymentFee, submitAccountDeployment } from "@bramble/starknet/rpc";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { RpcError } from "starknet";
import { mergeImportedArgentMultisigIntent } from "../apps/extension/src/background/multisig/multisig-inputs";
import {
  computeMultisigFlows,
  MULTISIG_SALT,
  MULTISIG_TRANSACTION_FIXTURE_PATHS,
  type MultisigSigner,
  multisigRecord,
  multisigSigners,
  NEW_MEMBER,
  newRecorder,
  OUTSIDER,
  prepareFor,
  proposedIntent,
  signAs,
  takeWire,
  withCannedNode,
} from "./mobile-multisig-transactions";
import {
  type Injection,
  PLACEHOLDER_URLS,
  providerFactory,
  type Recorder,
  TRANSACTION_MNEMONIC,
} from "./mobile-transactions-capture";

const NETWORK = "SN_SEPOLIA";

/**
 * The error `run` throws: its name and message (a 50-64 digit hash shown as `{hash}`), or, for
 * a node error the extension passes through unchanged, its name and JSON-RPC code (the message
 * is starknet.js's dump of the request).
 */
const refusal = async (
  run: () => unknown,
): Promise<
  { readonly name: string } & ({ readonly code: number } | { readonly message: string })
> => {
  try {
    await run();
  } catch (error) {
    const named = error instanceof Error ? error : new Error(String(error));
    if (named instanceof RpcError) return { code: named.code, name: named.name };
    return { message: named.message.replace(/0x[0-9a-f]{50,64}/g, "{hash}"), name: named.name };
  }
  throw new Error("the extension accepted an input the fixture records as refused");
};

/** Each named input with the refusal `run` gives it. */
const refusalsOf = async <T>(
  inputs: Readonly<Record<string, T>>,
  run: (input: T) => unknown,
): Promise<readonly { readonly input: T; readonly name: string; readonly refusal: unknown }[]> => {
  const cases = [];
  for (const [name, input] of Object.entries(inputs)) {
    cases.push({ input, name, refusal: await refusal(() => run(input)) });
  }
  return cases;
};

const keyOf = (signers: readonly MultisigSigner[], index: number): string =>
  signers[index]?.publicKey ?? "";

const deployConfigRefusals = async (signers: readonly MultisigSigner[]) => {
  const members = [0, 1, 2].map((index) => keyOf(signers, index));
  const inputs = {
    duplicateSigner: {
      salt: MULTISIG_SALT,
      signerPublicKeys: [...members, members[0]],
      threshold: 2,
    },
    noSigners: { salt: MULTISIG_SALT, signerPublicKeys: [], threshold: 1 },
    saltOutOfField: { salt: `0x8${"0".repeat(63)}`, signerPublicKeys: members, threshold: 2 },
    thirtyThreeSigners: {
      salt: MULTISIG_SALT,
      signerPublicKeys: Array.from({ length: 33 }, (_, index) => `0x${(index + 1).toString(16)}`),
      threshold: 1,
    },
    thresholdAboveSigners: { salt: MULTISIG_SALT, signerPublicKeys: members, threshold: 4 },
    thresholdZero: { salt: MULTISIG_SALT, signerPublicKeys: members, threshold: 0 },
    zeroSigner: { salt: MULTISIG_SALT, signerPublicKeys: [...members, "0x0"], threshold: 2 },
  } as Readonly<Record<string, Parameters<typeof canonicalArgentMultisigDeployConfig>[0]>>;
  const cases = await refusalsOf(inputs, canonicalArgentMultisigDeployConfig);
  // One compact JSON string per input, as the intents: the 33-signer input alone is 40 lines.
  return cases.map((entry) => ({ ...entry, input: JSON.stringify(entry.input) }));
};

const deploySubmitRefusals = async (signers: readonly MultisigSigner[]) => {
  const { currentConfig: _observed, ...account } = multisigRecord(NETWORK, signers);
  const attempt = async (deployed: boolean, signer: MultisigSigner) => {
    const recorder = newRecorder(false);
    const makeProvider = providerFactory(recorder, account, STARKNET_NETWORKS[NETWORK].chainId);
    const signHash = (hash: string) => signAs(signer, hash, recorder);
    const input = { account, rpcUrls: PLACEHOLDER_URLS, signHash };
    const reviewedFee = await estimateAccountDeploymentFee(input, makeProvider);
    takeWire(recorder);
    recorder.state = { ...recorder.state, deployed };
    const result = await refusal(() =>
      submitAccountDeployment({ ...input, isAuthorized: () => true, reviewedFee }, makeProvider),
    );
    return { refusal: result, wire: takeWire(recorder) };
  };
  return [
    { name: "alreadyDeployed", ...(await attempt(true, signers[0] as MultisigSigner)) },
    {
      name: "nonMemberDeployer",
      signerAccountIndex: OUTSIDER,
      ...(await attempt(false, signers[OUTSIDER] as MultisigSigner)),
    },
  ];
};

const callRefusals = async (signers: readonly MultisigSigner[], transfer: ArgentMultisigCall) => {
  const record = multisigRecord(NETWORK, signers);
  const self = (entrypoint: string, calldata: readonly string[]): ArgentMultisigCall => ({
    calldata,
    contractAddress: record.address,
    entrypoint,
  });
  const batches: Record<string, readonly ArgentMultisigCall[]> = {
    empty: [],
    selfCallInBatch: [transfer, self("change_threshold", ["0x1"])],
    upgradeCallback: [self("execute_after_upgrade", [])],
    unsupportedSelfCall: [self("upgrade", ["0x1"])],
    uppercaseEntrypoint: [{ ...transfer, entrypoint: "Transfer" }],
    unpaddedNonCanonical: [{ ...transfer, calldata: ["0x01"] }],
  };
  return refusalsOf(batches, (calls) => requireSafeArgentMultisigCalls(record.address, calls));
};

const prepareRefusals = async (
  signers: readonly MultisigSigner[],
  transfer: ArgentMultisigCall,
) => {
  const record = multisigRecord(NETWORK, signers);
  const config = record.currentConfig ?? { signerPublicKeys: [], threshold: 0 };
  const attempt = async (
    account: typeof record,
    calls: readonly ArgentMultisigCall[],
    inject?: Injection,
  ) => {
    const recorder: Recorder = newRecorder(true);
    if (inject) recorder.inject = inject;
    const result = await refusal(() =>
      withCannedNode(recorder, record, () =>
        prepareArgentMultisigInvokeV3({ account, calls, config, rpcUrls: PLACEHOLDER_URLS }),
      ),
    );
    return { refusal: result, wire: takeWire(recorder) };
  };
  return [
    {
      name: "wrongChain",
      ...(await attempt(record, [transfer], (method) =>
        method === "starknet_chainId" ? { result: "0x534e5f4d41494e" } : undefined,
      )),
    },
    {
      name: "notTheMultisigClass",
      ...(await attempt({ ...record, classHash: "0x1" }, [transfer])),
    },
    { name: "noCalls", ...(await attempt(record, [])) },
  ];
};

type Ready = {
  readonly intent: ArgentMultisigSigningIntent;
  readonly signers: readonly MultisigSigner[];
};

/** Variants of the ready intent, each with the stored-intent validator's verdict. */
const intentVerdicts = async ({ intent, signers }: Ready) => {
  const hash = intent.prepared.transactionHash;
  const [first, second] = intent.signatures as [StarkSignature, StarkSignature];
  const third = await signAs(signers[0] as MultisigSigner, hash);
  const outsider = await signAs(signers[OUTSIDER] as MultisigSigner, hash);
  const otherHash = await signAs(signers[0] as MultisigSigner, "0x1234");
  const collecting = { ...intent, signatures: [first], state: "collecting" as const };
  const variants: Record<string, ArgentMultisigSigningIntent> = {
    ready: intent,
    collectingOne: collecting,
    duplicateSigner: { ...intent, signatures: [first, first] },
    nonMemberSignature: { ...collecting, signatures: [outsider] },
    outOfGuidOrder: { ...intent, signatures: [second, first] },
    overThreshold: { ...intent, signatures: [first, second, third] },
    readyBelowThreshold: { ...intent, signatures: [first] },
    collectingAtThreshold: { ...intent, state: "collecting" },
    signatureOverOtherHash: {
      ...collecting,
      signatures: [{ ...otherHash, publicKey: first.publicKey }],
    },
    tamperedNonce: { ...intent, prepared: { ...intent.prepared, nonce: "0x6" } },
    wrongId: { ...intent, id: `${intent.accountId}:0x1` },
    submittedWithoutHash: { ...intent, state: "submitted" },
  };
  return Object.entries(variants).map(([name, variant]) => ({
    intent: JSON.stringify(variant),
    name,
    valid: isArgentMultisigSigningIntent(variant),
  }));
};

const replacementVerdicts = ({ intent }: Ready) => {
  const [first] = intent.signatures as [StarkSignature];
  const collecting = { ...intent, signatures: [first], state: "collecting" as const };
  const pairs: Record<string, readonly [ArgentMultisigSigningIntent, ArgentMultisigSigningIntent]> =
    {
      collectingToReady: [collecting, intent],
      dropsASignature: [intent, { ...collecting }],
      readyToSubmitted: [
        intent,
        {
          ...intent,
          broadcastTransactionHash: intent.prepared.transactionHash,
          state: "submitted",
        },
      ],
      collectingToSubmitted: [
        collecting,
        {
          ...intent,
          broadcastTransactionHash: intent.prepared.transactionHash,
          state: "submitted",
        },
      ],
      changesSummary: [collecting, { ...intent, summary: "Something else" }],
    };
  return Object.entries(pairs).map(([name, [current, next]]) => ({
    canReplace: canReplaceArgentMultisigSigningIntent(current, next),
    name,
    nextSignatureCount: next.signatures.length,
    nextState: next.state,
  }));
};

/** A re-imported package merged over local state, as `importIntent` does. */
const mergeCases = ({ intent }: Ready) => {
  const [first, second] = intent.signatures as [StarkSignature, StarkSignature];
  const local = { ...intent, signatures: [second], state: "collecting" as const };
  const remote = {
    ...intent,
    signatures: [first],
    state: "collecting" as const,
    summary: "Remote",
  };
  const submitted = {
    ...intent,
    broadcastTransactionHash: intent.prepared.transactionHash,
    state: "submitted" as const,
  };
  return [
    { name: "addsTheOtherSignature", result: mergeImportedArgentMultisigIntent(local, remote) },
    { name: "terminalStateWins", result: mergeImportedArgentMultisigIntent(submitted, remote) },
  ].map(({ name, result }) => ({
    name,
    signerKeys: result.signatures.map((signature) => signature.publicKey),
    state: result.state,
    summary: result.summary,
  }));
};

const signatureRefusals = async ({ intent, signers }: Ready) => {
  const [first, second] = intent.signatures as [StarkSignature, StarkSignature];
  const outsider = await signAs(
    signers[OUTSIDER] as MultisigSigner,
    intent.prepared.transactionHash,
  );
  const config = {
    signerPublicKeys: intent.signatures.map((signature) => signature.publicKey),
    threshold: intent.configSnapshot.threshold,
  };
  const sets: Record<string, readonly StarkSignature[]> = {
    belowThreshold: [first],
    nonMember: [first, outsider],
    sameSignerTwice: [second, second],
  };
  const cases = [];
  for (const [name, signatures] of Object.entries(sets)) {
    cases.push({
      name,
      refusal: await refusal(() => serializeArgentMultisigSignature(signatures, config)),
      signerKeys: signatures.map((signature) => signature.publicKey),
    });
  }
  return cases;
};

const submitRefusals = async ({ intent, signers }: Ready) => {
  const record = multisigRecord(NETWORK, signers);
  const config = {
    signerPublicKeys: intent.signatures.map((signature) => signature.publicKey),
    threshold: intent.configSnapshot.threshold,
  };
  const attempt = async (
    signatures: readonly StarkSignature[],
    prepared: ArgentMultisigSigningIntent["prepared"],
    inject?: Injection,
  ) => {
    const recorder = newRecorder(true);
    recorder.signatures.push({ hash: intent.prepared.transactionHash, r: "0x0", s: "0x0" });
    if (inject) recorder.inject = inject;
    const result = await refusal(() =>
      withCannedNode(recorder, record, () =>
        submitPreparedArgentMultisigInvokeV3({
          config,
          isAuthorized: () => true,
          prepared,
          rpcUrls: PLACEHOLDER_URLS,
          signatures,
        }),
      ),
    );
    return { refusal: result, wire: takeWire(recorder) };
  };
  const onInvoke =
    (answer: ReturnType<Injection>): Injection =>
    (method) =>
      method === "starknet_addInvokeTransaction" ? answer : undefined;
  const all = intent.signatures;
  return [
    { name: "belowThreshold", ...(await attempt(all.slice(0, 1), intent.prepared)) },
    {
      name: "tamperedPrepared",
      ...(await attempt(all, { ...intent.prepared, nonce: "0x6" })),
    },
    {
      name: "feeExpired",
      ...(await attempt(
        all,
        intent.prepared,
        onInvoke({
          error: {
            code: 55,
            data: "Max L2 gas price (0x10c388d00) is lower than the actual gas price: 0x2540be400.",
            message: "Account validation failed",
          },
        }),
      )),
    },
    {
      name: "invalidNonce",
      ...(await attempt(
        all,
        intent.prepared,
        onInvoke({ error: { code: 52, message: "Invalid transaction nonce" } }),
      )),
    },
    {
      name: "hashMismatch",
      ...(await attempt(all, intent.prepared, onInvoke({ result: { transaction_hash: "0x1" } }))),
    },
    { name: "responseLost", ...(await attempt(all, intent.prepared, onInvoke("transport"))) },
  ];
};

const configChangeRefusals = async (signers: readonly MultisigSigner[]) => {
  const record = multisigRecord(NETWORK, signers);
  const current = record.currentConfig ?? { signerPublicKeys: [], threshold: 0 };
  const [a, b] = current.signerPublicKeys as [string, string];
  const fresh = keyOf(signers, NEW_MEMBER);
  const self = (entrypoint: string, calldata: readonly string[]): ArgentMultisigCall => ({
    calldata,
    contractAddress: record.address,
    entrypoint,
  });
  const calls: Record<string, ArgentMultisigCall> = {
    changeThresholdExtraCalldata: self("change_threshold", ["0x1", "0x0"]),
    notASelfCall: { ...self("change_threshold", ["0x1"]), contractAddress: "0x123" },
    signerCountMismatch: self("add_signers", ["0x1", "0x2", "0x0", fresh]),
    thresholdThirtyThree: self("change_threshold", ["0x21"]),
    thresholdZero: self("change_threshold", ["0x0"]),
    unsupportedEntrypoint: self("upgrade", ["0x1"]),
    nonStarknetSigner: self("replace_signer", ["0x1", a, "0x0", fresh]),
  };
  const changes: Record<string, Parameters<typeof nextArgentMultisigPublicConfig>[1]> = {
    addExistingSigner: { kind: "add_signers", signerPublicKeys: [a], threshold: 2 },
    removeDuplicateSigners: { kind: "remove_signers", signerPublicKeys: [a, a], threshold: 1 },
    removeLeavesThresholdTooHigh: { kind: "remove_signers", signerPublicKeys: [a], threshold: 3 },
    removeNonMember: { kind: "remove_signers", signerPublicKeys: [fresh], threshold: 1 },
    replaceNonMember: {
      addSignerPublicKey: fresh,
      kind: "replace_signer",
      removeSignerPublicKey: fresh,
    },
    replaceWithExistingSigner: {
      addSignerPublicKey: b,
      kind: "replace_signer",
      removeSignerPublicKey: a,
    },
    thresholdAboveSigners: { kind: "change_threshold", threshold: 4 },
    unchangedThreshold: { kind: "change_threshold", threshold: 2 },
  };
  return {
    current,
    parse: await refusalsOf(calls, (call) => parseArgentMultisigConfigChange(record.address, call)),
    transitions: await refusalsOf(changes, (change) =>
      nextArgentMultisigPublicConfig(current, change),
    ),
  };
};

/** The ready (2 of 3) Sepolia intent the refusals are built from. */
const readyIntent = async (signers: readonly MultisigSigner[], transfer: ArgentMultisigCall) => {
  const record = multisigRecord(NETWORK, signers);
  const { prepared, review } = await prepareFor(record, [transfer], newRecorder(true));
  let intent = proposedIntent(record, prepared, review.summary);
  for (const index of [1, 2]) {
    const signature = await signAs(signers[index] as MultisigSigner, prepared.transactionHash);
    intent = mergeImportedArgentMultisigIntent(intent, {
      ...intent,
      signatures: [...intent.signatures, signature],
    });
  }
  return intent;
};

/** Every refusal group, over Sepolia's fixture multisig. */
export const computeMultisigRefusals = async () => {
  const signers = await multisigSigners(NETWORK);
  const record = multisigRecord(NETWORK, signers);
  const transfer: ArgentMultisigCall = {
    calldata: ["0x456", "0x1", "0x0"],
    contractAddress: "0x123",
    entrypoint: "transfer",
  };
  const ready: Ready = { intent: await readyIntent(signers, transfer), signers };
  return {
    account: record,
    calls: await callRefusals(signers, transfer),
    deployConfig: await deployConfigRefusals(signers),
    deploySubmit: await deploySubmitRefusals(signers),
    intents: await intentVerdicts(ready),
    merges: mergeCases(ready),
    prepare: await prepareRefusals(signers, transfer),
    readyIntent: JSON.stringify(ready.intent),
    replacements: replacementVerdicts(ready),
    signatures: await signatureRefusals(ready),
    submit: await submitRefusals(ready),
    transfer,
  };
};

const GENERATED_BY =
  "Generated by scripts/generate-mobile-parity-vectors.ts from the extension's Argent multisig paths (scripts/mobile-multisig-transactions.ts, mobile-multisig-refusals.ts). Do not edit.";

/** The committed fixture: each part as plain JSON data, keyed by its path. */
export const computeMultisigTransactionFixture = async (): Promise<
  ReadonlyMap<string, unknown>
> => {
  const { flows, signers } = await computeMultisigFlows();
  const parts = {
    flows: { generatedBy: GENERATED_BY, mnemonic: TRANSACTION_MNEMONIC, ...flows },
    refusals: { generatedBy: GENERATED_BY, ...(await computeMultisigRefusals()) },
    signers: {
      generatedBy: GENERATED_BY,
      ...signers,
      refusals: await configChangeRefusals(await multisigSigners(NETWORK)),
    },
  };
  return new Map(
    Object.entries(parts).map(([part, value]) => [
      MULTISIG_TRANSACTION_FIXTURE_PATHS[part as keyof typeof parts],
      JSON.parse(JSON.stringify(value)) as unknown,
    ]),
  );
};
