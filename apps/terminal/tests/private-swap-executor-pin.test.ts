/**
 * The pinned AVNU private-swap executor (#269). The browser and the server both
 * refuse unless the executor's live class hash equals the pinned one, failing
 * closed when it cannot be read, and the server refuses a build that names any
 * other executor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResponse } from "../api/_lib/http";
import { STARKNET_MAINNET_RPC_URL } from "../api/_lib/starknet-class";
import handler from "../api/private-swap/[action]";
import {
  checkPinnedExecutorClass,
  PRIVATE_SWAP_EXECUTOR,
  PRIVATE_SWAP_EXECUTOR_CLASS_HASH,
  PRIVATE_SWAP_FEE_TOKEN,
} from "../shared/privacy";
import {
  fetchPrivateSwapPlan,
  PRIVATE_SWAP_EXECUTOR_CHANGED,
  PRIVATE_SWAP_EXECUTOR_UNVERIFIED,
  provePrivateSwap,
  verifyPrivateSwapExecutor,
} from "../src/protocols/avnu/private-swap-client";

const sdk = vi.hoisted(() => ({
  buildPrivateSwapFee: vi.fn(),
  buildStrk20Actions: vi.fn(),
  getQuotes: vi.fn(),
  quoteToCalls: vi.fn(),
  submitPrivateSwap: vi.fn(),
}));
vi.mock("@avnu/avnu-sdk", () => sdk);

const EXECUTOR = "0x0426dcd1ab5fa2f852f138d07cb37708b00a4db999677fe2d0c9a440702dbe5e";
const CLASS_HASH = "0x3ff37c9dc8c2ea3930fbf27f62d7b9bdd6f0a63c8e77b11c64be4a69230fcee";
const OTHER_CLASS = "0x1234";
const MAINNET = "0x534e5f4d41494e";
const input = { buyToken: "0x5", sellAmount: "0x2", sellToken: "0x4", takerAddress: "0x7" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("executor pin", () => {
  it("pins the verified AVNU PrivacySwapHelper and its class", () => {
    expect(PRIVATE_SWAP_EXECUTOR).toBe(EXECUTOR);
    expect(PRIVATE_SWAP_EXECUTOR_CLASS_HASH).toBe(CLASS_HASH);
  });

  it("classifies class reads and fails closed", async () => {
    const check = (read: () => Promise<unknown>, executor: string | null = EXECUTOR) =>
      checkPinnedExecutorClass(read, executor, CLASS_HASH);
    await expect(check(async () => CLASS_HASH)).resolves.toBe("ok");
    // Leading zeros do not change the felt.
    await expect(check(async () => `0x0${CLASS_HASH.slice(2)}`)).resolves.toBe("ok");
    await expect(check(async () => OTHER_CLASS)).resolves.toBe("class_mismatch");
    await expect(check(async () => "0x0")).resolves.toBe("class_mismatch");
    await expect(check(() => Promise.reject(new Error("down")))).resolves.toBe("class_unavailable");
    await expect(check(async () => undefined)).resolves.toBe("class_unavailable");
    await expect(check(async () => "not-a-felt")).resolves.toBe("class_unavailable");
    await expect(check(async () => 123)).resolves.toBe("class_unavailable");
    await expect(check(async () => CLASS_HASH, null)).resolves.toBe("not_pinned");
  });
});

describe("browser executor guard", () => {
  it.each([
    ["a different class", async () => OTHER_CLASS, PRIVATE_SWAP_EXECUTOR_CHANGED],
    ["a failed class read", () => Promise.reject(new Error("rpc down")), PRIVATE_SWAP_EXECUTOR_UNVERIFIED],
    ["a malformed class read", async () => "nope", PRIVATE_SWAP_EXECUTOR_UNVERIFIED],
  ])("refuses to plan on %s before contacting the route service", async (_name, read, message) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(fetchPrivateSwapPlan(input, read)).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the pinned executor's class, and re-checks it at handoff", async () => {
    const read = vi.fn(async () => CLASS_HASH);
    await expect(verifyPrivateSwapExecutor(read)).resolves.toBe(EXECUTOR);
    expect(read).toHaveBeenCalledWith(EXECUTOR);
    await expect(verifyPrivateSwapExecutor(async () => OTHER_CLASS)).rejects.toThrow(
      PRIVATE_SWAP_EXECUTOR_CHANGED,
    );
    await expect(verifyPrivateSwapExecutor(() => Promise.reject(new Error("x")))).rejects.toThrow(
      PRIVATE_SWAP_EXECUTOR_UNVERIFIED,
    );
  });
});

describe("browser handoff guard", () => {
  it("hands the swap to the wallet only after the class re-check passes", async () => {
    const prove = vi.fn(async () => "proof");
    await expect(provePrivateSwap(prove, async () => CLASS_HASH)).resolves.toBe("proof");
    expect(prove).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a different class", async () => OTHER_CLASS, PRIVATE_SWAP_EXECUTOR_CHANGED],
    ["a failed class read", () => Promise.reject(new Error("rpc down")), PRIVATE_SWAP_EXECUTOR_UNVERIFIED],
  ])("never opens the wallet on %s", async (_name, read, message) => {
    const prove = vi.fn(async () => "proof");
    await expect(provePrivateSwap(prove, read)).rejects.toThrow(message);
    expect(prove).not.toHaveBeenCalled();
  });
});

describe("server executor guard", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_ALLOWED_ORIGINS", "https://terminal.example");
    sdk.getQuotes.mockResolvedValue([
      {
        buyAmount: 5n,
        buyTokenAddress: "0x5",
        chainId: MAINNET,
        quoteId: "quote-1",
        sellAmount: 2n,
        sellTokenAddress: "0x4",
      },
    ]);
    sdk.buildPrivateSwapFee.mockResolvedValue({
      amount: 1n,
      recipient: "0x6",
      token: PRIVATE_SWAP_FEE_TOKEN,
    });
    sdk.quoteToCalls.mockResolvedValue({
      calls: [{ calldata: ["0x1"], contractAddress: "0x4", entrypoint: "approve" }],
      chainId: MAINNET,
      executorAddress: EXECUTOR,
    });
    sdk.buildStrk20Actions.mockReturnValue([]);
    sdk.submitPrivateSwap.mockResolvedValue({ transactionHash: "0x99" });
  });

  const rpcAnswer = (body: unknown, status = 200) =>
    vi.fn(async (url: unknown, _init?: RequestInit) => {
      expect(url).toBe(STARKNET_MAINNET_RPC_URL);
      return new Response(JSON.stringify(body), { status });
    });

  const call = async (action: string, body: Record<string, unknown>) => {
    const status = vi.fn();
    const json = vi.fn();
    const response = { json, setHeader: vi.fn(), status };
    status.mockReturnValue(response);
    await handler(
      {
        body,
        headers: { origin: "https://terminal.example" },
        method: "POST",
        query: { action },
      } as unknown as ApiRequest,
      response as unknown as ApiResponse,
    );
    return { json, status };
  };

  const feeMode = { poolFeeToken: PRIVATE_SWAP_FEE_TOKEN, tip: "normal" };
  const planBody = { ...input, feeMode };
  const submitBody = {
    callAndProof: {
      call: {
        calldata: ["0x1"],
        contractAddress: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
        entrypoint: "apply_actions",
      },
      proof: { data: "proof", proofFacts: ["0x2"] },
    },
    feeMode,
  };

  it("plans when the executor runs the pinned class and the build names it", async () => {
    const fetch = rpcAnswer({ id: 1, jsonrpc: "2.0", result: CLASS_HASH });
    vi.stubGlobal("fetch", fetch);
    const { json, status } = await call("plan", planBody);
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ executor: EXECUTOR });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      method: "starknet_getClassHashAt",
      params: { block_id: "latest", contract_address: EXECUTOR },
    });
  });

  it("refuses a build that names another executor", async () => {
    vi.stubGlobal("fetch", rpcAnswer({ id: 1, jsonrpc: "2.0", result: CLASS_HASH }));
    sdk.quoteToCalls.mockResolvedValue({
      calls: [{ calldata: ["0x1"], contractAddress: "0x4", entrypoint: "approve" }],
      chainId: MAINNET,
      executorAddress: "0x9",
    });
    const { json, status } = await call("plan", planBody);
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({ error: "invalid_private_swap_plan" });
    expect(sdk.buildStrk20Actions).not.toHaveBeenCalled();
  });

  it.each([
    ["plan", planBody],
    ["submit", submitBody],
  ])("refuses %s when the executor runs a different class", async (action, body) => {
    vi.stubGlobal("fetch", rpcAnswer({ id: 1, jsonrpc: "2.0", result: OTHER_CLASS }));
    const { json, status } = await call(action, body);
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ error: "private_swap_executor_class_mismatch" });
    expect(sdk.getQuotes).not.toHaveBeenCalled();
    expect(sdk.buildPrivateSwapFee).not.toHaveBeenCalled();
    expect(sdk.submitPrivateSwap).not.toHaveBeenCalled();
  });

  it.each([
    ["a transport failure", () => vi.fn(() => Promise.reject(new TypeError("fetch failed")))],
    ["an HTTP error", () => rpcAnswer({ id: 1, jsonrpc: "2.0", result: CLASS_HASH }, 500)],
    ["a JSON-RPC error", () => rpcAnswer({ error: { code: 20, message: "Contract not found" }, id: 1 })],
    ["an error beside a result", () => rpcAnswer({ error: { code: 20, message: "x" }, id: 1, result: CLASS_HASH })],
    ["a malformed result", () => rpcAnswer({ id: 1, jsonrpc: "2.0", result: "nope" })],
    ["an oversized response", () => rpcAnswer({ id: 1, jsonrpc: "2.0", result: CLASS_HASH, pad: "0".repeat(5_000) })],
  ])("fails closed on %s", async (_name, makeFetch) => {
    vi.stubGlobal("fetch", makeFetch());
    for (const [action, body] of [
      ["plan", planBody],
      ["submit", submitBody],
    ] as const) {
      const { json, status } = await call(action, body);
      expect(status).toHaveBeenCalledWith(503);
      expect(json).toHaveBeenCalledWith({ error: "private_swap_executor_class_unavailable" });
    }
    expect(sdk.getQuotes).not.toHaveBeenCalled();
    expect(sdk.submitPrivateSwap).not.toHaveBeenCalled();
  });

  it("relays a proof once the executor class is re-checked", async () => {
    vi.stubGlobal("fetch", rpcAnswer({ id: 1, jsonrpc: "2.0", result: CLASS_HASH }));
    const { json, status } = await call("submit", submitBody);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ transactionHash: "0x99" });
  });
});
