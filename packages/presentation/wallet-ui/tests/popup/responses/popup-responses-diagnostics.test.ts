/**
 * Support-diagnostics response validator, with the privacy-job lane: the
 * export a user downloads after a stuck shield carries where each tracked job
 * spent its time and how it ended, as fixed labels and numbers only. A row
 * that carries anything else fails the whole export rather than being shown.
 */
import { describe, expect, test } from "bun:test";
import { isSupportDiagnosticsResponse } from "../../../src/popup/responses/responses-diagnostics";

const diagnostics = () => ({
  accountCount: 2,
  collectionEnabled: true,
  explorer: [{ count: 1, latencyMs: 30, outcome: "ok", service: "starkscan" }],
  hasVault: true,
  locked: false,
  networkId: "SN_MAIN",
  privacy: [
    { count: 1, durationMs: 41_000, kind: "deposit", outcome: "ok", phase: "proving" },
    { count: 1, durationMs: 62_500, kind: "deposit", outcome: "timeout", phase: "job" },
    { count: 2, durationMs: 800, kind: "execute", outcome: "ok", phase: "relaying privately" },
    { count: 1, durationMs: 3_000, kind: "register", outcome: "error", phase: "job" },
  ],
  ready: true,
  rpc: [{ count: 3, endpoint: "wallet-gateway", latencyMs: 42, outcome: "ok" }],
});

describe("isSupportDiagnosticsResponse", () => {
  test("accepts the sanitized report with its privacy-job rows", () => {
    expect(isSupportDiagnosticsResponse({ diagnostics: diagnostics(), ok: true })).toBe(true);
    expect(
      isSupportDiagnosticsResponse({ diagnostics: { ...diagnostics(), privacy: [] }, ok: true }),
    ).toBe(true);
  });

  test("requires the privacy lane and refuses an identifier-carrying report", () => {
    const { privacy: _privacy, ...withoutPrivacy } = diagnostics();
    expect(isSupportDiagnosticsResponse({ diagnostics: withoutPrivacy, ok: true })).toBe(false);
    expect(
      isSupportDiagnosticsResponse({ diagnostics: { ...diagnostics(), address: "0x1" }, ok: true }),
    ).toBe(false);
  });

  test("refuses a privacy row outside the fixed labels and bounds", () => {
    for (const row of [
      { count: 1, durationMs: 1, kind: "deposit", outcome: "ok", phase: "" },
      { count: 1, durationMs: 1, kind: "deposit", outcome: "ok", phase: "x".repeat(65) },
      { count: 1, durationMs: 1, kind: "shield", outcome: "ok", phase: "proving" },
      { count: 1, durationMs: 1, kind: "deposit", outcome: "stuck", phase: "proving" },
      { count: 1.5, durationMs: 1, kind: "deposit", outcome: "ok", phase: "proving" },
      { count: 1, durationMs: "1", kind: "deposit", outcome: "ok", phase: "proving" },
      { count: 1, durationMs: 1, hash: "0x1", kind: "deposit", outcome: "ok", phase: "proving" },
    ]) {
      expect(
        isSupportDiagnosticsResponse({
          diagnostics: { ...diagnostics(), privacy: [row] },
          ok: true,
        }),
      ).toBe(false);
    }
  });
});
