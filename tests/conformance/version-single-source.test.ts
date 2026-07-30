/**
 * Guards that the advertised version strings have exactly one definition. Both
 * the REAL background discovery response and the conformance fixtures must read
 * from src/shared/versions, so the wire values and the test expectations can
 * never silently drift apart. Also pins wallet_supportedSpecs to the JSON-RPC
 * spec version the bundled starknet client actually targets (0.10.0).
 */
import { describe, expect, test } from "bun:test";
import { SUPPORTED_SPECS, SUPPORTED_WALLET_API } from "../../src/shared/versions";
import { buildHarness, CONTENT_SENDER } from "./harness";
import { API_VERSION, ORIGIN } from "./spec-fixtures";
import { specMethod } from "./wallet-rpc-spec";

describe("wallet version single source", () => {
  test("discovery runtime response reads SUPPORTED_SPECS from the versions module", async () => {
    const { handler } = buildHarness();
    const response = await handler(
      { origin: ORIGIN, type: "wallet.supportedSpecs" },
      CONTENT_SENDER,
    );
    expect(response).toEqual({ ok: true, versions: [...SUPPORTED_SPECS] });
  });

  test("conformance supportedSpecs fixture reads the same SUPPORTED_SPECS constant", () => {
    expect(specMethod("wallet_supportedSpecs").backgroundResult).toEqual({
      ok: true,
      versions: [...SUPPORTED_SPECS],
    });
  });

  test("conformance API_VERSION fixture derives from SUPPORTED_WALLET_API", () => {
    expect(API_VERSION).toBe(SUPPORTED_WALLET_API[0]);
    expect(SUPPORTED_WALLET_API).toEqual(["0.10.4-rc.0"]);
  });

  test("wallet_supportedSpecs reports the JSON-RPC spec version 0.10.0", async () => {
    expect(SUPPORTED_SPECS).toEqual(["0.10.0"]);
    const { handler } = buildHarness();
    const response = await handler(
      { origin: ORIGIN, type: "wallet.supportedSpecs" },
      CONTENT_SENDER,
    );
    expect(response).toEqual({ ok: true, versions: ["0.10.0"] });
  });
});
