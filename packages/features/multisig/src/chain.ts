/**
 * OpenZeppelin MultisigComponent (v3.0.0) operations: pure calldata builders
 * for submit/confirm/revoke/execute plus on-chain reads for quorum, signers,
 * and per-transaction state. Confirmations are ordinary invokes from each
 * signer's own account, so no new signing or key material is involved — the
 * multisig contract itself enforces signer membership and quorum on-chain.
 * All inputs are validated as field elements before any calldata is built,
 * and malformed RPC responses throw rather than degrade. Proposal ids are
 * derived locally from the reviewed call; the contract view is only ever a
 * cross-check that must agree.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { createRpcProvider, timedRpcFetch, withRpcFallback } from "@mc-wallet/starknet/provider";

import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
  canonicalFelt as sharedCanonicalFelt,
} from "@mc-wallet/wallet-model/networks";
import { type Call, hash, type RpcProvider } from "starknet";

/**
 * Shared multisig limits. These are the single source of truth consumed by
 * the input parsers, the storage validators, and the deploy builder — keep
 * them here so the layers can never silently desynchronize.
 */
export const MULTISIG_LIMITS = {
  /** Maximum felts in one proposal's inner calldata. */
  calldataFelts: 64,
  /** Maximum user-facing multisig name length. */
  nameLength: 48,
  /** Maximum signers accepted for watching or deploying a multisig. */
  signers: 32,
  /** Maximum user-facing proposal summary length. */
  summaryLength: 120,
} as const;

const MAX_CALLDATA_FELTS = MULTISIG_LIMITS.calldataFelts;
const MAX_SIGNERS = MULTISIG_LIMITS.signers;
const MULTISIG_READ_TIMEOUT_MS = 6_000;

// Multisig verification is an interactive read: the user is waiting on a
// confirmation screen, so it takes a tighter deadline than the wallet-wide
// RPC_REQUEST_TIMEOUT_MS every provider already carries. Only the NUMBER is
// local — the transport is the shared one, so a multisig read cannot drift away
// from how the rest of the wallet composes signals or aborts a socket. The
// abort surfaces as a transport error, which is what withRpcFallback needs to
// move to the next configured RPC.
const multisigReadProvider = (nodeUrl: string): RpcProvider =>
  createRpcProvider(nodeUrl, { baseFetch: timedRpcFetch(MULTISIG_READ_TIMEOUT_MS) });

/**
 * One inner call a multisig proposal will execute, using the entrypoint name
 * (the selector is derived at build time with the standard Starknet keccak).
 */
export type MultisigCallInput = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * Chain-derived lifecycle state of a multisig proposal, mirroring the
 * component's `TransactionState` enum.
 */
export type MultisigProposalState = "confirmed" | "executed" | "not-found" | "pending";

/**
 * On-chain multisig configuration.
 */
export type MultisigConfig = {
  readonly quorum: number;
  readonly signers: readonly string[];
};

/**
 * Inputs for reading multisig configuration by contract address.
 */
export type MultisigConfigInput = {
  readonly address: string;
  readonly rpcUrls: readonly string[];
};

/**
 * Inputs for reading one proposal's state, confirmation count, and whether a
 * specific signer has confirmed it.
 */
export type MultisigProposalStatusInput = {
  readonly address: string;
  readonly rpcUrls: readonly string[];
  readonly signer: string;
  readonly txId: string;
};

/**
 * Proposal status snapshot read from the multisig contract.
 */
export type MultisigProposalStatus = {
  readonly confirmations: number;
  readonly confirmedBySigner: boolean;
  readonly state: MultisigProposalState;
};

/**
 * Inputs for deriving a proposal's transaction id locally and cross-checking
 * it against the contract's own `hash_transaction` view.
 */
export type MultisigTransactionIdInput = {
  readonly address: string;
  readonly call: MultisigCallInput;
  readonly rpcUrls: readonly string[];
  readonly salt: string;
};

