/**
 * Shared service URL policy and normalization checks.
 */
import { describe, expect, test } from "bun:test";
import {
  isBoundedServiceUrlList,
  isServiceUrl,
  isWebSocketServiceUrl,
  normalizeHostname,
  REDACTED_ENDPOINT,
  redactEndpoints,
  trimTrailingSlashes,
} from "@bramble/core/service-url";

describe("service URLs", () => {
  test("accepts reviewed transports and rejects credentialed or remote HTTP URLs", () => {
    expect(isServiceUrl("https://service.example/path")).toBe(true);
    expect(isServiceUrl("http://localhost:8787")).toBe(true);
    expect(isServiceUrl("http://service.example")).toBe(false);
    expect(isServiceUrl("https://user:pass@service.example")).toBe(false);
  });

  test("accepts secure WebSocket relays and loopback development relays only", () => {
    expect(isWebSocketServiceUrl("wss://relay.example/path")).toBe(true);
    expect(isWebSocketServiceUrl("ws://localhost:8080")).toBe(true);
    expect(isWebSocketServiceUrl("ws://relay.example")).toBe(false);
    expect(isWebSocketServiceUrl("wss://user:pass@relay.example")).toBe(false);
    expect(isWebSocketServiceUrl("wss://relay.example/#fragment")).toBe(false);
    expect(isWebSocketServiceUrl("https://relay.example")).toBe(false);
  });

  test("removes any trailing slash run without changing the rest of the URL", () => {
    expect(trimTrailingSlashes("https://service.example/path///")).toBe(
      "https://service.example/path",
    );
    expect(trimTrailingSlashes("https://service.example/path")).toBe(
      "https://service.example/path",
    );
    expect(trimTrailingSlashes("////")).toBe("");
  });

  test("normalizes a hostname for comparison without changing the rest", () => {
    expect(normalizeHostname("Example.COM")).toBe("example.com");
    expect(normalizeHostname("example.com.")).toBe("example.com");
    expect(normalizeHostname("sub.example.com.")).toBe("sub.example.com");
    expect(normalizeHostname("127.0.0.1")).toBe("127.0.0.1");
  });

  test("bounds the number of entries in a dapp endpoint list (Sherlock audit 153)", () => {
    const urls = (count: number) =>
      Array.from({ length: count }, (_, index) => `https://rpc${index}.example`);
    expect(isBoundedServiceUrlList(urls(4), 4)).toBe(true);
    expect(isBoundedServiceUrlList(urls(5), 4)).toBe(false);
    expect(isBoundedServiceUrlList([], 4)).toBe(false);
    expect(isBoundedServiceUrlList(["ftp://rpc.example"], 4)).toBe(false);
  });
});

describe("redactEndpoints", () => {
  test("removes every scheme-qualified URL, path and query included", () => {
    expect(
      redactEndpoints(
        "failed at https://rpc.example.test/v0_8/node-key-123?apikey=abc then wss://ws.example.test/k",
      ),
    ).toBe(`failed at ${REDACTED_ENDPOINT} then ${REDACTED_ENDPOINT}`);
  });

  // Every endpoint the wallet holds is canonical (service-url-spelling.test.ts),
  // so the match needs no cover for the spellings the parser only fixes when it
  // serializes, and text after a line break is never taken with the URL.
  test("ends a URL at a line break, keeping a label before it and the next line", () => {
    expect(redactEndpoints("Internal error:\nhttps://rpc.example/node-key-123")).toBe(
      `Internal error:\n${REDACTED_ENDPOINT}`,
    );
    expect(redactEndpoints("at https://rpc.example/key\nnext line")).toBe(
      `at ${REDACTED_ENDPOINT}\nnext line`,
    );
  });

  test("stops at a character a URL cannot carry, so quoted JSON stays readable", () => {
    expect(redactEndpoints('{"url":"https://rpc.example.test/key","code":-32603}')).toBe(
      '{"url":"[endpoint]","code":-32603}',
    );
    expect(redactEndpoints("<a href=https://x.example/key>gateway</a>")).toBe(
      "<a href=[endpoint]>gateway</a>",
    );
  });

  test("keeps the diagnostic around it: method, code, felts, plain words", () => {
    const text =
      "RPC: starknet_addInvokeTransaction with params {} 55: Account validation failed: 0x0123456789abcdef";
    expect(redactEndpoints(text)).toBe(text);
    expect(redactEndpoints("no endpoint configured: rpc://")).toBe(
      "no endpoint configured: rpc://",
    );
  });

  test("is idempotent and linear on long input", () => {
    const once = redactEndpoints("at https://rpc.example.test/key");
    expect(redactEndpoints(once)).toBe(once);
    const started = performance.now();
    redactEndpoints("a".repeat(200_000));
    // Every line start is a candidate, and none of them may rescan the rest.
    redactEndpoints("a\n".repeat(100_000));
    redactEndpoints("https:".repeat(50_000));
    expect(performance.now() - started).toBeLessThan(500);
  });
});
