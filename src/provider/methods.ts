/**
 * Provider methods accepted from untrusted page messages.
 */
const PROVIDER_METHODS = [
  "mc_accounts",
  "mc_requestAccounts",
  "wallet_addDeclareTransaction",
  "wallet_addInvokeTransaction",
  "wallet_deploymentData",
  "wallet_addStarknetChain",
  "wallet_getPermissions",
  "wallet_requestAccounts",
  "wallet_requestChainId",
  "wallet_signTypedData",
  "wallet_supportedSpecs",
  "wallet_supportedWalletApi",
  "wallet_strk20Balances",
  "wallet_strk20InvokeTransaction",
  "wallet_strk20PrepareInvoke",
  "wallet_switchStarknetChain",
  "wallet_watchAsset",
] as const;

/**
 * Provider method exposed to dapp pages.
 */
export type ProviderMethod = (typeof PROVIDER_METHODS)[number];

const PROVIDER_METHOD_SET: ReadonlySet<unknown> = new Set(PROVIDER_METHODS);

/**
 * Narrows an untrusted value to the explicitly supported provider method set.
 */
export const isProviderMethod = (value: unknown): value is ProviderMethod =>
  PROVIDER_METHOD_SET.has(value);
