import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResponse } from "../../../api/_lib/http";
import { authorizeOrigin, serviceUrl } from "../../../api/_lib/security";
import gatewayHandler from "../../../api/strk20/gateway";
import vercelConfig from "../../../vercel.json";

const originalExtensionOrigins = process.env.BRAMBLE_EXTENSION_ORIGINS;
const originalDiscoveryUpstream = process.env.STRK20_DISCOVERY_UPSTREAM;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalExtensionOrigins === undefined) {
    delete process.env.BRAMBLE_EXTENSION_ORIGINS;
  } else {
    process.env.BRAMBLE_EXTENSION_ORIGINS = originalExtensionOrigins;
  }
  if (originalDiscoveryUpstream === undefined) {
    delete process.env.STRK20_DISCOVERY_UPSTREAM;
  } else {
    process.env.STRK20_DISCOVERY_UPSTREAM = originalDiscoveryUpstream;
  }
});

const response = (): {
  readonly body: () => unknown;
  readonly headers: Map<string, string>;
  readonly statusCode: () => number;
  readonly value: ApiResponse;
} => {
  const headers = new Map<string, string>();
  let body: unknown;
  let statusCode = 200;
  const value = {
    end: () => value,
    json: (content: unknown) => {
      body = content;
      return value;
    },
    send: (content: unknown) => {
      body = content;
      return value;
    },
    setHeader: (name: string, content: string) => {
      headers.set(name, content);
      return value;
    },
    status: (status: number) => {
      statusCode = status;
      return value;
    },
  } as unknown as ApiResponse;
  return { body: () => body, headers, statusCode: () => statusCode, value };
};

describe("privacy gateway security configuration", () => {
  it("keeps API functions outside the SPA fallback", () => {
    expect(vercelConfig.rewrites).toContainEqual({
      destination: "/api/strk20/gateway?service=:service",
      source: "/api/strk20/:service",
    });
    expect(vercelConfig.rewrites).toContainEqual({
      destination: "/api/strk20/gateway?service=:service&path=:path",
      source: "/api/strk20/:service/:path*",
    });
    const fallback = vercelConfig.rewrites.at(-1);
    expect(fallback?.destination).toBe("/index.html");
    const matchesFallback = new RegExp(`^${fallback?.source}$`);
    expect(matchesFallback.test("/privacy")).toBe(true);
    expect(matchesFallback.test("/api/strk20/discovery/health")).toBe(false);
    expect(matchesFallback.test("/api/private-swap/quote")).toBe(false);
  });

  it("fails closed without a released extension origin", () => {
    delete process.env.BRAMBLE_EXTENSION_ORIGINS;
    const target = response();
    expect(
      authorizeOrigin(
        { headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" } } as ApiRequest,
        target.value,
        "extension",
      ),
    ).toBe(false);
  });

  it("accepts only exact well-formed configured extension origins", () => {
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    process.env.BRAMBLE_EXTENSION_ORIGINS = origin;
    const target = response();
    expect(
      authorizeOrigin(
        { headers: { origin }, method: "GET" } as ApiRequest,
        target.value,
        "extension",
      ),
    ).toBe(true);
    expect(target.headers.get("Access-Control-Allow-Origin")).toBe(origin);

    process.env.BRAMBLE_EXTENSION_ORIGINS = "*";
    expect(
      authorizeOrigin(
        { headers: { origin }, method: "GET" } as ApiRequest,
        response().value,
        "extension",
      ),
    ).toBe(false);
  });

  it("accepts Chrome's originless privileged extension fetch shape", () => {
    delete process.env.BRAMBLE_EXTENSION_ORIGINS;
    const target = response();
    expect(
      authorizeOrigin(
        {
          headers: {
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "none",
          },
          method: "GET",
        } as ApiRequest,
        target.value,
        "extension",
      ),
    ).toBe(true);
    expect(target.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("accepts Chrome's origin-stamped privileged extension POST shape", () => {
    delete process.env.BRAMBLE_EXTENSION_ORIGINS;
    const target = response();
    expect(
      authorizeOrigin(
        {
          headers: {
            origin: "chrome-extension://eaeigbgejaogcbboamdmpolingenbmmd",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "none",
          },
          method: "POST",
        } as unknown as ApiRequest,
        target.value,
        "extension",
      ),
    ).toBe(true);
    expect(target.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("rejects web origins and malformed extension origins on the privileged shape", () => {
    delete process.env.BRAMBLE_EXTENSION_ORIGINS;
    for (const origin of [
      "https://attacker.example",
      "chrome-extension://short",
      "chrome-extension://EAEIGBGEJAOGCBBOAMDMPOLINGENBMMD",
    ]) {
      expect(
        authorizeOrigin(
          {
            headers: {
              origin,
              "sec-fetch-dest": "empty",
              "sec-fetch-mode": "cors",
              "sec-fetch-site": "none",
            },
            method: "POST",
          } as unknown as ApiRequest,
          response().value,
          "extension",
        ),
      ).toBe(false);
    }
  });

  it("rejects originless websites and navigation-shaped requests", () => {
    delete process.env.BRAMBLE_EXTENSION_ORIGINS;
    for (const headers of [
      {},
      { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site" },
      { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" },
      {
        referer: "https://attacker.example/",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "none",
      },
    ]) {
      expect(
        authorizeOrigin({ headers, method: "GET" } as ApiRequest, response().value, "extension"),
      ).toBe(false);
    }
  });

  it("accepts only credential-free HTTPS upstream configuration", () => {
    process.env.TEST_PRIVACY_UPSTREAM = "https://private.example/service/";
    expect(serviceUrl("TEST_PRIVACY_UPSTREAM")).toBe("https://private.example/service");
    process.env.TEST_PRIVACY_UPSTREAM = "https://user:secret@private.example";
    expect(serviceUrl("TEST_PRIVACY_UPSTREAM")).toBeNull();
    delete process.env.TEST_PRIVACY_UPSTREAM;
  });

  it("rejects an oversized upstream response before buffering its body", async () => {
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    process.env.BRAMBLE_EXTENSION_ORIGINS = origin;
    process.env.STRK20_DISCOVERY_UPSTREAM = "https://private.example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", {
          headers: {
            "content-length": String(8 * 1024 * 1024 + 1),
            "content-type": "application/json",
          },
          status: 200,
        }),
      ),
    );
    const target = response();
    await gatewayHandler(
      {
        headers: { origin },
        method: "GET",
        query: { path: "health", service: "discovery" },
      } as unknown as ApiRequest,
      target.value,
    );
    expect(target.statusCode()).toBe(502);
    expect(target.body()).toEqual({ error: "upstream_response_too_large" });
  });
});
