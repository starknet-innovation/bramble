/**
 * Sender trust rules for extension pages and content-script provider messages.
 */

import { isOwnDataProperty } from "@bramble/core/json";
import { DAPP_RUNTIME_MESSAGE_TYPES } from "@bramble/wallet-protocol/methods";

/**
 * Sender metadata exposed by the extension runtime boundary.
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

/**
 * This extension's own identity, as the background sees it.
 *
 * Both halves are needed and neither can be derived from the other. `id` is
 * what the browser stamps on `sender.id`; `origin` is the origin of this
 * extension's own pages. On Chromium they are trivially related —
 * `chrome-extension://<id>` — but on Firefox they are unrelated values:
 * `runtime.id` is the add-on id from `browser_specific_settings` while
 * extension pages are served from `moz-extension://<per-install uuid>`.
 * Synthesizing the origin from the id therefore produced a URL that matches
 * nothing on Firefox, and every privileged message from the sidebar, popup and
 * onboarding page was refused as an untrusted sender.
 *
 * `origin` must come from `runtime.getURL("")`, which is correct on both.
 */
export type ExtensionIdentity = {
  readonly id: string;
  readonly origin: string;
};

/**
 * Every browser-supplied origin signal present on a runtime sender
 * (`sender.origin` and the origin of `sender.url`), with missing ones dropped.
 * These come from the browser, never from the message body, so they are the only
 * origin evidence a gate may trust. Returns an empty list when the sender
 * carries no origin at all, which every caller must treat as untrusted rather
 * than as a match.
 */
export const senderOrigins = (sender: RuntimeSender | undefined): readonly string[] =>
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
  extension: ExtensionIdentity,
): boolean => {
  const origins = senderOrigins(sender);
  return (
    extension.id.length > 0 &&
    // Redundant against the equality below — `senderOrigins` drops empty
    // strings, so an unknown extension origin already matches nothing. Kept
    // because it is the invariant that stops a future looser comparison (a
    // prefix or `startsWith`) from turning "origin unknown" into "any origin".
    extension.origin.length > 0 &&
    sender?.id === extension.id &&
    origins.length > 0 &&
    origins.every((origin) => origin === extension.origin)
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
  extension: ExtensionIdentity,
  origin: string,
): boolean => isExtensionPageSender(sender, extension) || isSenderOrigin(sender, origin);

/**
 * The only wallet messages a dapp page may reach through the content-script
 * bridge (the provider mapping in wallet-protocol/bridge plus the content
 * script's own grant re-query). tests/background/runtime/privileged-messages.test.ts derives
 * this set from those sources, so adding a bridge mapping without updating
 * this list — or vice versa — fails the suite.
 */
export const DAPP_MESSAGES = DAPP_RUNTIME_MESSAGE_TYPES;

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
  return isOwnDataProperty(descriptor) && typeof descriptor.value === "string"
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
  extension: ExtensionIdentity,
): GatedMessage => {
  if (!isTrustedSender(sender, extension.id)) {
    return { error: "untrusted sender" };
  }
  const messageType = readMessageType(message);
  if (!messageType) {
    return { error: "unsupported message" };
  }
  if (isPrivilegedMessage(messageType) && !isExtensionPageSender(sender, extension)) {
    return { error: "privileged sender required" };
  }
  return { messageType };
};