const ENTRYPOINT_PATTERN = /^[a-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Checks a proposal entrypoint name before deriving a selector from it.
 */
export const isMultisigEntrypoint = (value: unknown): value is string =>
  typeof value === "string" && ENTRYPOINT_PATTERN.test(value);

/**
 * Checks an inner-call shape (addresses, entrypoint, calldata felts) before
 * it is stored or compiled into multisig calldata.
 */
export const isMultisigCallInput = (value: MultisigCallInput): boolean =>
  isNonZeroStarkFieldElement(value.contractAddress) &&
  isMultisigEntrypoint(value.entrypoint) &&
  value.calldata.length <= MAX_CALLDATA_FELTS &&
  value.calldata.every((felt) => isStarkFieldElement(felt));

// Every call site validates the value as a field element first, so the shared
// converter cannot return null here; the fallback only satisfies the types.
const canonicalFelt = (value: string): string => sharedCanonicalFelt(value) ?? value;

const requireCall = (call: MultisigCallInput): MultisigCallInput => {
  if (!isMultisigCallInput(call)) {
    throw new WalletError("Invalid multisig call");
  }
  return call;
};

const requireFelt = (value: string, label: string): string => {
  if (!isStarkFieldElement(value)) {
    throw new WalletError(`Invalid multisig ${label}`);
  }
  return canonicalFelt(value);
};

const requireAddress = (value: string): string => {
  if (!isNonZeroStarkFieldElement(value)) {
    throw new WalletError("Invalid multisig address");
  }
  return canonicalFelt(value);
};

// Serializes (to, selector, calldata, salt) exactly as the component's
// external entrypoints expect: the inner call flattened with a length prefix.
const innerCallCalldata = (call: MultisigCallInput, salt: string): string[] => {
  const checked = requireCall(call);
  return [
    canonicalFelt(checked.contractAddress),
    hash.getSelectorFromName(checked.entrypoint),
    `0x${checked.calldata.length.toString(16)}`,
    ...checked.calldata.map(canonicalFelt),
    requireFelt(salt, "salt"),
  ];
};

/**
 * Builds the `submit_transaction` invoke that proposes one inner call.
 */
export const buildMultisigSubmitCall = (
  multisigAddress: string,
  call: MultisigCallInput,
  salt: string,
): Call => ({
  calldata: innerCallCalldata(call, salt),
  contractAddress: requireAddress(multisigAddress),
  entrypoint: "submit_transaction",
});

/**
 * Builds the `confirm_transaction` invoke for a proposal id.
 */
export const buildMultisigConfirmCall = (multisigAddress: string, txId: string): Call => ({
  calldata: [requireFelt(txId, "transaction id")],
  contractAddress: requireAddress(multisigAddress),
  entrypoint: "confirm_transaction",
});

/**
 * Builds the `revoke_confirmation` invoke for a proposal id.
 */
export const buildMultisigRevokeCall = (multisigAddress: string, txId: string): Call => ({
  calldata: [requireFelt(txId, "transaction id")],
  contractAddress: requireAddress(multisigAddress),
  entrypoint: "revoke_confirmation",
});

/**
 * Builds the `execute_transaction` invoke. The component re-derives the
 * proposal id from these parameters, so they must be the exact call and salt
 * that were proposed.
 */
export const buildMultisigExecuteCall = (
  multisigAddress: string,
  call: MultisigCallInput,
  salt: string,
): Call => ({
  calldata: innerCallCalldata(call, salt),
  contractAddress: requireAddress(multisigAddress),
  entrypoint: "execute_transaction",
});

/**
 * Checks whether one more confirmation brings a pending proposal to quorum,
 * i.e. whether this signer is the last one needed and can therefore confirm
 * and execute in a single transaction. Pure: callers pass a freshly read
 * quorum and confirmation count, and the component re-checks both on-chain, so
 * a stale `true` can only waste fees — it can never bypass quorum.
 */
export const confirmationCompletesQuorum = (input: {
  readonly confirmations: number;
  readonly quorum: number;
  readonly signerHasConfirmed: boolean;
  readonly state: MultisigProposalState;
}): boolean =>
  input.state === "pending" &&
  !input.signerHasConfirmed &&
  Number.isSafeInteger(input.confirmations) &&
  input.confirmations >= 0 &&
  Number.isSafeInteger(input.quorum) &&
  input.quorum > 0 &&
  input.confirmations + 1 === input.quorum;

const feltAt = (response: readonly string[], index: number, label: string): bigint => {
  const value = response[index];
  if (typeof value !== "string" || !isStarkFieldElement(value)) {
    throw new WalletError(`Invalid multisig ${label} response`);
  }
  return BigInt(value);
};

const smallNumberAt = (response: readonly string[], index: number, label: string): number => {
  const value = Number(feltAt(response, index, label));
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new WalletError(`Invalid multisig ${label} response`);
  }
  return value;
};

/**
 * Decodes the component's `TransactionState` enum from its serialized variant
 * index. Exported for tests; unknown variants throw.
 */
export const decodeMultisigState = (variant: number): MultisigProposalState => {
  const states: readonly MultisigProposalState[] = [
    "not-found",
    "pending",
    "confirmed",
    "executed",
  ];
  const state = states[variant];
  if (!state) {
    throw new WalletError("Invalid multisig state response");
  }
  return state;
};

/**
 * Reads a multisig's quorum and signer set through Starknet RPC. Throws when
 * the contract does not expose the MultisigComponent views, which is how a
 * non-multisig address is rejected before it can be watched.
 */
