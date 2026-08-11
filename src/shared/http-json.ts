/**
 * Bounded, deadlined JSON reads at untrusted HTTP boundaries.
 *
 * Every external endpoint the wallet talks to — the price feed, the phishing
 * blocklist, the NFT indexer, the Starkscan explorer, the swap aggregator —
 * returns a body the wallet did not author, over a
 * connection the wallet does not control. `response.json()` buffers whatever
 * that host chooses to send and waits as long as the host chooses to take, so a
 * hostile or compromised endpoint can exhaust the service worker's memory or
 * park the operation forever long before any validator runs. Both failure modes
 * are closed here, in one place:
 *
 * - **Size.** The body is read through its stream and the read is cancelled the
 *   moment the byte budget is exceeded, so the peak memory of a boundary read is
 *   bounded by its declared cap.
 * - **Time.** One deadline covers the whole exchange — connecting, headers, and
 *   every body chunk. It is enforced wallet-side, so a transport that ignores
 *   the `AbortSignal` still cannot stall the caller; the reader is cancelled on
 *   expiry so the stream is torn down either way.
 *
 * Requests also carry the same hardening the NFT metadata boundary uses:
 * no cookies, no referrer, and redirects refused rather than followed, so an
 * endpoint under the extension's `host_permissions` cannot correlate the user
 * across requests or bounce the wallet somewhere it did not intend to go.
 *
 * Nothing here interprets meaning: the caller still parses the returned value
 * into its own type. Failures are thrown as {@link WalletError}, which every
 * caller already treats as "endpoint unavailable" and degrades from.
 */
import { WalletError } from "./errors";

/**
 * Per-boundary response budgets, single-sourced the way `JSON_BUDGETS` in
 * `./json` single-sources structural budgets so two boundaries cannot drift
 * apart from one another or from their tests. Each
 * value is generous headroom over the real payload, not a working limit: a body
 * past it is hostile or broken, never merely large.
 */
export const HTTP_BODY_LIMITS = {
  /**
   * An error body, read only to surface the endpoint's own message. Small on
   * purpose: nothing past the first few kilobytes of a failure is ever used.
   */
  errorDetail: 8 * 1024,
  /**
   * Indexer NFT listings. A large account's listing can be thousands of records
   * before the wallet's own discovery cap trims it, so the budget is well above
   * a realistic page rather than tuned to the trimmed result.
   */
  nftIndexer: 4 * 1024 * 1024,
  /** Public web3 phishing lists are a few MB of registrable domains. */
  phishingFeed: 8 * 1024 * 1024,
  /** CoinGecko price and 7-day chart bodies are a few kilobytes. */
  price: 512 * 1024,
  /**
   * Starkscan pages. A page is capped at 200 records of transactions, transfers,
   * or holdings, each with hashes, addresses, and decoded event data.
   */
  starkscan: 2 * 1024 * 1024,
  /**
   * Swap-aggregator quotes, builds, and the verified token catalogue (at most
   * 200 entries with names, symbols, and logo URLs).
   */
  swap: 1024 * 1024,
} as const satisfies Readonly<Record<string, number>>;

/**
 * Wall-clock budget for one boundary exchange: connect, headers, and the whole
 * body. Each of these boundaries feeds a background refresh whose result the UI
 * degrades from, so a generous ceiling costs nothing and a missing one costs a
 * parked worker. Callers with a tighter budget pass their own.
 */
export const HTTP_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Request options every untrusted boundary fetch carries. Cookies and referrer
 * are withheld so a third-party endpoint reached under the extension's
 * `host_permissions` cannot link requests to a browsing identity, and a
 * redirect is a failure rather than a hop, so the response the wallet parses
 * always came from the host it chose to trust.
 */
export const UNTRUSTED_REQUEST_INIT = {
  credentials: "omit",
  redirect: "error",
  referrerPolicy: "no-referrer",
} as const satisfies RequestInit;

