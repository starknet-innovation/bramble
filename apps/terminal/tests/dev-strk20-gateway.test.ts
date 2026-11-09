// @vitest-environment node
/**
 * The local STRK20 dev gateway (Sherlock 199, 244). It holds a developer's
 * paymaster credential and vouches for its callers to the deployed gateway, so
 * the credential may only reach the configured relay origin, and only a
 * locally loaded extension may use it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "dev-paymaster-key";
const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const PRIVILEGED = {
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "none",
} as const;

type Sent = { readonly url: string; readonly headers: Headers };

const load = async (): Promise<{
  readonly handle: (request: Request) => Promise<Response>;
  readonly sent: Sent[];
}> => {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      sent.push({ headers: new Headers(init?.headers), url: String(input) });
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }),
  );
  const module = await import("../scripts/dev-strk20-gateway");
  return { handle: module.handleDevGatewayRequest, sent };
};

const request = (path: string, headers: Record<string, string>, method = "POST"): Request =>
  new Request(`http://127.0.0.1:8787${path}`, {
    ...(method === "POST" ? { body: "{}" } : {}),
    headers: { "content-type": "application/json", ...headers },
    method,
  });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("AVNU_PAYMASTER_API_KEY", KEY);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("paymaster leg (Sherlock 199)", () => {
  it("sends the key to the relay origin for an ordinary paymaster call", async () => {
    const { handle, sent } = await load();
    const answer = await handle(request("/api/strk20/paymaster", { origin: EXTENSION }));
    expect(answer.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(new URL(sent[0]?.url ?? "").origin).toBe("https://starknet.paymaster.avnu.fi");
    expect(sent[0]?.headers.get("x-paymaster-api-key")).toBe(KEY);
  });

  it("never sends the key to a host spelled into the path", async () => {
    const { handle, sent } = await load();
    await handle(request("/api/strk20/paymaster.evil.example/x", { origin: EXTENSION }));
    for (const call of sent) {
      expect(call.headers.get("x-paymaster-api-key")).toBeNull();
      expect(new URL(call.url).host).not.toContain("evil.example");
    }
  });

  it("refuses a paymaster sub-path that is not a plain segment", async () => {
    const { handle, sent } = await load();
    const answer = await handle(request("/api/strk20/paymaster/a%2e%2e/b", { origin: EXTENSION }));
    expect(answer.status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it("refuses to start with an upstream that is not a bare https origin", async () => {
    vi.stubEnv("STRK20_PAYMASTER_UPSTREAM", "https://starknet.paymaster.avnu.fi/v1");
    await expect(load()).rejects.toThrow("bare https:// origin");
  });
});

describe("callers (Sherlock 244)", () => {
  it("refuses a web page and does not echo its origin", async () => {
    const { handle, sent } = await load();
    for (const method of ["POST", "OPTIONS"]) {
      const answer = await handle(
        request("/api/strk20/prover/v1/prove", { origin: "http://localhost:5273" }, method),
      );
      expect(answer.status).toBe(403);
      expect(answer.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(sent).toHaveLength(0);
  });

  it("refuses an origin-less request a page could send, such as an image load", async () => {
    const { handle, sent } = await load();
    const answer = await handle(
      request(
        "/api/strk20/discovery/x",
        { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors", "sec-fetch-site": "cross-site" },
        "GET",
      ),
    );
    expect(answer.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("chains an extension's request with its own origin allowed back", async () => {
    vi.stubEnv("AVNU_PAYMASTER_API_KEY", "");
    const { handle, sent } = await load();
    const answer = await handle(request("/api/strk20/prover/v1/prove", { origin: EXTENSION }));
    expect(answer.status).toBe(200);
    expect(answer.headers.get("access-control-allow-origin")).toBe(EXTENSION);
    expect(sent[0]?.url).toBe("https://mc-wallet-terminal.vercel.app/api/strk20/prover/v1/prove");
    expect(sent[0]?.headers.get("sec-fetch-site")).toBe("none");
  });

  it("chains a privileged extension fetch that carries no origin", async () => {
    const { handle, sent } = await load();
    const answer = await handle(request("/api/strk20/discovery/x", PRIVILEGED, "GET"));
    expect(answer.status).toBe(200);
    expect(answer.headers.get("access-control-allow-origin")).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("answers an extension preflight only on a gateway path", async () => {
    const { handle } = await load();
    expect((await handle(request("/api/strk20/prover", { origin: EXTENSION }, "OPTIONS"))).status).toBe(
      204,
    );
    expect((await handle(request("/other", { origin: EXTENSION }, "OPTIONS"))).status).toBe(404);
  });
});
