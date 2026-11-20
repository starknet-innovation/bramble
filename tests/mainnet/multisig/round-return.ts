/**
 * Sends what the round's multisig still holds back to the funding account:
 * first its private balance, through a co-signed relayed withdrawal, then its
 * public STRK, through a co-signed transfer. Used at the end of a round, after
 * a round that failed, and for a round an earlier run left unfinished.
 */
import {
  type RoundContext,
  sendRelayAction,
  settledPrivateStrk,
  sweepPublicStrk,
} from "./round-actions";
import { withdrawableAmount } from "./round-budget";
import { callWallet } from "./round-wallets";

/** What one return pass moved, in FRI. Null means that leg had nothing to move. */
export type ReturnedFunds = {
  readonly swept: bigint | null;
  readonly withdrawn: bigint | null;
};

/**
 * Withdraws the private STRK that can pay for its own withdrawal to
 * `recipient`. Skipped when owner A does not hold the viewing key, since the
 * balance cannot be read without it. `observedActionCost` is what an earlier
 * relayed action cost, when the round measured one. Returns the amount named.
 */
export const withdrawPrivateStrk = async (
  context: RoundContext,
  recipient: string,
  poolFee: bigint,
  observedActionCost: bigint | null,
): Promise<bigint | null> => {
  const key = await callWallet<{ readonly state: string }>(context.a.page, {
    multisigId: context.multisigId,
    type: "wallet.argentMultisigStrk20KeyStatus",
  });
  if (key.state !== "held") {
    return null;
  }
  const amount = withdrawableAmount(
    await settledPrivateStrk(context.a, context.multisigId),
    poolFee,
    observedActionCost,
  );
  if (amount === null) {
    return null;
  }
  await sendRelayAction(context, { amount, kind: "withdraw", recipient });
  return amount;
};

/**
 * Runs both legs. A failed withdrawal does not stop the sweep, so public STRK
 * still goes back; the withdrawal's error is rethrown after the sweep.
 */
export const returnFunds = async (
  context: RoundContext,
  recipient: string,
  poolFee: bigint,
  observedActionCost: bigint | null,
): Promise<ReturnedFunds> => {
  let withdrawn: bigint | null = null;
  let withdrawFailure: unknown = null;
  try {
    withdrawn = await withdrawPrivateStrk(context, recipient, poolFee, observedActionCost);
  } catch (error) {
    withdrawFailure = error;
  }
  const swept = await sweepPublicStrk(context, recipient);
  if (withdrawFailure !== null) {
    throw withdrawFailure;
  }
  return { swept: swept?.amount ?? null, withdrawn };
};
