/**
 * Adapter from the pinned official Starknet privacy SDK browser bundle to MC
 * Wallet's narrow STRK20 middleware contract.
 */

import type { BigNumberish, Call, Signature, TypedData } from "starknet";
import { num, RpcProvider, typedData } from "starknet";
import { WalletError } from "../../shared/errors";
import { isJson, isRecord } from "../../shared/json";
import { STARKNET_NETWORKS, sameFelt } from "../networks";
import { submitInvokeTransaction } from "../rpc-submit";
import { Strk20CallSetSigner } from "./call-set-signer";
import type { Strk20NetworkConfig } from "./config";
import { buildStrk20PaymasterPlan, submitStrk20PaymasterPlan } from "./paymaster";
import {
  isStrk20CallAndProof,
  STRK20_LIMITS,
  type Strk20Action,
  type Strk20BalanceEntry,
  type Strk20CallAndProof,
} from "./schemas";
import {
  STRK20_INSUFFICIENT_BALANCE,
  STRK20_NOT_REGISTERED,
  STRK20_PRIVACY_LEAK,
  STRK20_SERVICE_UNAVAILABLE,
  STRK20_SUBMISSION_UNAVAILABLE,
  type Strk20AccountContext,
  type Strk20PrepareInput,
  type Strk20Service,
} from "./service";

type SdkNote = { readonly amount: BigNumberish };
type SdkNoteMap = {
  readonly entries: () => IterableIterator<[bigint, readonly SdkNote[]]>;
};
type SdkCallBuilderArgs = {
  readonly openNotes: readonly { readonly noteId: BigNumberish }[];
  readonly poolAddress: BigNumberish;
};
type SdkTokenBuilder = {
  readonly deposit: (...inputs: readonly { readonly amount: bigint }[]) => SdkTokenBuilder;
  readonly done: () => SdkBuilder;
  readonly transfer: (
    ...outputs: readonly { readonly amount: bigint | symbol; readonly recipient: string }[]
  ) => SdkTokenBuilder;
  readonly withdraw: (
    ...outputs: readonly { readonly amount: bigint; readonly recipient: string }[]
  ) => SdkTokenBuilder;
};
type SdkBuilder = {
  readonly createProofInvocation: (options: unknown) => Promise<unknown>;
  readonly invoke: (
    call: (args: SdkCallBuilderArgs) => {
      readonly calldata: BigNumberish[];
      readonly contractAddress: string;
    },
  ) => SdkBuilder;
  readonly simulate: (options: unknown) => Promise<unknown>;
  readonly subaccounts: (dappName: string) => {
    readonly commitment: (nonce: BigNumberish) => Promise<bigint>;
    readonly invoke: (
      nonce: BigNumberish,
      options: { readonly calls: readonly Call[]; readonly collectPolicy: unknown },
    ) => SdkBuilder;
    readonly partialCommitment: () => Promise<bigint>;
  };
  readonly with: (token: string) => SdkTokenBuilder;
};
type SdkTransfers = {
  readonly build: (options?: unknown) => SdkBuilder;
  readonly discoverNotes: () => Promise<{ readonly notes: SdkNoteMap }>;
  readonly executeWithInvocation: (invocation: unknown, block: number) => Promise<unknown>;
};
type SdkWarning = {
  readonly code: unknown;
  readonly message: unknown;
};

/**
 * Narrow runtime export set consumed from the vendored official SDK.
 */
export type PrivacySdkRuntime = {
  readonly Open: symbol;
  readonly createPrivateTransfers: (input: unknown) => SdkTransfers;
};

type OfficialServiceOptions = {
  readonly http?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly providerFor?: (nodeUrl: string) => RpcProvider;
  readonly sdk: PrivacySdkRuntime;
  readonly submitInvoke?: typeof submitInvokeTransaction;
};

const requireConfig = (context: Strk20AccountContext): Strk20NetworkConfig => {
  if (!context.config || context.rpcUrls.length === 0) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return context.config;
};