/**
 * The response subset a bounded read needs. `json` and `ok` are the minimum any
 * injected transport provides; `body`, `headers`, and `text` are optional
 * because in-process test doubles supply only `json`. A real `fetch` `Response`
 * satisfies all five, so production reads always take the streaming path.
 */
export type BoundedHttpResponse = {
  readonly json: () => Promise<unknown>;
  readonly ok: boolean;
} & Partial<Pick<Response, "body" | "headers" | "text">>;

/**
 * The injected transport a bounded read drives: `fetch`-shaped, so the wiring
 * that owns network access can pass the request options and deadline straight
 * through. A transport that ignores `init` still cannot defeat the deadline —
 * {@link fetchBoundedJson} enforces it on the wallet side — but it does leave
 * the socket in the host's hands and drops the request hardening, so production
 * wiring never writes one of these by hand: it passes {@link untrustedFetch}.
 */
export type BoundedHttpFetch = (url: string, init: RequestInit) => Promise<BoundedHttpResponse>;

/**
 * The one production transport every untrusted boundary is wired with.
 *
 * It exists because the alternative did not work. A boundary wired as
 * `(url) => fetch(url)` type-checks perfectly — TypeScript accepts a function
 * of lower arity anywhere a two-parameter one is wanted — and silently discards
 * the `AbortSignal`, the refusal to follow redirects, the cookie suppression,
 * and the referrer suppression that {@link fetchBoundedJson} composed. The
 * caller still gets its deadline (it is raced wallet-side) but the socket is
 * never torn down and a 3xx is followed to wherever the host points. Three of
 * the wallet's five boundaries shipped exactly that way. So there is nothing
 * for a wiring site to get right any more: it names this value.
 *
 * Typed as returning a real `Response` so it satisfies both
 * {@link BoundedHttpFetch} and the boundaries that read a `Response` directly
 * (Starkscan's typed client). Throws whatever `fetch` throws — a refused
 * redirect included — which every boundary already treats as "endpoint
 * unavailable".
 */
export const untrustedFetch = (url: string, init: RequestInit): Promise<Response> =>
  fetch(url, init);

const TOO_LARGE = "Response exceeded its size limit";
const TIMED_OUT = "Response timed out";

// A rejection that fires when the deadline expires. One per read, raced against
// each await, so every branch of a read observes the same expiry.
const expiryOf = (deadline: AbortSignal): Promise<never> => {
  const expiry = new Promise<never>((_resolve, reject) => {
    if (deadline.aborted) {
      reject(new WalletError(TIMED_OUT));
      return;
    }
    deadline.addEventListener("abort", () => reject(new WalletError(TIMED_OUT)), { once: true });
  });
  // A read that finishes early leaves this promise pending until its deadline
  // fires with nothing racing it. Marking it handled here keeps that ordinary
  // outcome from surfacing as an unhandled rejection in the worker.
  void expiry.catch(() => undefined);
  return expiry;
};

// A declared content-length is checked before a single byte is read. A
// malformed one is treated as hostile rather than ignored.
const declaredTooLarge = (response: BoundedHttpResponse, maxBytes: number): boolean => {
  const declared = response.headers?.get("content-length");
  if (declared === undefined || declared === null) {
    return false;
  }
  return !/^[0-9]+$/.test(declared) || Number(declared) > maxBytes;
};

// Decodes the body stream, cancelling as soon as the budget is exceeded or the
// deadline expires, so a host that ignores its own content-length cannot stream
// more than `maxBytes` into the worker and one that stalls mid-body cannot hold
// the read open past its deadline.
const readBoundedStream = async (
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  expiry: Promise<never>,
): Promise<string> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), expiry]);
      if (chunk.done) {
        return text + decoder.decode();
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        throw new WalletError(TOO_LARGE);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WalletError("Response was not JSON");
  }
};

