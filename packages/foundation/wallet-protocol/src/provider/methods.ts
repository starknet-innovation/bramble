/**
 * Provider methods accepted from untrusted page messages.
 */
/**
 * One security classification for every dapp provider method. The runtime type
 * is the only command the content bridge may forward; `approvalSurface` marks
 * commands that may need an immediate wallet decision surface.
 */
export const PROVIDER_METHOD_POLICY = {
  mc_accounts: { approvalSurface: false, runtimeType: "wallet.getGrantedAccounts" },
  mc_requestAccounts: { approvalSurface: true, runtimeType: "wallet.requestAccounts" },
  mc_strk20Register: { approvalSurface: true, runtimeType: "wallet.strk20Register" },
  wallet_addDeclareTransaction: {
    approvalSurface: true,
    runtimeType: "wallet.addDeclareTransaction",
  },
  wallet_addInvokeTransaction: {
    approvalSurface: true,
    runtimeType: "wallet.addInvokeTransaction",
  },
  wallet_addStarknetChain: { approvalSurface: true, runtimeType: "wallet.addStarknetChain" },
  wallet_deploymentData: { approvalSurface: false, runtimeType: "wallet.deploymentData" },
  wallet_getPermissions: { approvalSurface: false, runtimeType: "wallet.getPermissions" },
  wallet_requestAccounts: { approvalSurface: true, runtimeType: "wallet.requestAccounts" },
  wallet_requestChainId: { approvalSurface: false, runtimeType: "wallet.getChainId" },
  wallet_signTypedData: { approvalSurface: true, runtimeType: "wallet.signTypedData" },
  wallet_strk20Balances: { approvalSurface: true, runtimeType: "wallet.strk20Balances" },
  wallet_strk20InvokeTransaction: {
    approvalSurface: true,
    runtimeType: "wallet.strk20InvokeTransaction",
  },
  wallet_strk20PrepareInvoke: {
    approvalSurface: true,
    runtimeType: "wallet.strk20PrepareInvoke",
  },
  wallet_strk20ShadowAccountCommitment: {
    approvalSurface: true,
    runtimeType: "wallet.strk20ShadowAccountCommitment",
  },
  wallet_supportedSpecs: { approvalSurface: false, runtimeType: "wallet.supportedSpecs" },
  wallet_supportedWalletApi: {
    approvalSurface: false,
    runtimeType: "wallet.supportedWalletApi",
  },
  wallet_switchStarknetChain: { approvalSurface: true, runtimeType: "wallet.switchChain" },
  wallet_watchAsset: { approvalSurface: true, runtimeType: "wallet.watchAsset" },
} as const;

/**
 * Provider method exposed to dapp pages.
 */
export type ProviderMethod = keyof typeof PROVIDER_METHOD_POLICY;

const PROVIDER_METHOD_SET: ReadonlySet<unknown> = new Set(Object.keys(PROVIDER_METHOD_POLICY));

/**
 * Runtime message types reachable from an untrusted dapp page.
 */
export const DAPP_RUNTIME_MESSAGE_TYPES: ReadonlySet<string> = new Set(
  Object.values(PROVIDER_METHOD_POLICY).map((policy) => policy.runtimeType),
);

/**
 * Dapp runtime message types that may require an immediate approval surface.
 */
export const APPROVAL_RUNTIME_MESSAGE_TYPES: ReadonlySet<string> = new Set(
  Object.values(PROVIDER_METHOD_POLICY)
    .filter((policy) => policy.approvalSurface)
    .map((policy) => policy.runtimeType),
);

/**
 * Narrows an untrusted value to the explicitly supported provider method set.
 */
export const isProviderMethod = (value: unknown): value is ProviderMethod =>
  PROVIDER_METHOD_SET.has(value);