const signatureFor = async (
  context: Strk20AccountContext,
  messageHash: string,
): Promise<Signature> => {
  const signature = await context.signHash(messageHash);
  return [signature.r, signature.s];
};

const transfersFor = (sdk: PrivacySdkRuntime, context: Strk20AccountContext): SdkTransfers => {
  const config = requireConfig(context);
  const chainId = STARKNET_NETWORKS[context.account.networkId].chainId;
  const nodeUrl = context.rpcUrls[0];
  if (!nodeUrl) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const signer = new Strk20CallSetSigner({
    accountAddress: context.account.address,
    chainId,
    sign: (messageHash) => signatureFor(context, messageHash),
  });
  return sdk.createPrivateTransfers({
    account: { address: context.account.address, signer },
    discoveryProvider: { url: config.discoveryUrl },
    poolContractAddress: config.poolAddress,
    provingProvider: {
      chainId,
      nodeUrl,
      ...(config.ohttpRelayUrl ? { ohttp: { relayUrl: config.ohttpRelayUrl } } : {}),
      url: config.proverUrl,
    },
    subAccountAnonymizerAddress: config.subaccountAnonymizerAddress,
    viewingKeyProvider: {
      async getViewingKey() {
        return context.viewingKey();
      },
    },
  });
};

const mapProtocolError = (error: unknown): never => {
  if (error instanceof WalletError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : "";
  if (/not registered|registration|viewing key.*not set/i.test(message)) {
    throw new WalletError(STRK20_NOT_REGISTERED);
  }
  if (/insufficient|not enough (?:private )?(?:funds|balance|notes)/i.test(message)) {
    throw new WalletError(STRK20_INSUFFICIENT_BALANCE);
  }
  if (/USER_LINKAGE|privacy leak/i.test(message)) {
    throw new WalletError(STRK20_PRIVACY_LEAK);
  }
  throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
};

const assertNoSdkWarnings = (value: unknown): void => {
  if (!isRecord(value) || !Array.isArray(value["warnings"])) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const warnings = value["warnings"] as readonly SdkWarning[];
  if (warnings.some((warning) => isRecord(warning) && warning["code"] === "USER_LINKAGE")) {
    throw new WalletError(STRK20_PRIVACY_LEAK);
  }
  if (
    warnings.length > 0 ||
    !warnings.every(
      (warning) =>
        isRecord(warning) &&
        typeof warning["code"] === "string" &&
        typeof warning["message"] === "string",
    )
  ) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
};

const balancesFrom = (
  notes: SdkNoteMap,
  requested: readonly string[],
): readonly Strk20BalanceEntry[] => {
  const totals = new Map<bigint, bigint>();
  try {
    for (const [token, tokenNotes] of notes.entries()) {
      let total = 0n;
      for (const note of tokenNotes) {
        const amount = BigInt(note.amount);
        if (amount < 0n) {
          throw new Error("negative note");
        }
        total += amount;
      }
      totals.set(token, total);
    }
  } catch {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const tokens =
    requested.length > 0
      ? requested
      : [...totals.keys()]
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
          .map((token) => `0x${token.toString(16)}`);
  if (tokens.length > STRK20_LIMITS.balances) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return tokens.map((token) => ({
    balance: `0x${(totals.get(BigInt(token)) ?? 0n).toString(16)}`,
    token,
  }));
};

const expandInvokeCalldata = (
  calldata: readonly string[],
  args: SdkCallBuilderArgs,
): BigNumberish[] =>
  calldata.map((item) => {
    if (item === `${"$"}{poolAddress}`) {
      return args.poolAddress;
    }
    const match = /^\$\{openNoteIds\[([0-9]+)\]\}$/.exec(item);
    if (!match) {
      return item;
    }
    const index = Number(match[1]);
    const note = args.openNotes[index];
    if (!note) {
      throw new WalletError("invalid strk20 action batch");
    }
    return note.noteId;
  });

const collectPolicy = (
  action: Extract<Strk20Action, { readonly type: "subaccount_invoke" }>,
): unknown =>
  action.collect_policy.type === "exact"
    ? { amount: BigInt(action.collect_policy.amount), type: "exact" }
    : { type: action.collect_policy.type };

const addAction = (builder: SdkBuilder, action: Strk20Action, open: symbol): SdkBuilder => {
  if (action.type === "deposit") {
    return builder
      .with(action.token)
      .deposit({ amount: BigInt(action.amount) })
      .done();
  }
  if (action.type === "withdraw") {
    return builder
      .with(action.token)
      .withdraw({ amount: BigInt(action.amount), recipient: action.recipient })
      .done();
  }
  if (action.type === "transfer") {
    return builder
      .with(action.token)
      .transfer({
        amount: action.amount === "OPEN" ? open : BigInt(action.amount),
        recipient: action.recipient,
      })
      .done();
  }
  if (action.type === "subaccount_invoke") {
    return builder.subaccounts(action.dapp_name).invoke(action.nonce, {
      calls: action.calls.map((call) => ({
        calldata: [...call.calldata],
        contractAddress: call.contract_address,
        entrypoint: call.entry_point,
      })),
      collectPolicy: collectPolicy(action),
    });
  }
  return builder.invoke((args) => ({
    calldata: expandInvokeCalldata(action.calldata, args),
    contractAddress: action.contract,
  }));
};

const builderFor = (
  sdk: PrivacySdkRuntime,
  transfers: SdkTransfers,
  actions: readonly Strk20Action[],
): SdkBuilder => {
  let builder = transfers.build({
    autoDiscover: { channels: "refresh", notes: "refresh" },
    autoRegister: false,
    autoSelectNotes: "naive",
    autoSetup: true,
    registryConst: true,
  });
  for (const action of actions) {
    builder = addAction(builder, action, sdk.Open);
  }
  return builder;
};

const provingBlock = async (provider: RpcProvider): Promise<number> =>
  Math.max(0, (await provider.getBlockNumber()) - 9);

const readCallAndProof = (
  value: unknown,
  config: Strk20NetworkConfig,
  simulate: boolean,
): Strk20CallAndProof => {
  const source = isRecord(value) && isRecord(value["callAndProof"]) ? value["callAndProof"] : null;
  if (!source || !isRecord(source["call"]) || !isRecord(source["proof"])) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const call = source["call"];
  const proof = source["proof"];
  const candidate = {
    call: {
      calldata: Array.isArray(call["calldata"]) ? call["calldata"].map(String) : null,
      contract_address: call["contractAddress"],
      entry_point: call["entrypoint"],
    },
    proof: simulate
      ? { data: "", output: [], proof_facts: [] }
      : {
          data: proof["data"],
          output: proof["output"],
          proof_facts: proof["proofFacts"],
        },
  };
  if (
    !isStrk20CallAndProof(candidate) ||
    !sameFelt(candidate.call.contract_address, config.poolAddress) ||
    candidate.call.entry_point !== "apply_actions"
  ) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return candidate;
};

const prepareWith = async (
  sdk: PrivacySdkRuntime,
  input: Strk20PrepareInput,
  providerFor: (nodeUrl: string) => RpcProvider,
): Promise<Strk20CallAndProof> => {
  const config = requireConfig(input);
  const nodeUrl = input.rpcUrls[0];
  if (!nodeUrl) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const transfers = transfersFor(sdk, input);
  const builder = builderFor(sdk, transfers, input.actions);
  try {
    const provider = providerFor(nodeUrl);
    const block = await provingBlock(provider);
    let result: unknown;
    if (input.simulate) {
      result = await builder.simulate({
        provider,
        provingBlockId: block,
        validateSignature: false,
      });
    } else {
      const invocation = await builder.createProofInvocation({ provingBlockId: block });
      assertNoSdkWarnings(invocation);
      result = await transfers.executeWithInvocation(invocation, block);
    }
    assertNoSdkWarnings(result);
    return readCallAndProof(result, config, input.simulate);
  } catch (error) {
    return mapProtocolError(error);
  }
};

const approveCalls = (actions: readonly Strk20Action[], poolAddress: string): readonly Call[] => {
  const deposits = new Map<bigint, bigint>();
  for (const action of actions) {
    if (action.type === "deposit") {
      const token = BigInt(action.token);
      deposits.set(token, (deposits.get(token) ?? 0n) + BigInt(action.amount));
    }
  }
  return [...deposits].map(([token, amount]) => ({
    calldata: [poolAddress, num.toHex(amount), "0x0"],
    contractAddress: num.toHex(token),
    entrypoint: "approve",
  }));
};

/**
 * Creates the production STRK20 service backed by the pinned official SDK.
 */
export const createOfficialStrk20Service = ({
  http,
  providerFor = (nodeUrl) => new RpcProvider({ nodeUrl }),
  sdk,
  submitInvoke = submitInvokeTransaction,
}: OfficialServiceOptions): Strk20Service => ({
  async prepare(input) {
    return prepareWith(sdk, input, providerFor);
  },
  async privateBalances(input) {
    try {
      const result = await transfersFor(sdk, input).discoverNotes();
      return balancesFrom(result.notes, input.tokens);
    } catch (error) {
      return mapProtocolError(error);
    }
  },
  async quoteActions(input) {
    const config = requireConfig(input);
    if (!config.paymaster) {
      throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
    }
    return buildStrk20PaymasterPlan({
      accountAddress: input.account.address,
      approveCalls: approveCalls(input.actions, config.poolAddress),
      config: config.paymaster,
      ...(http ? { http } : {}),
      poolAddress: config.poolAddress,
    });
  },
  async subaccountCommitment(input) {
    requireConfig(input);
    try {
      const transfers = transfersFor(sdk, input);
      await transfers.discoverNotes();
      const subaccount = transfers.build().subaccounts(input.dappName);
      const commitment =
        input.nonce === undefined
          ? await subaccount.partialCommitment()
          : await subaccount.commitment(input.nonce);
      return num.toHex(commitment);
    } catch (error) {
      return mapProtocolError(error);
    }
  },
  async submitActions(input) {
    const config = requireConfig(input);
    if (!config.paymaster) {
      throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
    }
    const callAndProof = await prepareWith(
      sdk,
      {
        ...input,
        actions: [...input.actions, input.plan.feeAction],
        simulate: false,
      },
      providerFor,
    );
    return submitStrk20PaymasterPlan({
      accountAddress: input.account.address,
      call: {
        calldata: [...callAndProof.call.calldata],
        contractAddress: callAndProof.call.contract_address,
        entrypoint: callAndProof.call.entry_point,
      },
      config: config.paymaster,
      ...(http ? { http } : {}),
      plan: input.plan,
      proof: callAndProof.proof,
      signTypedData: async (value) => {
        if (!isJson(value)) {
          throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
        }
        const messageHash = typedData.getMessageHash(
          value as unknown as TypedData,
          input.account.address,
        );
        const signature = await input.signHash(messageHash);
        return [signature.r, signature.s];
      },
    });
  },
  async submitPrepared(input) {
    const config = requireConfig(input);
    if (
      input.proof.data.length === 0 ||
      input.proof.output.length === 0 ||
      input.proof.proof_facts.length === 0 ||
      !sameFelt(input.call.contractAddress, config.poolAddress) ||
      input.call.entrypoint !== "apply_actions"
    ) {
      throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
    }
    const result = await submitInvoke({
      account: input.account,
      calls: [input.call],
      proof: input.proof,
      rpcUrls: input.rpcUrls,
      signHash: async (messageHash) => {
        const signature = await input.signHash(messageHash);
        return { publicKey: signature.publicKey, r: signature.r, s: signature.s };
      },
    });
    return { transactionHash: result.transactionHash };
  },
});
