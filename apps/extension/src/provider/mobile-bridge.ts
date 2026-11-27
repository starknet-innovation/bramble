/**
 * The mobile apps' in-app browser bridge (P16): it stands where the extension's content script
 * stands, carrying `inpage.ts`'s window messages to the native host and the host's answers back.
 * It is never part of the extension build; `scripts/mobile-assets/provider.ts` bundles it ahead of
 * `inpage.ts` into the one document-start script both apps inject.
 *
 * Trust boundary: none here. It runs in the page's own world, so any page script can call the
 * native handler directly, and the host treats every body as untrusted: it binds each request to
 * the main frame's committed `https` origin itself and refuses frames it cannot attribute. This
 * script only filters what the extension's content script filters (same window, same origin, a
 * well-formed request) so a dapp sees the same answers. The bundle runs it in the top frame only.
 * A reply that is not a well-formed provider response is dropped.
 */

import {
  isTrustedPageMessage,
  misaddressedProviderResponse,
  PAGE_TARGET,
  readProviderRequest,
  readProviderResponse,
} from "@bramble/wallet-protocol/bridge";

type IosHandler = { readonly postMessage: (body: string) => Promise<unknown> };
type AndroidBridge = {
  readonly postMessage: (body: string) => void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
};
type NativeHosts = {
  readonly brambleBridge?: AndroidBridge;
  readonly webkit?: { readonly messageHandlers?: { readonly bramble?: IosHandler } };
};

const pageOrigin = window.location.origin;

// Every reply is the host's JSON `{ id, error | result }`; it reaches the page only as a provider
// response `inpage.ts` accepts.
const deliver = (reply: unknown): void => {
  if (typeof reply !== "string") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const response = readProviderResponse({ ...parsed, target: PAGE_TARGET });
  if (response) window.postMessage(response, pageOrigin);
};

// Read once, at document start, before any page script runs.
const hosts = window as unknown as NativeHosts;
const ios = hosts.webkit?.messageHandlers?.bramble;
const android = hosts.brambleBridge;
const send: ((body: string) => void) | undefined = ios
  ? (body) => {
      ios.postMessage(body).then(deliver, () => undefined);
    }
  : android
    ? (body) => android.postMessage(body)
    : undefined;

if (send) {
  if (!ios && android) {
    android.onmessage = (event) => deliver(event.data);
  }
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (!isTrustedPageMessage(event, window, pageOrigin)) return;
    const request = readProviderRequest(event.data);
    if (!request) {
      // As the content script does: a misaddressed request is rejected, never left hanging.
      const misaddressed = misaddressedProviderResponse(event.data);
      if (misaddressed) window.postMessage(misaddressed, pageOrigin);
      return;
    }
    // `params` travels as its own JSON text, so the host hands the core the page's exact JSON.
    const params = request.params === undefined ? null : JSON.stringify(request.params);
    send(JSON.stringify({ id: request.id, method: request.method, params }));
  });
}
