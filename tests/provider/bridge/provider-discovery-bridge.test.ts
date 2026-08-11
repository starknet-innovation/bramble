/**
 * Bridge checks for the discovery methods: api_version is negotiated at the
 * wire boundary, the supported-version lists reach the page as string arrays,
 * and ACCOUNT_DEPLOYMENT_DATA is padded and survives the wire validators.
 */
import { describe, expect, test } from "bun:test";
import {
  PAGE_TARGET,
  providerResponse,
  readProviderResponse,
  toProviderPayload,
  toRuntimeMessage,
} from "@mc-wallet/wallet-protocol/bridge";
import {
  accountAlreadyDeployed,
  apiVersionNotSupported,
  deploymentDataNotAvailable,
  unknownError,
} from "@mc-wallet/wallet-protocol/rpc-errors";

const requestId = "123e4567-e89b-42d3-a456-426614174000";

describe("provider discovery bridge", () => {
  test("forwards discovery methods and negotiates api_version", () => {
    expect(
      toRuntimeMessage({ id: "1", method: "wallet_supportedSpecs" }, "https://a.test"),
    ).toEqual({ origin: "https://a.test", type: "wallet.supportedSpecs" });
    expect(
      toRuntimeMessage({ id: "2", method: "wallet_supportedWalletApi" }, "https://a.test"),
    ).toEqual({ origin: "https://a.test", type: "wallet.supportedWalletApi" });
    expect(
      toRuntimeMessage({ id: "3", method: "wallet_deploymentData" }, "https://a.test"),
    ).toEqual({ origin: "https://a.test", type: "wallet.deploymentData" });
    expect(
      toRuntimeMessage(
        { id: "4", method: "wallet_supportedSpecs", params: { api_version: "0.7.2" } },
        "https://a.test",
      ),
    ).toEqual({ apiVersion: "0.7.2", origin: "https://a.test", type: "wallet.supportedSpecs" });
    // A malformed api_version param is rejected before it reaches the background.
    expect(
      toRuntimeMessage(
        { id: "5", method: "wallet_deploymentData", params: { api_version: "not-a-version" } },
        "https://a.test",
      ),
    ).toBeNull();
    expect(
      toRuntimeMessage(
        { id: "6", method: "wallet_supportedSpecs", params: { junk: true } },
        "https://a.test",
      ),
    ).toBeNull();
  });

  test("shapes discovery and deployment results for the page", () => {
    expect(toProviderPayload({ ok: true, versions: ["0.8.1"] }, "wallet_supportedSpecs")).toEqual({
      result: ["0.8.1"],
    });
    expect(
      toProviderPayload({ ok: true, versions: ["0.7.2"] }, "wallet_supportedWalletApi"),
    ).toEqual({ result: ["0.7.2"] });
    const deployment = {
      deployment: {
        address: "0x123",
        calldata: ["0x4718f5a0"],
        classHash: "0x2b31e19e",
        salt: "0x0",
        version: 1 as const,
      },
      ok: true as const,
    };
    const payload = toProviderPayload(deployment, "wallet_deploymentData");
    const result = payload.result as {
      readonly address: string;
      readonly calldata: readonly string[];
      readonly class_hash: string;
      readonly salt: string;
      readonly version: 0 | 1;
    };
    expect(result.address).toBe(`0x${"123".padStart(64, "0")}`);
    expect(result.class_hash).toBe(`0x${"2b31e19e".padStart(64, "0")}`);
    expect(result.salt).toBe(`0x${"0".padStart(64, "0")}`);
    expect(result.calldata).toEqual([`0x${"4718f5a0".padStart(64, "0")}`]);
    expect(result.version).toBe(1);
    // The padded deployment survives the page-facing wire validators round-trip.
    expect(providerResponse({ id: requestId, method: "wallet_deploymentData" }, payload)).toEqual({
      id: requestId,
      result,
      target: PAGE_TARGET,
    });
    expect(readProviderResponse({ id: requestId, result, target: PAGE_TARGET })).toEqual({
      id: requestId,
      result,
      target: PAGE_TARGET,
    });
    // A deployment carrying an unpaddable felt maps to UNKNOWN_ERROR.
    expect(
      toProviderPayload(
        { deployment: { ...deployment.deployment, address: "nope" }, ok: true },
        "wallet_deploymentData",
      ),
    ).toEqual({ error: unknownError() });
  });

  test("maps deployment-data and api-version errors to their spec codes", () => {
    expect(
      toProviderPayload({ error: "account already deployed" }, "wallet_deploymentData"),
    ).toEqual({ error: accountAlreadyDeployed() });
    expect(
      toProviderPayload({ error: "deployment data not available" }, "wallet_deploymentData"),
    ).toEqual({ error: deploymentDataNotAvailable() });
    expect(
      toProviderPayload({ error: "unsupported api version" }, "wallet_supportedWalletApi"),
    ).toEqual({ error: apiVersionNotSupported() });
  });
});
