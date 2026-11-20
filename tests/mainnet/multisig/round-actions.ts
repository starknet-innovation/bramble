/**
 * The multisig's own actions in a privacy round, each driven to a successful
 * mainnet receipt: registration and deposit as co-signed account transactions,
 * transfer and withdrawal as co-signed private relays, and the public sweep.
 * Every fee the wallet quotes is checked against its ceiling before a second
 * signature is collected.
 */
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { waitForSuccessfulReceipt } from "../../live/chain";
import { mainnetToken } from "../local-mainnet-chain";
import { feeRefusal, ROUND_LIMITS, sweepableAmount } from "./round-budget";
import { publicStrk, strkLabel, strkTransferCall } from "./round-chain";
import {
  cardIn,
  cosignIntent,
  cosignPrivateCard,
  type FeeReview,
  readPanel,
  submitIntent,
  syncUntil,
} from "./round-cosign";
import { callWallet, type OwnerWallet, tryWallet } from "./round-wallets";

const INDEXER_TIMEOUT_MS = 5 * 60_000;
const INDEXER_INTERVAL_MS = 5_000;
const SETTLE_TIMEOUT_MS = 90_000;
const MAX_PREPARES = 8;
const PROVER_ATTEMPTS = 3;
const PROVER_RETRY_DELAY_MS = 30_000;
const TRANSIENT_PROVER = /Proving service HTTP (?:429|50[234])\b|-32005 rate limit exceeded/i;
// What the wallet says while the privacy indexer has not caught up with the
// multisig's registration. The SDK names the self channel "missing channel
// context" when it compiles a deposit before the indexer knows the channel
// the registration opened; compiling fails before anything is signed.
const NOT_YET_INDEXED =
  /regist|preflight|private balances unavailable|not found|missing channel context/i;

/** The multisig under test and the two wallets that co-own it. */
export type RoundContext = {
  readonly a: OwnerWallet;
  readonly b: OwnerWallet;
  readonly multisigAddress: string;
  readonly multisigId: string;
  readonly rpcUrl: string;
};

/** One private action, with amounts in FRI. */
export type PrivateRequest =
  | { readonly amount: bigint; readonly kind: "deposit" }
  | { readonly amount: bigint; readonly kind: "transfer" | "withdraw"; readonly recipient: string }
  | { readonly kind: "register" };

