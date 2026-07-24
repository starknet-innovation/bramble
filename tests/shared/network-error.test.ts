/**
 * Tests for mapping raw transport failures to a friendly network-error line.
 */
import { expect, test } from "bun:test";

import { friendlyNetworkError, NETWORK_ERROR_MESSAGE } from "../../src/shared/network-error";

test("friendlyNetworkError maps fetch/RPC transport failures", () => {
  expect(friendlyNetworkError("Failed to fetch")).toBe(NETWORK_ERROR_MESSAGE);
  expect(friendlyNetworkError("TypeError: fetch failed")).toBe(NETWORK_ERROR_MESSAGE);
  expect(friendlyNetworkError("NetworkError when attempting to fetch resource")).toBe(
    NETWORK_ERROR_MESSAGE,
  );
  expect(friendlyNetworkError("connect ECONNREFUSED 127.0.0.1:5050")).toBe(NETWORK_ERROR_MESSAGE);
  expect(friendlyNetworkError("request timed out")).toBe(NETWORK_ERROR_MESSAGE);
});

test("friendlyNetworkError leaves domain errors unchanged", () => {
  expect(friendlyNetworkError("Invalid token balance response")).toBeNull();
  expect(friendlyNetworkError("no account for selected network")).toBeNull();
  expect(friendlyNetworkError("balances unavailable")).toBeNull();
});
