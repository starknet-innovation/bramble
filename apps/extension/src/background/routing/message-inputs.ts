/** Pure parsers for untrusted background runtime messages. */
import { hasOnlyKnownKeys, isDecimalAmountText, isRecord } from "@bramble/core/json";
import { normalizeWalletOrigin } from "@bramble/core/origin";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import {
  type AccountContractType,
  isAccountId,
  isCreatableAccountContractType,
} from "@bramble/wallet-model/accounts";
import {
  isHexChainId,
  isStarkFieldElement,
  isStarknetNetworkId,
  STARK_FIELD_PRIME,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import { isVaultPassphrase } from "@bramble/wallet-model/passphrase";
import { INVOKE_LIMITS } from "@bramble/wallet-protocol/invoke-limits";
import { isStrk20Proof, type Strk20Proof } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";

export { readCreateAccountInput } from "../accounts/account-creation-inputs";

/**
 * Checks a human-entered decimal token amount string (shared by the transfer
 * and swap input readers; parsing/scaling happens later via parseTokenAmount).
 */
export const isTransferAmount = (value: unknown): value is string =>
  typeof value === "string" && isDecimalAmountText(value.trim());

const isFeltLikeString = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    value.length > INVOKE_LIMITS.feltCharacters ||
    !/^(?:0x[0-9a-fA-F]+|0|[1-9][0-9]*)$/.test(value)
  ) {
    return false;
  }
  return BigInt(value) < STARK_FIELD_PRIME;
};

const isEntrypoint = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= INVOKE_LIMITS.entrypointCharacters &&
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

const readInvokeCall = (value: unknown): Call | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["calldata", "contractAddress", "entrypoint"]) ||
    !isFeltLikeString(value["contractAddress"]) ||
    BigInt(value["contractAddress"]) <= 0n ||
    !isEntrypoint(value["entrypoint"]) ||
    !Array.isArray(value["calldata"]) ||
    value["calldata"].length > INVOKE_LIMITS.calldataFelts ||
    !value["calldata"].every(isFeltLikeString)
  ) {
    return null;
  }

  return {
    calldata: [...value["calldata"]],
    contractAddress: value["contractAddress"],
    entrypoint: value["entrypoint"],
  };
};

/**
 * Parses no-payload runtime messages by exact type.
 */
export const readTypeOnlyInput = (message: unknown, type: string): boolean =>
  isRecord(message) && hasOnlyKnownKeys(message, ["type"]) && message["type"] === type;

// A Starknet name is a dotted list of 1-48 character labels plus the `.stark`
// suffix; the bound leaves comfortable room while keeping an untrusted string
// out of the RPC call.
const MAX_STARK_NAME_CHARACTERS = 128;

/**
 * Parses the name-resolution reader's typed Starknet name and the network it
 * is being read on. The network travels with the request so the background can
 * refuse a read the panel made for a different chain than its own active one.
 */
export const readStarkNameInput = (
  message: unknown,
): { readonly name: string; readonly networkId: StarknetNetworkId } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["name", "networkId", "type"]) &&
  message["type"] === "wallet.resolveStarkName" &&
  typeof message["name"] === "string" &&
  message["name"].trim().length > 0 &&
  message["name"].length <= MAX_STARK_NAME_CHARACTERS &&
  isStarknetNetworkId(message["networkId"])
    ? { name: message["name"], networkId: message["networkId"] }
    : null;

/**
 * Parses the balance reader's optional local-snapshot request.
 */
export const readBalancesInput = (
  message: unknown,
): { readonly cached: boolean; readonly refresh: boolean } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["cached", "refresh", "type"]) &&
  message["type"] === "wallet.getBalances" &&
  (message["cached"] === undefined || message["cached"] === true) &&
  (message["refresh"] === undefined || message["refresh"] === true) &&
  !(message["cached"] === true && message["refresh"] === true)
    ? { cached: message["cached"] === true, refresh: message["refresh"] === true }
    : null;

/**
 * Parses the fiat-price reader's optional local-snapshot request.
 */
export const readPricesInput = (message: unknown): { readonly cached: boolean } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["cached", "type"]) &&
  message["type"] === "wallet.prices" &&
  (message["cached"] === undefined || message["cached"] === true)
    ? { cached: message["cached"] === true }
    : null;

/**
 * Parses a wallet-initiated action whose first call requests a fee review and
 * whose confirming call echoes that exact reviewed fee.
 */
export const readFeeReviewInput = (
  message: unknown,
  type: string,
): { readonly reviewedFee?: FeeEstimate } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["reviewedFee", "type"]) &&
  message["type"] === type &&
  (message["reviewedFee"] === undefined || isFeeEstimate(message["reviewedFee"]))
    ? {
        ...(isFeeEstimate(message["reviewedFee"]) ? { reviewedFee: message["reviewedFee"] } : {}),
      }
    : null;
