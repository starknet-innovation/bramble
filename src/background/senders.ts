/**
 * Sender trust rules for extension pages and content-script provider messages.
 */
export type RuntimeSender = {
  readonly id?: string;
  readonly origin?: string;
  readonly url?: string;
};

const extensionOrigins = (extensionId: string): readonly string[] => [
  `chrome-extension://${extensionId}`,
  `moz-extension://${extensionId}`,
];

const senderOrigins = (sender: RuntimeSender | undefined): readonly string[] =>
  [sender?.origin, senderUrlOrigin(sender)].filter((origin): origin is string => !!origin);

/**
 * Returns the exact origin of a runtime sender URL, including extension schemes.
 */
export const senderUrlOrigin = (sender: RuntimeSender | undefined): string | null => {
  if (!sender?.url) {
    return null;
  }

  try {
    const url = new URL(sender.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
};

/**
 * Checks whether a runtime message came from an extension-controlled page.
 */
export const isExtensionPageSender = (
  sender: RuntimeSender | undefined,
  extensionId: string,
): boolean => {
  const origins = senderOrigins(sender);
  return (
    extensionId.length > 0 &&
    sender?.id === extensionId &&
    origins.length > 0 &&
    origins.every((origin) => extensionOrigins(extensionId).includes(origin))
  );
};

/**
 * Checks whether every sender origin signal matches an expected page origin.
 */
export const isSenderOrigin = (sender: RuntimeSender | undefined, origin: string): boolean => {
  const origins = senderOrigins(sender);
  return origins.length > 0 && origins.every((senderOrigin) => senderOrigin === origin);
};

/**
 * Checks whether a runtime message came from this extension or its pages.
 */
export const isTrustedSender = (sender: RuntimeSender | undefined, extensionId: string): boolean =>
  extensionId.length > 0 && sender?.id === extensionId && senderOrigins(sender).length > 0;

/**
 * Checks whether a sender may act for a claimed page origin: either an
 * extension page or a content script whose own origin matches.
 */
export const isClaimedSenderOrigin = (
  sender: RuntimeSender | undefined,
  extensionId: string,
  origin: string,
): boolean => isExtensionPageSender(sender, extensionId) || isSenderOrigin(sender, origin);

/**
 * Marks messages that must only come from extension-controlled pages.
 */
export const isPrivilegedMessage = (type: unknown): boolean =>
  type === "wallet.activity" ||
  type === "wallet.addMultisig" ||
  type === "wallet.addToken" ||
  type === "wallet.addNft" ||
  type === "wallet.allowances" ||
  type === "wallet.confirmMultisigProposal" ||
  type === "wallet.declareMultisigClass" ||
  type === "wallet.deployMultisig" ||
  type === "wallet.executeMultisigProposal" ||
  type === "wallet.multisigClassStatus" ||
  type === "wallet.multisigs" ||
  type === "wallet.proposeMultisigTx" ||
  type === "wallet.refreshMultisig" ||
  type === "wallet.removeMultisig" ||
  type === "wallet.revokeMultisigConfirmation" ||
  type === "wallet.trackMultisigProposal" ||
  type === "wallet.addAccount" ||
  type === "wallet.approveOrigin" ||
  type === "wallet.connectedSites" ||
  type === "wallet.createAccount" ||
  type === "wallet.denyOrigin" ||
  type === "wallet.deployAccount" ||
  type === "wallet.deploymentStatus" ||
  type === "wallet.detectTokens" ||
  type === "wallet.generateMnemonic" ||
  type === "wallet.grantOrigin" ||
  type === "wallet.getBalances" ||
  type === "wallet.importPreferences" ||
  type === "wallet.lock" ||
  type === "wallet.pendingApprovals" ||
  type === "wallet.preferences" ||
  type === "wallet.prices" ||
  type === "wallet.removeAddress" ||
  type === "wallet.revokeOrigin" ||
  type === "wallet.removeNft" ||
  type === "wallet.revealSecrets" ||
  type === "wallet.reviewTransfer" ||
  type === "wallet.revokeAllowance" ||
  type === "wallet.saveAddress" ||
  type === "wallet.setAccountLabel" ||
  type === "wallet.setActiveAccount" ||
  type === "wallet.setActiveNetwork" ||
  type === "wallet.setDisplay" ||
  type === "wallet.setNftSpam" ||
  type === "wallet.setRpcOverride" ||
  type === "wallet.setTokenHidden" ||
  type === "wallet.signHash" ||
  type === "wallet.status" ||
  type === "wallet.tokenChart" ||
  type === "wallet.transfer" ||
  type === "wallet.transferNft" ||
  type === "wallet.unlock";
