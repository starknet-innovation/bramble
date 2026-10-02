/**
 * How the background answers a `runtime.onMessage` request.
 *
 * Chromium MV3 holds the service worker open for a listener that returns `true`
 * and calls `sendResponse` later. Firefox's non-persistent event page has no
 * equivalent: it stays alive only while a listener's returned Promise is
 * pending, and it takes that Promise's resolved value as the response. The two
 * shapes are mutually exclusive, so the build target decides which one the
 * entrypoint uses, and the response the caller finally receives is the same
 * either way.
 */

/** The Chrome `true` plus late-`sendResponse` shape. */
export type SendResponse<Response> = (response: Response) => void;

/** What `runtime.onMessage` accepts from the listener: `true`, or Firefox's Promise. */
export type ListenerOutcome<Response> = true | Promise<Response>;

/**
 * Whether the running bundle answers with a pending Promise.
 *
 * Only the exact target `firefox` does. Anything else, including an unstamped
 * bundle and a target this predicate has never heard of, keeps the Chromium
 * shape, matching the fail-closed reading {@link lockdownIsEnforceable} uses
 * for the same stamp.
 */
export const awaitsListenerPromise = (target: string | undefined): boolean => target === "firefox";

/**
 * Wires one message request to the target's response protocol.
 *
 * `work` resolves with the handler's response; a rejection answers `failure`.
 * `after` runs with a successful response on every target (the entrypoint uses
 * it to broadcast wallet events), and never on a failed one. `send` is
 * Chromium's `sendResponse`, unused on Firefox because a returned Promise is
 * the response there and calling both is a protocol error.
 */
export const respondToMessage = <Response>(options: {
  readonly target: string | undefined;
  readonly work: Promise<Response>;
  readonly failure: Response;
  readonly after: (response: Response) => void;
  readonly send: SendResponse<Response>;
}): ListenerOutcome<Response> => {
  const { after, failure, send, target, work } = options;
  if (awaitsListenerPromise(target)) {
    return work.then(
      (response) => {
        after(response);
        return response;
      },
      () => failure,
    );
  }
  void work.then(
    (response) => {
      send(response);
      after(response);
    },
    () => send(failure),
  );
  return true;
};