export const getMultisigConfig = async ({
  address,
  rpcUrls,
}: MultisigConfigInput): Promise<MultisigConfig> => {
  const multisig = requireAddress(address);
  try {
    return await withRpcFallback(
      rpcUrls,
      async (provider) => {
        const [quorumResponse, signersResponse] = await Promise.all([
          provider.callContract(
            { calldata: [], contractAddress: multisig, entrypoint: "get_quorum" },
            "latest",
          ),
          provider.callContract(
            { calldata: [], contractAddress: multisig, entrypoint: "get_signers" },
            "latest",
          ),
        ]);
        const quorum = smallNumberAt(quorumResponse, 0, "quorum");
        const count = smallNumberAt(signersResponse, 0, "signers");
        if (
          quorum === 0 ||
          count === 0 ||
          count > MAX_SIGNERS ||
          signersResponse.length !== count + 1
        ) {
          throw new WalletError("Invalid multisig signers response");
        }
        const signers = Array.from({ length: count }, (_, index) =>
          canonicalFelt(`0x${feltAt(signersResponse, index + 1, "signers").toString(16)}`),
        );
        return { quorum, signers };
      },
      multisigReadProvider,
    );
  } catch (error) {
    if (error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)) {
      throw new WalletError(
        "Multisig verification took too long. Check the RPC endpoint and retry.",
      );
    }
    throw error;
  }
};

/**
 * Reads one proposal's lifecycle state, confirmation count, and whether the
 * given signer has confirmed it.
 */
export const getMultisigProposalStatus = async ({
  address,
  rpcUrls,
  signer,
  txId,
}: MultisigProposalStatusInput): Promise<MultisigProposalStatus> => {
  const multisig = requireAddress(address);
  const id = requireFelt(txId, "transaction id");
  const signerFelt = requireAddress(signer);
  return withRpcFallback(rpcUrls, async (provider) => {
    const [stateResponse, confirmationsResponse, confirmedByResponse] = await Promise.all([
      provider.callContract(
        { calldata: [id], contractAddress: multisig, entrypoint: "get_transaction_state" },
        "latest",
      ),
      provider.callContract(
        { calldata: [id], contractAddress: multisig, entrypoint: "get_transaction_confirmations" },
        "latest",
      ),
      provider.callContract(
        { calldata: [id, signerFelt], contractAddress: multisig, entrypoint: "is_confirmed_by" },
        "latest",
      ),
    ]);
    return {
      confirmations: smallNumberAt(confirmationsResponse, 0, "confirmations"),
      confirmedBySigner: feltAt(confirmedByResponse, 0, "confirmation") === 1n,
      state: decodeMultisigState(smallNumberAt(stateResponse, 0, "state")),
    };
  });
};

// MultisigComponent hashes a batch of calls, and the wallet only ever proposes
// one, so the chain always opens with a batch length of exactly one.
const SINGLE_CALL_BATCH = "0x1";

/**
 * Derives a proposal's transaction id locally from the inner call and salt.
 *
 * Mirrors OpenZeppelin MultisigComponent v3.0.0's `hash_transaction_batch`
 * exactly: a Pedersen chain started at 0 over the batch length, then the
 * call's `to`, selector, and calldata length, then each calldata felt, and
 * finally the salt. Pure and offline — this, not any node's answer, is the
 * wallet's binding between the call a user reviewed and the id it will confirm
 * or execute. Throws `WalletError` when the call or salt is not a well-formed
 * field element.
 */
export const multisigTransactionId = (call: MultisigCallInput, salt: string): string =>
  canonicalFelt(
    [SINGLE_CALL_BATCH, ...innerCallCalldata(call, salt)].reduce(
      (state, felt) => hash.computePedersenHash(state, felt),
      "0x0",
    ),
  );

/**
 * Checks that a stored `(call, salt)` pair really hashes to the proposal id it
 * is filed under.
 *
 * A proposal record keeps its id and its call as separate fields, so only this
 * re-derivation binds them; call it before building any `execute` invoke from
 * a stored record, including records written by an earlier version. Total by
 * design — a malformed call, salt, or id yields `false` rather than throwing,
 * so every disagreement is a plain refusal.
 */
export const multisigCallMatchesId = (
  call: MultisigCallInput,
  salt: string,
  txId: string,
): boolean => {
  try {
    return sameFelt(multisigTransactionId(call, salt), txId);
  } catch {
    return false;
  }
};

/**
 * Computes a proposal's transaction id and requires the multisig contract to
 * agree with it.
 *
 * The returned id always comes from {@link multisigTransactionId}; the
 * contract's `hash_transaction` view is read purely as a cross-check. Any node
 * that answers with a different id — because it is hostile, because it is out
 * of sync, or because the address is not the pinned MultisigComponent — makes
 * this throw `WalletError`, so no proposal id the wallet did not derive itself
 * can ever be stored, confirmed, or signed against.
 */
export const computeMultisigTransactionId = async ({
  address,
  call,
  rpcUrls,
  salt,
}: MultisigTransactionIdInput): Promise<string> => {
  const multisig = requireAddress(address);
  const calldata = innerCallCalldata(call, salt);
  const derived = multisigTransactionId(call, salt);
  const reported = await withRpcFallback(rpcUrls, async (provider) => {
    const response = await provider.callContract(
      { calldata, contractAddress: multisig, entrypoint: "hash_transaction" },
      "latest",
    );
    return feltAt(response, 0, "transaction id");
  });
  if (reported !== BigInt(derived)) {
    throw new WalletError(
      "Multisig transaction id mismatch: this endpoint's hash_transaction answer does not match the id derived from the reviewed call",
    );
  }
  return derived;
};