/** Parses a scoped activity read and its bounded history-refresh intent. */
export const readActivityInput = (
  message: unknown,
): {
  readonly accountId?: string;
  readonly cached: boolean;
  readonly forceHistory: boolean;
  readonly refreshHistory: boolean;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["accountId", "cached", "forceHistory", "refreshHistory", "type"]) ||
    message["type"] !== "wallet.activity" ||
    (message["cached"] !== undefined && message["cached"] !== true) ||
    (message["forceHistory"] !== undefined && message["forceHistory"] !== true) ||
    (message["refreshHistory"] !== undefined && message["refreshHistory"] !== true) ||
    (message["forceHistory"] === true && message["refreshHistory"] !== true) ||
    (message["accountId"] !== undefined && !isAccountId(message["accountId"]))
  ) {
    return null;
  }
  return {
    ...(message["accountId"] === undefined ? {} : { accountId: message["accountId"] }),
    cached: message["cached"] === true,
    forceHistory: message["forceHistory"] === true,
    refreshHistory: message["refreshHistory"] === true,
  };
};
/**
 * Parses connected-site revocation messages and normalizes the origin.
 */
export const readRevokeOriginInput = (message: unknown): { readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type"]) ||
    message["type"] !== "wallet.revokeOrigin"
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { origin } : null;
};
/**
 * Parses account-read messages and optional extension-page passphrases.
 */
export const readGetGrantedAccountsInput = (
  message: unknown,
): { readonly origin: string; readonly vaultPassphrase?: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type", "vaultPassphrase"]) ||
    message["type"] !== "wallet.getGrantedAccounts" ||
    (message["vaultPassphrase"] !== undefined && !isVaultPassphrase(message["vaultPassphrase"]))
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message["origin"]);
  if (!origin) {
    return null;
  }

  return {
    origin,
    ...(message["vaultPassphrase"] === undefined
      ? {}
      : { vaultPassphrase: message["vaultPassphrase"] }),
  };
};

export { readApprovalIdInput } from "./approval-decision-inputs";

/**
 * Parses an origin-bearing dapp message of a given type (`{ origin, type }`)
 * from content-script traffic, normalizing the origin.
 */
export const readOriginRequestInput = (
  message: unknown,
  type: string,
): { readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type"]) ||
    message["type"] !== type
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { origin } : null;
};

export { readRequestAccountsInput } from "../accounts/request-accounts-input";

/**
 * Parses dapp invoke transaction requests from content-script traffic.
 */
export const readAddInvokeTransactionInput = (
  message: unknown,
): {
  readonly calls: readonly Call[];
  readonly origin: string;
  readonly proof?: Strk20Proof;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["calls", "origin", "proof", "type"]) ||
    message["type"] !== "wallet.addInvokeTransaction" ||
    !Array.isArray(message["calls"]) ||
    message["calls"].length === 0 ||
    message["calls"].length > INVOKE_LIMITS.calls
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message["origin"]);
  const calls = message["calls"].map(readInvokeCall);
  const proof = message["proof"];
  return origin &&
    calls.every((call): call is Call => call !== null) &&
    (proof === undefined || isStrk20Proof(proof))
    ? { calls, origin, ...(proof === undefined ? {} : { proof }) }
    : null;
};

/**
 * Parses active-account selection messages from extension pages.
 */
export const readSetActiveAccountInput = (
  message: unknown,
): { readonly accountId: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["accountId", "type"]) ||
    message["type"] !== "wallet.setActiveAccount" ||
    !isAccountId(message["accountId"])
  ) {
    return null;
  }

  return {
    accountId: message["accountId"],
  };
};

/**
 * Parses active-network selection messages from extension pages.
 */
export const readSetActiveNetworkInput = (
  message: unknown,
): { readonly networkId: StarknetNetworkId } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["networkId", "type"]) ||
    message["type"] !== "wallet.setActiveNetwork" ||
    !isStarknetNetworkId(message["networkId"])
  ) {
    return null;
  }

  return {
    networkId: message["networkId"],
  };
};

/**
 * Parses add-account messages; the passphrase comes from the unlocked session,
 * not the message, so only the target network is carried.
 */
export const readAddAccountInput = (
  message: unknown,
): {
  readonly accountContractType: AccountContractType;
  readonly networkId: StarknetNetworkId;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["accountContractType", "networkId", "type"]) ||
    message["type"] !== "wallet.addAccount" ||
    !isCreatableAccountContractType(message["accountContractType"]) ||
    !isStarknetNetworkId(message["networkId"])
  ) {
    return null;
  }

  return {
    accountContractType: message["accountContractType"],
    networkId: message["networkId"],
  };
};

