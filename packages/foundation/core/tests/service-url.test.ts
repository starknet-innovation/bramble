/**
 * Shared service URL policy and normalization checks.
 */
import { describe, expect, test } from "bun:test";
import { isServiceUrl, trimTrailingSlashes } from "@mc-wallet/core/service-url";

describe("service URLs", () => {
  test("accepts reviewed transports and rejects credentialed or remote HTTP URLs", () => {
    expect(isServiceUrl("https://service.example/path")).toBe(true);
    expect(isServiceUrl("http://localhost:8787")).toBe(true);
    expect(isServiceUrl("http://service.example")).toBe(false);
    expect(isServiceUrl("https://user:pass@service.example")).toBe(false);
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
});
