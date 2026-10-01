/**
 * Official privacy SDK action-builder mapping. Keeping the five Wallet API
 * action variants here makes the service orchestration boundary small enough
 * to audit independently.
 */

import { WalletError } from "@bramble/core/errors";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { BigNumberish } from "starknet";
import { STRK20_SERVICE_UNAVAILABLE } from "../service";
import type {
  PrivacySdkRuntime,
  SdkBuilder,
  SdkCallBuilderArgs,
  SdkTransfers,
} from "./official-sdk-runtime";

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
    // Without a recipient the deposited value returns to the depositor as the
    // batch's implicit surplus; with one, the SDK adds the note explicitly. The
    // self case stays a bare deposit so it remains the exact batch the pool has
    // always received for a shield.
    return builder
      .with(action.token)
      .deposit(
        action.recipient === undefined
          ? { amount: BigInt(action.amount) }
          : { amount: BigInt(action.amount), recipient: action.recipient },
      )
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

/**
 * Maps a validated Wallet API action batch onto the pinned SDK builder.
 */
export const strk20BuilderFor = (
  sdk: PrivacySdkRuntime,
  transfers: SdkTransfers,
  actions: readonly Strk20Action[],
  surplusRecipient: string,
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
  if (actions.some((action) => action.type === "transfer" || action.type === "withdraw")) {
    builder = builder.surplusTo(surplusRecipient, false);
  }
  return builder;
};

/**
 * Creates the explicit registration builder; missing SDK support fails closed
 * before any proof or transaction can be produced.
 *
 * `autoSetup` stays on so the registration batch also opens the account's own
 * channel. The pinned SDK warns (`USER_LINKAGE`) when one batch opens more than
 * one channel and the wallet refuses on any warning, so a registration that left
 * the self channel unopened made the account's first shield to another wallet
 * need two channels at once, and it always failed as a privacy leak.
 */
export const strk20RegistrationBuilderFor = (transfers: SdkTransfers): SdkBuilder => {
  const builder = transfers.build({
    autoDiscover: { channels: "refresh", notes: "refresh" },
    autoRegister: false,
    autoSelectNotes: "naive",
    autoSetup: true,
    registryConst: true,
  });
  if (!builder.register) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return builder.register();
};
