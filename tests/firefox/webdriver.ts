/**
 * The smallest W3C WebDriver client the Firefox smoke needs, over geckodriver's
 * HTTP API with `fetch`. Playwright cannot load a Firefox extension, and the
 * smoke adds no dependency to drive one, so this speaks classic WebDriver
 * directly plus geckodriver's one extension endpoint, `moz/addon/install`.
 *
 * Test-only. Every failure throws with the endpoint and WebDriver's own error
 * text; nothing here retries a command except the explicit `waitFor` polls.
 */

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const POLL_MS = 200;
// Above WebDriver's own 30 s script timeout and session start-up; a stalled
// driver fails the run instead of holding the CI job.
const COMMAND_TIMEOUT_MS = 90_000;

/** An element handle as WebDriver returns it. */
type Element = { readonly [ELEMENT_KEY]: string };

const isElement = (value: unknown): value is Element =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, ELEMENT_KEY) === "string";

const errorText = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return String(value);
  return `${String(Reflect.get(value, "error"))}: ${String(Reflect.get(value, "message"))}`;
};

/**
 * One WebDriver session. `call` is the raw command; the rest are the handful of
 * commands the smoke uses, located the way the Chromium suite locates them:
 * by role and visible name where it can, by the same selectors where it cannot.
 */
export type Session = {
  readonly call: (
    method: "DELETE" | "GET" | "POST",
    path: string,
    body?: unknown,
  ) => Promise<unknown>;
  /** Runs `body` (a function body taking `arguments`) in the page and returns its result. */
  readonly run: (body: string, ...args: unknown[]) => Promise<unknown>;
  /** Runs an async function body in the page; it must call `arguments[arguments.length - 1]`. */
  readonly runAsync: (body: string, ...args: unknown[]) => Promise<unknown>;
  /** First displayed element matching a CSS selector, polled until `timeoutMs`. */
  readonly css: (selector: string, timeoutMs?: number) => Promise<Element>;
  /** First displayed button whose text or label contains `name` (Playwright's non-exact match). */
  readonly button: (name: string, timeoutMs?: number) => Promise<Element>;
  /** First displayed heading whose text is `name`. */
  readonly heading: (name: string, timeoutMs?: number) => Promise<Element>;
  readonly click: (element: Element) => Promise<void>;
  /** Sets an input's value and fires `input`/`change`, as Playwright's `fill` does. */
  readonly fill: (element: Element, value: string) => Promise<void>;
  readonly text: (element: Element) => Promise<string>;
};

/** Polls `probe` until it returns a value other than `undefined`, or throws `what` on timeout. */
export const waitFor = async <T>(
  what: string,
  probe: () => Promise<T | undefined>,
  timeoutMs = 15_000,
): Promise<T> => {
  const deadline = performance.now() + timeoutMs;
  let last: unknown;
  while (performance.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}${last ? ` (${last})` : ""}`);
};

// XPath string literal for any text: concat() around both quote kinds.
const xpathLiteral = (text: string): string =>
  text.includes('"') ? `concat("${text.split('"').join(`", '"', "`)}")` : `"${text}"`;

/**
 * Opens a session against a running geckodriver at `driverUrl`. The caller owns
 * the session and must `DELETE` it (see {@link Session.call}) to close Firefox.
 */
export const openSession = async (driverUrl: string, capabilities: unknown): Promise<Session> => {
  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${driverUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const value: unknown = Reflect.get((await response.json()) as object, "value");
    if (!response.ok) throw new Error(`${method} ${path} failed: ${errorText(value)}`);
    return value;
  };
  const created = await request("POST", "/session", { capabilities });
  const id = Reflect.get(created as object, "sessionId");
  if (typeof id !== "string") throw new Error("geckodriver returned no session id");
  const call: Session["call"] = (method, path, body) =>
    request(method, `/session/${id}${path}`, body);

  const displayed = async (using: string, value: string): Promise<Element | undefined> => {
    const found = await call("POST", "/elements", { using, value });
    for (const element of Array.isArray(found) ? found.filter(isElement) : []) {
      if ((await call("GET", `/element/${element[ELEMENT_KEY]}/displayed`)) === true)
        return element;
    }
    return undefined;
  };
  const xpath = (what: string, query: string, timeoutMs?: number): Promise<Element> =>
    waitFor(what, () => displayed("xpath", query), timeoutMs);

  return {
    button: (name, timeoutMs) => {
      const literal = xpathLiteral(name);
      return xpath(
        `button "${name}"`,
        `//*[self::button or @role="button"][contains(normalize-space(.), ${literal}) or contains(@aria-label, ${literal})]`,
        timeoutMs,
      );
    },
    call,
    // Retried like Playwright's actionability wait: a screen still animating in
    // reports "not interactable" for a moment.
    click: async (element) => {
      await waitFor("a clickable element", async () => {
        await call("POST", `/element/${element[ELEMENT_KEY]}/click`, {});
        return true;
      });
    },
    css: (selector, timeoutMs) =>
      waitFor(`"${selector}"`, () => displayed("css selector", selector), timeoutMs),
    fill: async (element, value) => {
      await call("POST", "/execute/sync", {
        args: [element, value],
        script: `const [input, value] = arguments; input.focus(); input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));`,
      });
    },
    heading: (name, timeoutMs) =>
      xpath(
        `heading "${name}"`,
        `//*[self::h1 or self::h2 or self::h3 or @role="heading"][normalize-space(.)=${xpathLiteral(name)}]`,
        timeoutMs,
      ),
    run: (body, ...args) => call("POST", "/execute/sync", { args, script: body }),
    runAsync: (body, ...args) => call("POST", "/execute/async", { args, script: body }),
    text: async (element) => String(await call("GET", `/element/${element[ELEMENT_KEY]}/text`)),
  };
};