/**
 * Parses dapp chain-switch requests from content-script traffic.
 */
export const readSwitchChainInput = (
  message: unknown,
): { readonly chainId: string; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["chainId", "origin", "type"]) ||
    message["type"] !== "wallet.switchChain" ||
    !isHexChainId(message["chainId"])
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { chainId: message["chainId"], origin } : null;
};

/**
 * Parses ERC20 transfer messages from extension pages.
 */
const readTransferFields = (
  message: unknown,
  type: "wallet.reviewTransfer" | "wallet.transfer",
): {
  readonly accountId: string;
  readonly amount: string;
  readonly recipient: string;
  /**
   * The fee the review step displayed, echoed back by the panel on send. The
   * background turns it into a signing ceiling (MCW-V09-119); absent means the
   * caller reviewed no fee and the send is bounded only by the node's quote.
   */
  readonly reviewedDeploymentFee?: FeeEstimate;
  readonly reviewedFee?: FeeEstimate;
  readonly speed: "fast" | "standard";
  readonly tokenId: string;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountId",
      "amount",
      "recipient",
      "reviewedDeploymentFee",
      "reviewedFee",
      "speed",
      "tokenId",
      "type",
    ]) ||
    message["type"] !== type ||
    !isAccountId(message["accountId"]) ||
    !isTransferAmount(message["amount"]) ||
    typeof message["recipient"] !== "string" ||
    !isStarkFieldElement(message["recipient"]) ||
    typeof message["tokenId"] !== "string" ||
    message["tokenId"].length === 0 ||
    (message["reviewedDeploymentFee"] !== undefined &&
      !isFeeEstimate(message["reviewedDeploymentFee"])) ||
    (message["reviewedFee"] !== undefined && !isFeeEstimate(message["reviewedFee"])) ||
    (message["speed"] !== undefined &&
      message["speed"] !== "fast" &&
      message["speed"] !== "standard")
  ) {
    return null;
  }

  return {
    accountId: message["accountId"],
    amount: message["amount"].trim(),
    recipient: message["recipient"],
    ...(isFeeEstimate(message["reviewedDeploymentFee"])
      ? { reviewedDeploymentFee: message["reviewedDeploymentFee"] }
      : {}),
    ...(isFeeEstimate(message["reviewedFee"]) ? { reviewedFee: message["reviewedFee"] } : {}),
    speed: message["speed"] === "fast" ? "fast" : "standard",
    tokenId: message["tokenId"],
  };
};

/**
 * Parses dapp typed-data signing requests from the provider bridge.
 */
export const readSignTypedDataInput = (
  message: unknown,
): { readonly origin: string; readonly typedData: unknown } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type", "typedData"]) ||
    message["type"] !== "wallet.signTypedData" ||
    message["typedData"] === undefined
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { origin, typedData: message["typedData"] } : null;
};

/**
 * Parses side panel transfer requests before touching wallet state.
 */
export const readTransferInput = (message: unknown): ReturnType<typeof readTransferFields> =>
  readTransferFields(message, "wallet.transfer");

/**
 * Parses pre-sign transfer review requests from extension pages.
 */
export const readReviewTransferInput = (message: unknown): ReturnType<typeof readTransferFields> =>
  readTransferFields(message, "wallet.reviewTransfer");

/**
 * Parses popup unlock messages carrying the vault passphrase.
 */
export const readUnlockInput = (message: unknown): { readonly vaultPassphrase: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["type", "vaultPassphrase"]) ||
    message["type"] !== "wallet.unlock" ||
    !isVaultPassphrase(message["vaultPassphrase"])
  ) {
    return null;
  }
  return { vaultPassphrase: message["vaultPassphrase"] };
};

/**
 * Parses reveal-secrets messages. The passphrase must be re-entered in the
 * message and is never taken from the cached session.
 */
export const readRevealSecretsInput = (
  message: unknown,
): { readonly vaultPassphrase: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["type", "vaultPassphrase"]) ||
    message["type"] !== "wallet.revealSecrets" ||
    !isVaultPassphrase(message["vaultPassphrase"])
  ) {
    return null;
  }
  return { vaultPassphrase: message["vaultPassphrase"] };
};

/** Re-exported preference input readers so callers keep one import path. */
export {
  readCreateGroupInput,
  readImportPreferencesInput,
  readRemoveAddressInput,
  readRemoveGroupInput,
  readRenameGroupInput,
  readSaveAddressInput,
  readSetAccountInGroupInput,
  readSetAccountLabelInput,
  readSetDisplayInput,
  readSetExplorerFallbackInput,
  readSetGroupIconInput,
  readSetNostrRelayUrlInput,
  readSetRpcOverrideInput,
  readSetStrk20NetworkConfigInput,
} from "../settings/preference-inputs";
