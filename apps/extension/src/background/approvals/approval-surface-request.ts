/** Pure validation for requests allowed to raise an approval surface. */

import { isTypedDataShape } from "@bramble/starknet/typed-data";
import { readRequestAccountsInput } from "../accounts/request-accounts-input";
import {
  readStrk20BalancesMessage,
  readStrk20InvokeMessage,
  readStrk20PrepareMessage,
  readStrk20RegisterMessage,
  readStrk20SubaccountMessage,
} from "../privacy/strk20-provider-inputs";
import { readAddStarknetChainInput } from "../provider/add-chain-ops";
import { readWatchAssetInput } from "../provider/provider-inputs";
import {
  readAddInvokeTransactionInput,
  readSignTypedDataInput,
  readSwitchChainInput,
} from "../routing/message-inputs";
import { readAddDeclareTransactionInput } from "../transactions/declare-ops";

type ApprovalSurfaceRequest = { readonly origin: string; readonly silent: boolean };

/**
 * Reuses the execution boundary's exact parser for each surface-capable dapp
 * request. Invalid payloads cannot raise wallet UI before asynchronous routing.
 */
export const readApprovalSurfaceRequest = (message: unknown): ApprovalSurfaceRequest | null => {
  const accounts = readRequestAccountsInput(message);
  if (accounts) return accounts;

  const sign = readSignTypedDataInput(message);
  if (sign) {
    return isTypedDataShape(sign.typedData) ? { origin: sign.origin, silent: false } : null;
  }

  const parsed =
    readAddInvokeTransactionInput(message) ??
    readAddStarknetChainInput(message) ??
    readAddDeclareTransactionInput(message) ??
    readWatchAssetInput(message) ??
    readSwitchChainInput(message) ??
    readStrk20RegisterMessage(message) ??
    readStrk20BalancesMessage(message) ??
    readStrk20PrepareMessage(message) ??
    readStrk20InvokeMessage(message) ??
    readStrk20SubaccountMessage(message);
  return parsed ? { origin: parsed.origin, silent: false } : null;
};
