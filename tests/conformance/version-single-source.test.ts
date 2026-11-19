/**
 * Guards that the advertised version strings have exactly one definition. Both
 * the REAL background discovery response and the conformance fixtures must read
 * from wallet-protocol/versions, so the wire values and test expectations can
 * never silently drift apart. Also pins wallet_supportedSpecs to the JSON-RPC
 * spec version the bundled starknet client actually targets (0.10.0).
 */
import { describe, expect, test } from "bun:test";
import {
  API_VERSION_PATTERN,
  SUPPORTED_SPECS,
  SUPPORTED_WALLET_API,
} from "@bramble/wallet-protocol/versions";
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
    expect(SUPPORTED_WALLET_API).toEqual(["0.10.5"]);
  });

  test("every advertised wallet-API version is a spec API_VERSION, with no pre-release suffix", () => {
    // wallet_rpc.json components.schemas.API_VERSION.pattern, copied verbatim.
    const specPattern = /^[0-9]+\.[0-9]+(\.[0-9]+)?$/;
    for (const version of SUPPORTED_WALLET_API) {
      expect(version).toMatch(specPattern);
    }
    for (const version of ["0.10", "0.10.5"]) {
      expect(API_VERSION_PATTERN.test(version)).toBe(true);
    }
    for (const version of ["0.10.5-rc.0", "0.10.4-rc.2", "0.10.5-beta", "0.10.5.1"]) {
      expect(API_VERSION_PATTERN.test(version)).toBe(false);
    }
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
