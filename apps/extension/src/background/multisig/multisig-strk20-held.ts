/**
 * Held proof requests for multisig STRK20 actions. The privacy SDK draws new
 * random values every time it compiles, so a request is compiled once, kept
 * while co-owners sign its pool authorization, and later proved exactly as
 * compiled. The kept row holds no calldata: it is rebuilt from the stored
 * authorization's calls, whose digest every fragment was verified against.
 */

import { WalletError } from "@bramble/core/errors";
import { isRecord, type Json } from "@bramble/core/json";
import { strk20ProofSubmittable } from "@bramble/privacy/multisig-proof-window";
import {
  type MultisigStrk20ActionRequest,
  type MultisigStrk20Authorization,
  multisigStrk20CallSetAggregate,
} from "@bramble/privacy/multisig-strk20";
import { sameMultisigSignerSet } from "@bramble/privacy/multisig-strk20-binding";
import {
  multisigStrk20ExecuteCalldata,
  multisigStrk20HeldEnvelope,
  multisigStrk20HeldPlan,
  sameMultisigStrk20Felts,
} from "@bramble/privacy/multisig-strk20-held";
import { restoreStrk20Calldata } from "@bramble/privacy/multisig-strk20-redaction";
import type { MultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import type { Strk20HeldProofRequest } from "@bramble/privacy/service";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { num } from "starknet";

const HELD_PROOF_INVALID = "Invalid Argent multisig private proof";

// A relay plan is resumed only while its paymaster authorization has this
// long left: co-owners still sign the relay's typed data, and the relay has to
// accept it, after the proof is made.
const RELAY_PLAN_MARGIN_SECONDS = 120n;

/**
 * True while a stored relay fee plan can still be sent: it names no
 * authorization window, or that window closes more than the margin from
 * `nowSeconds`. A malformed deadline is not live.
 */
export const isRelayPlanLive = (plan: unknown, nowSeconds: number): boolean => {
  if (!isRecord(plan) || !isRecord(plan["authorization"])) return true;
  const before = plan["authorization"]["executeBefore"];
  if (typeof before !== "string") return false;
  try {
    return BigInt(before) > BigInt(nowSeconds) + RELAY_PLAN_MARGIN_SECONDS;
  } catch {
    return false;
  }
};

/** A held request whose signature is complete, ready to prove. */
export type MultisigStrk20Resumed = {
  /** The authorization it is signed under. */
  readonly id: string;
  /** The relay fee plan it was compiled with. Absent for an account action. */
  readonly plan?: { readonly [key: string]: Json };
  readonly request: Strk20HeldProofRequest;
};

/** The live signer set an aggregate is ordered by. */
type SignerSet = { readonly signerPublicKeys: readonly string[]; readonly threshold: number };

// The `__execute__` calldata of the authorization's one pool call, with the
// scalar put back. Null for anything else.
const executeCalldata = (
  authorization: MultisigStrk20Authorization,
  scalar: string,
): readonly string[] | null => {
  const [call] = authorization.calls;
  if (!call || authorization.calls.length !== 1) return null;
  const calldata = restoreStrk20Calldata(call.calldata, scalar);
  return calldata ? multisigStrk20ExecuteCalldata({ ...call, calldata }) : null;
};

const signed = (
  request: Strk20HeldProofRequest,
  calldata: readonly string[],
  authorization: MultisigStrk20Authorization,
  signers: SignerSet,
): Strk20HeldProofRequest => ({
  invocation: {
    ...request.invocation,
    calldata: [...calldata],
    // As starknet.js formatSignature writes them: the prover reads only 0x hex,
    // and the aggregate's leading signer count is a decimal string.
    signature: multisigStrk20CallSetAggregate(authorization.fragments, signers).map((felt) =>
      num.toHex(felt),
    ),
  },
  provingBlock: request.provingBlock,
});

const optionalFelt = (value: string | undefined): string | null =>
  value === undefined ? null : canonicalFelt(value);

const sameRequest = (
  left: MultisigStrk20ActionRequest,
  right: MultisigStrk20ActionRequest,
): boolean =>
  left.kind === right.kind &&
  optionalFelt(left.amount) === optionalFelt(right.amount) &&
  optionalFelt(left.token) === optionalFelt(right.token) &&
  optionalFelt(left.recipient) === optionalFelt(right.recipient);

/**
 * Handles a freshly compiled request. When its authorization already holds
 * the threshold, returns it with the aggregate as its signature. Otherwise
 * keeps it and returns `waiting`. Throws when the compiled calldata is not
 * the call the authorization digest covers.
 */
export const holdCompiledStrk20Request = async (input: {
  readonly authorization: MultisigStrk20Authorization | null;
  readonly isAuthorized: () => boolean;
  readonly plan: unknown;
  readonly request: Strk20HeldProofRequest;
  readonly scalar: string;
  readonly signers: SignerSet;
  readonly store: MultisigStrk20Store;
}): Promise<Strk20HeldProofRequest | "waiting"> => {
  const { authorization, request } = input;
  const calldata = authorization ? executeCalldata(authorization, input.scalar) : null;
  const compiled = request.invocation["calldata"];
  if (
    !authorization ||
    !calldata ||
    !Array.isArray(compiled) ||
    !sameMultisigStrk20Felts(compiled, calldata)
  ) {
    throw new WalletError(HELD_PROOF_INVALID);
  }
  if (authorization.state === "ready") {
    return signed(request, calldata, authorization, input.signers);
  }
  const envelope = multisigStrk20HeldEnvelope(request.invocation);
  const plan = input.plan === undefined ? undefined : multisigStrk20HeldPlan(input.plan);
  if (!envelope || plan === null) throw new WalletError(HELD_PROOF_INVALID);
  const stored = await input.store.putHeld(
    {
      accountId: authorization.accountId,
      envelope,
      id: authorization.id,
      ...(plan ? { plan } : {}),
      provingBlock: request.provingBlock,
    },
    input.isAuthorized,
  );
  if (stored === "unauthorized") throw new WalletError("wallet locked");
  if (stored !== "stored") throw new WalletError(HELD_PROOF_INVALID);
  return "waiting";
};

// The authorization `id` names when it holds the threshold for this exact
// action, with the calldata it covers.
const readyFor = async (
  input: {
    readonly action: MultisigStrk20ActionRequest;
    readonly scalar: string;
    readonly store: MultisigStrk20Store;
  },
  id: string,
): Promise<{
  readonly authorization: MultisigStrk20Authorization;
  readonly calldata: readonly string[];
} | null> => {
  const authorization = await input.store.getAuthorization(id, input.scalar);
  if (authorization?.state !== "ready" || !sameRequest(authorization.request, input.action)) {
    return null;
  }
  const calldata = executeCalldata(authorization, input.scalar);
  return calldata ? { authorization, calldata } : null;
};

// A relay whose fee authorization has lapsed would be proved and then refused
// at signing, every time; it is dropped so the action is quoted again.
const droppedAsLapsed = async (
  input: { readonly nowSeconds: number; readonly store: MultisigStrk20Store },
  row: { readonly id: string; readonly plan?: unknown },
): Promise<boolean> => {
  if (row.plan === undefined || isRelayPlanLive(row.plan, input.nowSeconds)) return false;
  await input.store.dropHeld(row.id);
  return true;
};

// A held request that can no longer be proved: its authorization was signed
// for a signer set or threshold the multisig no longer has (the aggregate
// would not serialize), or its block is past the pool's proof window; it is
// dropped so the action is compiled and signed again.
const droppedAsStale = async (
  input: {
    readonly readWindow: () => Promise<{
      readonly currentBlock: bigint;
      readonly validityBlocks: bigint;
    }>;
    readonly signers: SignerSet;
    readonly store: MultisigStrk20Store;
  },
  row: { readonly id: string; readonly provingBlock: number },
  authorization: MultisigStrk20Authorization,
): Promise<boolean> => {
  const sameSigners =
    authorization.threshold === input.signers.threshold &&
    sameMultisigSignerSet(authorization.signerPublicKeys, input.signers.signerPublicKeys);
  const live =
    sameSigners &&
    strk20ProofSubmittable({ baseBlock: BigInt(row.provingBlock), ...(await input.readWindow()) });
  if (!live) await input.store.dropHeld(row.id);
  return !live;
};

/**
 * The newest held request for `action` whose authorization now holds the
 * threshold under the multisig's current signer set, and whose block is still
 * inside the pool's proof window; a held request that fails either is dropped,
 * so the action is compiled and signed again. A relay action is resumed only
 * with the fee plan it was compiled with, and only while that plan's
 * authorization is live; a lapsed one is dropped.
 */
export const findResumableStrk20Request = async (input: {
  readonly accountId: string;
  readonly action: MultisigStrk20ActionRequest;
  readonly nowSeconds: number;
  readonly readWindow: () => Promise<{
    readonly currentBlock: bigint;
    readonly validityBlocks: bigint;
  }>;
  readonly scalar: string;
  readonly signers: SignerSet;
  readonly store: MultisigStrk20Store;
}): Promise<MultisigStrk20Resumed | null> => {
  const relay = input.action.kind === "transfer" || input.action.kind === "withdraw";
  const held = [...(await input.store.listHeld(input.accountId))].reverse();
  for (const row of held) {
    if (relay !== (row.plan !== undefined)) continue;
    if (await droppedAsLapsed(input, row)) continue;
    const ready = await readyFor(input, row.id);
    if (!ready || (await droppedAsStale(input, row, ready.authorization))) continue;
    const request = signed(
      { invocation: row.envelope, provingBlock: row.provingBlock },
      ready.calldata,
      ready.authorization,
      input.signers,
    );
    return { id: row.id, ...(row.plan ? { plan: row.plan } : {}), request };
  }
  return null;
};
