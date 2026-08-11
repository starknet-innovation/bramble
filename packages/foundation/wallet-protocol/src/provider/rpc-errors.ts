/**
 * Spec error objects for the Starknet wallet JSON-RPC surface (wallet_rpc.json).
 * Every dapp-facing rejection crosses the provider wire as a numeric-coded
 * `{ code, message, data? }` object so callers can branch on the code rather
 * than parse a human string. Internal extension-page messages keep their plain
 * string errors; this module is only for the dapp boundary.
 */

/**
 * A Starknet wallet JSON-RPC error object as defined by wallet_rpc.json.
 */
export type WalletRpcError = {
  readonly code: number;
  readonly data?: string;
  readonly message: string;
};

// Internal factory: binds a spec code and default message, then optionally
// attaches a `data` string. Not exported so the wire never grows an untyped
// error; every code has its own documented builder below.
const make =
  (code: number, message: string) =>
  (data?: string): WalletRpcError =>
    data === undefined ? { code, message } : { code, data, message };

/**
 * NOT_ERC20 (111): the asset is not a valid ERC20 token.
 */
export const notErc20 = make(111, "The asset is not a valid ERC20 token");
/**
 * UNLISTED_NETWORK (112): the requested network is not one the wallet lists.
 */
export const unlistedNetwork = make(112, "The requested network is not listed");
/**
 * USER_REFUSED_OP (113): the user declined the operation.
 */
export const userRefusedOp = make(113, "The user refused the operation");
/**
 * INVALID_REQUEST_PAYLOAD (114): request params did not match the schema.
 */
export const invalidRequestPayload = make(114, "The request payload is invalid");
/**
 * ACCOUNT_ALREADY_DEPLOYED (115): the account is already deployed on chain.
 */
export const accountAlreadyDeployed = make(115, "The account is already deployed");
/**
 * DEPLOYMENT_DATA_NOT_AVAILABLE (116): account deployment data is unavailable.
 */
export const deploymentDataNotAvailable = make(116, "Account deployment data is not available");
/**
 * CHAIN_ID_NOT_SUPPORTED (117): the requested chain id is not supported.
 */
export const chainIdNotSupported = make(117, "The chain id is not supported");
/**
 * NOT_REGISTERED (118): the account is not registered for the action.
 */
export const notRegistered = make(118, "The account is not registered");
/**
 * INSUFFICIENT_PRIVATE_BALANCE (119): insufficient private balance.
 */
export const insufficientPrivateBalance = make(119, "Insufficient private balance");
/**
 * PRIVACY_LEAK (120): the operation would leak private information.
 */
export const privacyLeak = make(120, "The operation would leak private information");
/**
 * API_VERSION_NOT_SUPPORTED (162): the requested API version is not supported.
 */
export const apiVersionNotSupported = make(162, "The requested API version is not supported");
/**
 * UNKNOWN_ERROR (163): fallback for any otherwise-unmapped failure.
 */
export const unknownError = make(163, "The wallet request failed");

/**
 * Maps an internal background error string to its spec error object. Denials
 * become USER_REFUSED_OP, malformed inputs become INVALID_REQUEST_PAYLOAD,
 * unsupported chains become CHAIN_ID_NOT_SUPPORTED, and anything unrecognized
 * becomes UNKNOWN_ERROR — never a raw string on the dapp wire.
 */
export const errorForMessage = (message: string): WalletRpcError => {
  if (message === "request rejected" || message === "connection rejected") {
    return userRefusedOp();
  }
  if (/unsupported chain|chain (?:id )?not supported|unlisted network/i.test(message)) {
    return chainIdNotSupported();
  }
  if (/unsupported api|api version/i.test(message)) {
    return apiVersionNotSupported();
  }
  if (/already deployed/i.test(message)) {
    return accountAlreadyDeployed();
  }
  if (/deployment data/i.test(message)) {
    return deploymentDataNotAvailable();
  }
  if (/not registered/i.test(message)) {
    return notRegistered();
  }
  if (/insufficient private balance/i.test(message)) {
    return insufficientPrivateBalance();
  }
  if (/privacy leak|would leak/i.test(message)) {
    return privacyLeak();
  }
  if (/^invalid\b/i.test(message) || /malformed|origin mismatch/i.test(message)) {
    return invalidRequestPayload();
  }
  if (/^strk20 (?:services unavailable|private submission unavailable)/i.test(message)) {
    return unknownError(message);
  }
  return unknownError();
};
