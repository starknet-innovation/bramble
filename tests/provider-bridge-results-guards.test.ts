/**
 * Bridge-results parser guards: the optional api_version reader, invoke-call
 * calldata coercion and rejection arms, and the typed-data param extractor's
 * missing-params branch.
 */
import { describe, expect, test } from "bun:test";
import {
  providerInvokeCalls,
  readApiVersionParam,
  readTypedDataParam,
} from "../src/provider/bridge-results";
import type { Json } from "../src/shared/json";

const asJson = (value: unknown): Json => value as Json;

describe("readApiVersionParam", () => {
  test("returns undefined when params carry no api_version key", () => {
    expect(readApiVersionParam({})).toBeUndefined();
    expect(readApiVersionParam(undefined)).toBeUndefined();
  });

  test("returns the version when present and well-formed", () => {
    expect(readApiVersionParam({ api_version: "1.2.3" })).toBe("1.2.3");
  });

  test("returns null for an unknown key or malformed version", () => {
    expect(readApiVersionParam(asJson({ other: 1 }))).toBeNull();
    expect(readApiVersionParam({ api_version: "not-a-version" })).toBeNull();
  });
});

describe("providerInvokeCalls calldata arms", () => {
  test("coerces non-negative bigint calldata entries to felts", () => {
    const calls = providerInvokeCalls(
      asJson({
        invoke_transaction: [{ calldata: [5n], contract_address: "0x1", entry_point: "t" }],
      }),
    );
    expect(calls).toEqual([{ calldata: ["0x5"], contractAddress: "0x1", entrypoint: "t" }]);
  });

  test("rejects a call that is not a record", () => {
    expect(providerInvokeCalls(asJson({ calls: [42] }))).toBeNull();
  });

  test("rejects a call whose calldata carries a non-felt entry", () => {
    expect(
      providerInvokeCalls(
        asJson({ calls: [{ calldata: [{}], contractAddress: "0x1", entrypoint: "t" }] }),
      ),
    ).toBeNull();
  });
});

describe("readTypedDataParam", () => {
  test("returns null when params are absent", () => {
    expect(readTypedDataParam(undefined)).toBeNull();
  });

  test("unwraps the spec typed_data and legacy typedData wrappers", () => {
    const typedData = { domain: {}, message: {}, primaryType: "X", types: {} };
    expect(readTypedDataParam({ typed_data: typedData })).toEqual(typedData);
    expect(readTypedDataParam({ typedData })).toEqual(typedData);
  });
});
