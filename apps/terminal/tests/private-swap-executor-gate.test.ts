/** Unverified executor deployments never receive tokens through private-swap plans. */
import { afterEach, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResponse } from "../api/_lib/http";
import handler from "../api/private-swap/[action]";
import { PRIVATE_SWAP_EXECUTOR } from "../shared/privacy";
import {
  fetchPrivateSwapPlan,
  submitPrivateSwapProof,
} from "../src/protocols/avnu/private-swap-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("refuses a private plan before contacting a route service without a reviewed executor", async () => {
  expect(PRIVATE_SWAP_EXECUTOR).toBeNull();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    fetchPrivateSwapPlan({
      buyToken: "0x1",
      sellToken: "0x2",
      sellAmount: "0x3",
      takerAddress: "0x4",
    }),
  ).rejects.toThrow("executor verification is pending");
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses a proof submission before contacting the paymaster boundary without a reviewed executor", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    submitPrivateSwapProof(
      {
        call: { calldata: ["0x1"], contract_address: "0x2", entry_point: "apply_actions" },
        proof: { data: ["0x3"], proof_facts: ["0x4"] },
      } as unknown as Parameters<typeof submitPrivateSwapProof>[0],
      { poolFeeToken: "0x5", tip: "normal" } as unknown as Parameters<typeof submitPrivateSwapProof>[1],
    ),
  ).rejects.toThrow("executor verification is pending");
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses direct server plan requests before any upstream operation", async () => {
  vi.stubEnv("TERMINAL_ALLOWED_ORIGINS", "https://terminal.example");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const status = vi.fn();
  const json = vi.fn();
  const response = { setHeader: vi.fn(), status, json };
  status.mockReturnValue(response);
  await handler(
    {
      method: "POST",
      headers: { origin: "https://terminal.example" },
      query: { action: "plan" },
    } as unknown as ApiRequest,
    response as unknown as ApiResponse,
  );
  expect(status).toHaveBeenCalledWith(503);
  expect(json).toHaveBeenCalledWith({ error: "private_swap_executor_not_verified" });
  expect(fetch).not.toHaveBeenCalled();
});

// Sherlock 195: `fee` and `submit` spend the operator's paymaster credential
// too, so they are refused while private swaps are off, before any upstream.
it.each(["fee", "submit"])(
  "refuses direct %s requests before any upstream operation",
  async (action) => {
    vi.stubEnv("TERMINAL_ALLOWED_ORIGINS", "https://terminal.example");
    vi.stubEnv("AVNU_PAYMASTER_API_KEY", "operator-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const status = vi.fn();
    const json = vi.fn();
    const response = { setHeader: vi.fn(), status, json };
    status.mockReturnValue(response);
    await handler(
      {
        body: JSON.stringify({ feeMode: { poolFeeToken: "0x1" } }),
        method: "POST",
        headers: { origin: "https://terminal.example" },
        query: { action },
      } as unknown as ApiRequest,
      response as unknown as ApiResponse,
    );
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ error: "private_swap_executor_not_verified" });
    expect(fetch).not.toHaveBeenCalled();
  },
);