// Reads a body as text under a byte budget and the caller's deadline. Null means
// the transport exposes neither a `body` stream nor `text()`, so no bound can be
// placed on it — only in-process test doubles are wired that way, because the
// wallet, never the remote host, chooses the transport. When only `text()`
// exists the cap is applied to UTF-16 code units, which under-counts UTF-8 bytes
// and so can only ever be stricter than the declared budget.
const boundedText = async (
  response: BoundedHttpResponse,
  maxBytes: number,
  expiry: Promise<never>,
): Promise<string | null> => {
  if (declaredTooLarge(response, maxBytes)) {
    throw new WalletError(TOO_LARGE);
  }
  if (response.body) {
    return readBoundedStream(response.body, maxBytes, expiry);
  }
  if (response.text) {
    const text = await Promise.race([response.text(), expiry]);
    if (text.length > maxBytes) {
      throw new WalletError(TOO_LARGE);
    }
    return text;
  }
  return null;
};

const readBoundedJson = async (
  response: BoundedHttpResponse,
  maxBytes: number,
  expiry: Promise<never>,
): Promise<unknown> => {
  const text = await boundedText(response, maxBytes, expiry);
  return text === null ? Promise.race([response.json(), expiry]) : parseJson(text);
};

/**
 * Reads one untrusted response body as text under a hard byte budget and the
 * caller's deadline, for boundaries that own their own response handling and
 * cannot hand the whole exchange to {@link fetchBoundedJson} — a client with its
 * own typed error taxonomy, say, or one that reads a failure body as well as a
 * success body.
 *
 * The budget is spent as the bytes arrive: the stream is cancelled the moment it
 * is exceeded, so a caller can never buffer a hostile body first and measure it
 * afterwards. `deadline` must be the SAME signal the request was issued under,
 * so one budget covers headers and body together.
 *
 * Throws a {@link WalletError} when the declared or actual body exceeds
 * `maxBytes`, when the deadline expires, or when the transport exposes no
 * readable body at all — never a partial read presented as a whole one.
 */
export const readBoundedText = async (
  response: BoundedHttpResponse,
  maxBytes: number,
  deadline: AbortSignal,
): Promise<string> => {
  const text = await boundedText(response, maxBytes, expiryOf(deadline));
  if (text === null) {
    throw new WalletError("Response body was not readable");
  }
  return text;
};

/**
 * Fetches and parses one untrusted JSON body under a hard byte budget and a
 * hard deadline.
 *
 * Throws a {@link WalletError} when the endpoint answers non-ok, when the
 * declared or actual body exceeds `maxBytes`, when the exchange outlives
 * `timeoutMs`, or when the bytes read are not JSON. Every caller at these
 * boundaries already degrades to cached-or-empty on a throw, so each of those
 * fails closed instead of being parsed or waited on.
 *
 * The deadline is enforced twice over: it is handed to the transport as an
 * `AbortSignal` so a wired `fetch` tears the socket down, and it is raced
 * against every await here so a transport that drops the signal still cannot
 * park the caller. The response stream is cancelled on expiry either way.
 *
 * `request` adds the method, headers, and body a boundary needs (a POST to a
 * quote API, say). It cannot supply a `signal`: the deadline is this function's
 * to set, so no caller can hand back an exchange with no clock on it.
 */
export const fetchBoundedJson = async (
  http: BoundedHttpFetch,
  url: string,
  maxBytes: number,
  timeoutMs: number = HTTP_REQUEST_TIMEOUT_MS,
  request: Omit<RequestInit, "signal"> = {},
): Promise<unknown> => {
  const deadline = AbortSignal.timeout(timeoutMs);
  const expiry = expiryOf(deadline);
  const response = await Promise.race([
    http(url, { ...UNTRUSTED_REQUEST_INIT, ...request, signal: deadline }),
    expiry,
  ]);
  if (!response.ok) {
    throw new WalletError("Request failed");
  }
  return readBoundedJson(response, maxBytes, expiry);
};