type PrepareReply = {
  readonly feeReview?: FeeReview;
  readonly id?: string;
  readonly intent?: { readonly id: string };
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const prepareMessage = (context: RoundContext, request: PrivateRequest) => ({
  kind: request.kind,
  multisigId: context.multisigId,
  type: "wallet.prepareArgentMultisigStrk20",
  ...(request.kind === "register"
    ? {}
    : { amount: strkLabel(request.amount), tokenId: mainnetToken("STRK").id }),
  ...("recipient" in request ? { recipient: request.recipient } : {}),
});

// One prepare, patient with a prover that is briefly overloaded and, right
// after a registration, with an indexer that has not seen it yet.
const prepare = async (context: RoundContext, request: PrivateRequest): Promise<PrepareReply> => {
  const indexerDeadline = Date.now() + INDEXER_TIMEOUT_MS;
  for (let proverAttempt = 1; ; ) {
    const result = await tryWallet<PrepareReply>(context.a.page, prepareMessage(context, request));
    if ("reply" in result) {
      return result.reply;
    }
    if (TRANSIENT_PROVER.test(result.error) && proverAttempt < PROVER_ATTEMPTS) {
      proverAttempt += 1;
      await pause(PROVER_RETRY_DELAY_MS);
      continue;
    }
    if (
      request.kind !== "register" &&
      NOT_YET_INDEXED.test(result.error) &&
      Date.now() < indexerDeadline
    ) {
      await pause(INDEXER_INTERVAL_MS);
      continue;
    }
    throw new Error(result.error);
  }
};

const pullOnce = async (wallet: OwnerWallet, multisigId: string): Promise<void> => {
  await tryWallet(wallet.page, { multisigId, type: "wallet.syncArgentMultisigIntents" });
};

/**
 * Prepares `request` in owner A's wallet and collects owner B's signatures
 * until it is a transaction to co-sign or a relay to send. The pool CallSet is
 * authorized first; a relay's typed data is authorized second. Throws when the
 * CallSet digest differs between prepares, because co-owners could then never
 * authorize it, and when either round does not complete.
 */
const authorizePrivateAction = async (
  context: RoundContext,
  request: PrivateRequest,
): Promise<
  | { readonly fee: FeeReview; readonly intentId: string; readonly kind: "intent" }
  | { readonly id: string; readonly kind: "relay" }
> => {
  const { a, b, multisigId } = context;
  const authorized = new Set<string>();
  for (let attempt = 0; attempt < MAX_PREPARES; attempt += 1) {
    const reply = await prepare(context, request);
    if (reply.intent && reply.feeReview) {
      return { fee: reply.feeReview, intentId: reply.intent.id, kind: "intent" };
    }
    const id = reply.id;
    if (!id) {
      throw new Error(`The wallet prepared ${request.kind} without an id or a transaction.`);
    }
    const relay = cardIn((await readPanel(a, multisigId)).relays, id);
    if (relay) {
      if (relay.offer !== "send") {
        await cosignPrivateCard(a, b, multisigId, id, "relays");
        await syncUntil(a, multisigId, "the co-owner's relay signature", async () => {
          const card = cardIn((await readPanel(a, multisigId)).relays, id);
          return card?.offer === "send" ? card : null;
        });
      }
      return { id, kind: "relay" };
    }
    if (!authorized.has(id)) {
      if (authorized.size >= 2) {
        throw new Error(
          `The pool CallSet for ${request.kind} hashed differently on each prepare, so a co-owner's signature never matches the next one.`,
        );
      }
      await cosignPrivateCard(a, b, multisigId, id, "authorizations");
      authorized.add(id);
    }
    // B's signature travels back over Nostr; pull, then prepare again.
    await pause(4_000);
    await pullOnce(a, multisigId);
  }
  throw new Error(`Owner A never held both signatures for the ${request.kind} CallSet.`);
};

const requireFee = (fee: FeeReview, ceiling: bigint, what: string): void => {
  const refusal = feeRefusal(fee, ceiling, what);
  if (refusal) throw new Error(refusal);
};

/**
 * Registers the multisig with the pool, or deposits into it: proves, checks
 * the quoted fee, collects both signatures on the transaction, submits it and
 * waits for a successful receipt. Returns the transaction hash.
 */
export const sendAccountAction = async (
  context: RoundContext,
  request: Extract<PrivateRequest, { readonly kind: "deposit" | "register" }>,
): Promise<string> => {
  const ready = await authorizePrivateAction(context, request);
  if (ready.kind !== "intent") {
    throw new Error(`The wallet prepared ${request.kind} as a relay, not a transaction.`);
  }
  requireFee(ready.fee, ROUND_LIMITS.maxProofTxFee, request.kind);
  await cosignIntent(context.a, context.b, context.multisigId, ready.intentId);
  const hash = await submitIntent(context.a, ready.intentId);
  await waitForSuccessfulReceipt(context.rpcUrl, hash);
  return hash;
};

/**
 * Transfers or withdraws from the multisig's private balance through the
 * private relay: proves, collects both owners' signatures, sends once and
 * waits for a successful receipt. Returns the transaction hash.
 */
export const sendRelayAction = async (
  context: RoundContext,
  request: Extract<PrivateRequest, { readonly kind: "transfer" | "withdraw" }>,
): Promise<string> => {
  const ready = await authorizePrivateAction(context, request);
  if (ready.kind !== "relay") {
    throw new Error(`The wallet prepared ${request.kind} as a transaction, not a relay.`);
  }
  const sent = await callWallet<{ readonly transactionHash: string }>(context.a.page, {
    id: ready.id,
    type: "wallet.submitArgentMultisigStrk20Relay",
  });
  await waitForSuccessfulReceipt(context.rpcUrl, sent.transactionHash);
  return sent.transactionHash;
};

/**
 * The multisig's private STRK as `wallet` reads it with the shared viewing
 * key, in FRI. Zero when the pool reports none, or when the read failed: the
 * panel does not tell those apart, so callers poll.
 */
export const privateStrk = async (wallet: OwnerWallet, multisigId: string): Promise<bigint> => {
  const held = (await readPanel(wallet, multisigId)).balances.find((entry) =>
    sameFelt(entry.token, STRK_TOKEN_ADDRESS),
  );
  return held ? BigInt(held.balance) : 0n;
};

/**
 * Waits until `wallet` reads a private STRK balance `accept` takes, and
 * returns it. Throws the last balance read when the indexer never gets there.
 */
export const waitForPrivateStrk = async (
  wallet: OwnerWallet,
  multisigId: string,
  accept: (balance: bigint) => boolean,
): Promise<bigint> => {
  const deadline = Date.now() + INDEXER_TIMEOUT_MS;
  let seen = 0n;
  while (Date.now() < deadline) {
    seen = await privateStrk(wallet, multisigId);
    if (accept(seen)) {
      return seen;
    }
    await pause(INDEXER_INTERVAL_MS);
  }
  throw new Error(
    `Owner ${wallet.role.toUpperCase()} still reads a private balance of ${strkLabel(seen)} STRK.`,
  );
};

/**
 * The private STRK balance once three reads in a row agree, so a note the
 * indexer has not reached yet, or one failed read, is not taken for the
 * balance. Returns the last read if the reads never agree in time.
 */
export const settledPrivateStrk = async (
  wallet: OwnerWallet,
  multisigId: string,
): Promise<bigint> => {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last = await privateStrk(wallet, multisigId);
  for (let agreeing = 1; agreeing < 3 && Date.now() < deadline; ) {
    await pause(INDEXER_INTERVAL_MS);
    const next = await privateStrk(wallet, multisigId);
    agreeing = next === last ? agreeing + 1 : 1;
    last = next;
  }
  return last;
};

type IntentReply = { readonly feeReview: FeeReview; readonly intent: { readonly id: string } };

const prepareTransfer = (
  context: RoundContext,
  recipient: string,
  amount: bigint,
): Promise<IntentReply> =>
  callWallet<IntentReply>(context.a.page, {
    calls: [strkTransferCall(recipient, amount)],
    multisigId: context.multisigId,
    type: "wallet.prepareArgentMultisigIntent",
  });

/**
 * Sends the multisig's public STRK to `recipient` as an ordinary co-signed
 * transfer, keeping back only what its own fee may need. A first prepare
 * prices the transfer and is discarded; the second names the amount. Returns
 * the hash and the amount, or null when the balance cannot pay for a sweep.
 */
export const sweepPublicStrk = async (
  context: RoundContext,
  recipient: string,
): Promise<{ readonly amount: bigint; readonly transactionHash: string } | null> => {
  const balance = await publicStrk(context.rpcUrl, context.multisigAddress);
  if (balance <= ROUND_LIMITS.maxTransferFee / 10n) {
    return null;
  }
  const priced = await prepareTransfer(context, recipient, 1n);
  await callWallet(context.a.page, {
    intentId: priced.intent.id,
    type: "wallet.removeArgentMultisigIntent",
  });
  if (priced.feeReview.unit !== "FRI") {
    throw new Error("The sweep is not priced in STRK. Nothing was sent.");
  }
  const amount = sweepableAmount(balance, BigInt(priced.feeReview.overallFee));
  if (amount === null) {
    return null;
  }
  const prepared = await prepareTransfer(context, recipient, amount);
  requireFee(prepared.feeReview, ROUND_LIMITS.maxTransferFee, "sweep");
  await cosignIntent(context.a, context.b, context.multisigId, prepared.intent.id);
  const transactionHash = await submitIntent(context.a, prepared.intent.id);
  await waitForSuccessfulReceipt(context.rpcUrl, transactionHash);
  return { amount, transactionHash };
};
