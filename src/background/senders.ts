/**
 * Sender trust rules for extension pages and content-script provider messages.
 */
export type RuntimeSender = {
  readonly id?: string;
  readonly origin?: string;
  readonly tab?: {
    readonly id?: number;
    readonly windowId?: number;
  };
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
 * The only wallet messages a dapp page may reach through the content-script
 * bridge (the provider mapping in src/provider/bridge.ts plus the content
 * script's own grant re-query). tests/background/privileged-messages.test.ts derives
 * this set from those sources, so adding a bridge mapping without updating
 * this list — or vice versa — fails the suite.
 */
export const DAPP_MESSAGES: ReadonlySet<string> = new Set([
  "wallet.addDeclareTransaction",
  "wallet.addInvokeTransaction",
  "wallet.addStarknetChain",
  "wallet.deploymentData",
  "wallet.getChainId",
  "wallet.getGrantedAccounts",
  "wallet.getPermissions",
  "wallet.requestAccounts",
  "wallet.signTypedData",
  "wallet.strk20Register",
  "wallet.strk20Balances",
  "wallet.strk20InvokeTransaction",
  "wallet.strk20PrepareInvoke",
  "wallet.strk20SubaccountCommitment",
  "wallet.supportedSpecs",
  "wallet.supportedWalletApi",
  "wallet.switchChain",
  "wallet.watchAsset",
]);

/**
 * Dapp messages that may require a user decision in the wallet UI. The
 * background opens the approval surface as soon as one arrives so Chrome still
 * associates the call with the originating page gesture.
 */
export const APPROVAL_SURFACE_MESSAGES: ReadonlySet<string> = new Set([
  "wallet.addDeclareTransaction",
  "wallet.addInvokeTransaction",
  "wallet.addStarknetChain",
  "wallet.requestAccounts",
  "wallet.signTypedData",
  "wallet.strk20Register",
  "wallet.strk20Balances",
  "wallet.strk20InvokeTransaction",
  "wallet.strk20PrepareInvoke",
  "wallet.strk20SubaccountCommitment",
  "wallet.switchChain",
  "wallet.watchAsset",
]);

/**
 * Marks messages that must only come from extension-controlled pages.
 * Deny-by-default: every wallet.* message is privileged unless it is one of
 * the explicitly dapp-facing {@link DAPP_MESSAGES}, so a newly added message
 * type can never be silently reachable from content scripts.
 */
export const isPrivilegedMessage = (type: unknown): boolean =>
  typeof type === "string" && type.startsWith("wallet.") && !DAPP_MESSAGES.has(type);

/**
 * Result of gating an inbound runtime message: a usable message type, or the
 * exact error the dispatcher returns.
 */
export type GatedMessage = { readonly messageType: string } | { readonly error: string };

const readMessageType = (message: unknown): string | null => {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const descriptor = Object.getOwnPropertyDescriptor(message, "type");
  return descriptor?.enumerable === true &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
};

/**
 * Folds the trusted-sender, message-type, and privileged-sender guards into one
 * parse step, keeping the guards out of the dispatch body.
 */
export const parseGatedMessage = (
  message: unknown,
  sender: RuntimeSender | undefined,
  extensionId: string,
): GatedMessage => {
  if (!isTrustedSender(sender, extensionId)) {
    return { error: "untrusted sender" };
  }
  const messageType = readMessageType(message);
  if (!messageType) {
    return { error: "unsupported message" };
  }
  if (isPrivilegedMessage(messageType) && !isExtensionPageSender(sender, extensionId)) {
    return { error: "privileged sender required" };
  }
  return { messageType };
};
