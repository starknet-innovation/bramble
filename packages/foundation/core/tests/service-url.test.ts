/**
 * Shared service URL policy and normalization checks.
 */
import { describe, expect, test } from "bun:test";
import {
  isBoundedServiceUrlList,
  isServiceUrl,
  isWebSocketServiceUrl,
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

  test("bounds the number of entries in a dapp endpoint list (Sherlock audit 153)", () => {
    const urls = (count: number) =>
      Array.from({ length: count }, (_, index) => `https://rpc${index}.example`);
    expect(isBoundedServiceUrlList(urls(4), 4)).toBe(true);
    expect(isBoundedServiceUrlList(urls(5), 4)).toBe(false);
    expect(isBoundedServiceUrlList([], 4)).toBe(false);
    expect(isBoundedServiceUrlList(["ftp://rpc.example"], 4)).toBe(false);
  });
});
