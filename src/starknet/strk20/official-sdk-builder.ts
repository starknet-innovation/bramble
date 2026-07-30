/**
 * Official privacy SDK action-builder mapping. Keeping the five Wallet API
 * action variants here makes the service orchestration boundary small enough
 * to audit independently.
 */

import type { BigNumberish } from "starknet";
import { WalletError } from "../../shared/errors";
import type {
  PrivacySdkRuntime,
  SdkBuilder,
  SdkCallBuilderArgs,
  SdkTransfers,
} from "./official-sdk-runtime";
import type { Strk20Action } from "./schemas";
import { STRK20_SERVICE_UNAVAILABLE } from "./service";

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

/**
 * Maps a validated Wallet API action batch onto the pinned SDK builder.
 */
export const strk20BuilderFor = (
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

/**
 * Creates the explicit registration-only builder; missing SDK support fails
 * closed before any proof or transaction can be produced.
 */
export const strk20RegistrationBuilderFor = (transfers: SdkTransfers): SdkBuilder => {
  const builder = transfers.build({
    autoDiscover: { channels: "refresh", notes: "refresh" },
    autoRegister: false,
    autoSelectNotes: "naive",
    autoSetup: false,
    registryConst: true,
  });
  if (!builder.register) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return builder.register();
};
