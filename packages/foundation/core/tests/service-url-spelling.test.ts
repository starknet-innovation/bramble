/**
 * An endpoint is accepted, stored and compared only in its canonical spelling.
 *
 * The URL parser accepts raw spellings it fixes only when it serializes:
 * backslashes, missing or extra slashes, tab, CR and LF anywhere, and
 * whitespace, quotes, angle brackets and backticks it percent-encodes. Stored
 * as entered and echoed by an error, such a spelling could leave the tail of an
 * API key outside `redactEndpoints` (mc-wallet #672 review). Each test here pins
 * one side of the rule: refused when entered, carried to the canonical spelling
 * when an earlier build stored it, and removed whole by the redactor once it is
 * canonical.
 */
import { describe, expect, test } from "bun:test";
import {
  isServiceUrl,
  isServiceUrlList,
  isWebSocketServiceUrl,
  normalizeStoredServiceUrl,
  normalizeStoredWebSocketServiceUrl,
  REDACTED_ENDPOINT,
  redactEndpoints,
} from "@bramble/core/service-url";

const KEY = "node-key-123";
const NBSP = String.fromCharCode(0xa0);
const IDEOGRAPHIC = String.fromCharCode(0x3000);
const BASE = "https://rpc.example/v1";

// [raw spelling the parser accepts, the canonical spelling it is stored in]
const SPELLINGS: readonly (readonly [string, string])[] = [
  [`https:\\\\rpc.example\\v1\\${KEY}`, `${BASE}/${KEY}`],
  [`https:rpc.example/v1/${KEY}`, `${BASE}/${KEY}`],
  [`https:/rpc.example/v1/${KEY}`, `${BASE}/${KEY}`],
  [`HTTPS:///rpc.example/v1/${KEY}`, `${BASE}/${KEY}`],
  [`https:\t//rpc.example/v1/${KEY}`, `${BASE}/${KEY}`],
  [`ht\ttps://rpc.example/v1/${KEY}`, `${BASE}/${KEY}`],
  [`${BASE}/node-\tkey-123`, `${BASE}/${KEY}`],
  [`${BASE}/node-key\n-123`, `${BASE}/${KEY}`],
  [`${BASE}/node-key\r\n-123`, `${BASE}/${KEY}`],
  [`https://RPC.Example:443/v1/${KEY}`, `${BASE}/${KEY}`],
  [`${BASE}/../v1/${KEY}`, `${BASE}/${KEY}`],
  [`${BASE}/node key-123`, `${BASE}/node%20key-123`],
  [`${BASE}/node${NBSP}key-123`, `${BASE}/node%C2%A0key-123`],
  [`${BASE}/node${IDEOGRAPHIC}key-123`, `${BASE}/node%E3%80%80key-123`],
  [`${BASE}/node\fkey-123`, `${BASE}/node%0Ckey-123`],
  [`${BASE}/node\vkey-123`, `${BASE}/node%0Bkey-123`],
  [`${BASE}/node"key-123`, `${BASE}/node%22key-123`],
  [`${BASE}/node<key-123`, `${BASE}/node%3Ckey-123`],
  [`${BASE}/node>key-123`, `${BASE}/node%3Ekey-123`],
  [`${BASE}/node\`key-123`, `${BASE}/node%60key-123`],
  [`${BASE}?key=node key-123`, `${BASE}?key=node%20key-123`],
  // The parser keeps a backtick in a query and a quote or backtick in a host;
  // the canonical spelling encodes them too, for the same request.
  [`${BASE}?key=node\`key-123`, `${BASE}?key=node%60key-123`],
  [`https://rpc"node.example/${KEY}`, `https://rpc%22node.example/${KEY}`],
  [`http:\\\\localhost:8787\\${KEY}`, `http://localhost:8787/${KEY}`],
];

describe("canonical endpoint spelling", () => {
  test("refuses every raw spelling and carries it to the canonical one", () => {
    for (const [raw, canonical] of SPELLINGS) {
      expect(isServiceUrl(raw)).toBe(false);
      expect(normalizeStoredServiceUrl(raw)).toBe(canonical);
      expect(isServiceUrl(canonical)).toBe(true);
      expect(normalizeStoredServiceUrl(canonical)).toBe(canonical);
    }
  });

  test("the redactor removes every canonical spelling whole", () => {
    for (const [raw, canonical] of SPELLINGS) {
      expect(redactEndpoints(`failed at ${canonical} now`)).toBe(
        `failed at ${REDACTED_ENDPOINT} now`,
      );
      // Why storage must be canonical: past a space, quote or angle bracket the
      // raw spelling leaves the key's tail visible.
      if (/[\s"<>`]/u.test(raw.replaceAll(/[\t\r\n]/g, ""))) {
        expect(redactEndpoints(`failed at ${raw} now`)).toContain("key-123");
      }
    }
  });

  test("keeps a spelling that is already canonical, bare origins included", () => {
    for (const url of [
      "https://rpc.example",
      "https://rpc.example/",
      `${BASE}/`,
      `${BASE}?key=abc`,
      `${BASE}/node%20key`,
      "https://rpc.example./v1",
      "http://127.0.0.1:5050/rpc",
      "https://[::1]:8545",
    ]) {
      expect(isServiceUrl(url)).toBe(true);
      expect(normalizeStoredServiceUrl(url)).toBe(url);
    }
    // The parser serializes both bare spellings with a slash. Keeping each as
    // written leaves a stored list unique and a bundled default equal to itself.
    expect(isServiceUrlList(["https://rpc.example", "https://rpc.example/"])).toBe(true);
    expect(normalizeStoredServiceUrl("https://rpc.example\t")).toBe("https://rpc.example");
    expect(normalizeStoredServiceUrl("https://rpc.example/\t")).toBe("https://rpc.example/");
  });

  test("applies the same rule to WebSocket relays", () => {
    expect(isWebSocketServiceUrl("wss://relay.primal.net")).toBe(true);
    expect(isWebSocketServiceUrl("WSS://Relay.Example")).toBe(false);
    expect(normalizeStoredWebSocketServiceUrl("WSS://Relay.Example")).toBe("wss://relay.example");
    expect(normalizeStoredWebSocketServiceUrl("wss:\\\\relay.example\\k ey")).toBe(
      "wss://relay.example/k%20ey",
    );
    expect(normalizeStoredWebSocketServiceUrl(`${BASE}/${KEY}`)).toBe(`${BASE}/${KEY}`);
  });

  test("leaves a value the earlier rule refused for the validator to reject", () => {
    for (const value of [
      42,
      null,
      "",
      "ftp://rpc.example",
      "http://rpc.example",
      "https://user:pass@rpc.example",
      "https://rpc.example/#key",
    ]) {
      expect(normalizeStoredServiceUrl(value)).toBe(value);
      expect(isServiceUrl(value)).toBe(false);
    }
  });

  test("caps the canonical spelling, dropping a stored one that outgrows the cap", () => {
    const exact = `https://rpc.example/${"a".repeat(2048 - 20)}`;
    expect(exact.length).toBe(2048);
    expect(isServiceUrl(exact)).toBe(true);
    expect(isServiceUrl(`${exact}a`)).toBe(false);
    // 1,021 characters as entered, 3,021 once each space is percent-encoded.
    const spaced = `https://rpc.example/${" ".repeat(1000)}k`;
    expect(isServiceUrl(spaced)).toBe(false);
    expect(normalizeStoredServiceUrl(spaced)).toBeUndefined();
  });
});
