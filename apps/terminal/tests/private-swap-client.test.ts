import { avnuRouteCalldata, type AvnuRouteFixture } from "@bramble/testkit/avnu-route";
import { transaction } from "starknet";
import { AVNU_ADDRESSES } from "../src/protocols/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_SWAP_FEE_TOKEN } from "../shared/privacy";
import { fetchPrivateSwapPlan, submitPrivateSwapProof } from "../src/protocols/avnu/private-swap-client";

const executorCalldata = (overrides: Partial<AvnuRouteFixture> = {}) => [
  "0x5",
  ...transaction
    .fromCallsToExecuteCalldata_cairo1([
      {
        contractAddress: "0x4",
        entrypoint: "approve",
        calldata: [AVNU_ADDRESSES.exchange, "0x2", "0x0"],
      },
      {
        contractAddress: AVNU_ADDRESSES.exchange,
        entrypoint: "multi_route_swap",
        calldata: avnuRouteCalldata({
          sellToken: "0x4",
          buyToken: "0x5",
          sellAmount: 2n,
          buyAmount: 5n,
          minBuyAmount: 4n,
          beneficiary: "0x3",
          ...overrides,
        }),
      },
    ])
    .map((felt) => `0x${BigInt(felt).toString(16)}`),
  "${openNoteIds[0]}",
];

const transactionHash = `0x01${"0".repeat(62)}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private swap server boundary", () => {
  it("validates a server-built action plan before wallet handoff", async () => {
    const route = {
      actions: [
        { amount: "0x2", recipient: "0x3", token: "0x4", type: "withdraw" },
        {
          amount: "0x1",
          recipient: "0x6",
          token: PRIVATE_SWAP_FEE_TOKEN,
          type: "withdraw",
        },
        { amount: "OPEN", recipient: "0x7", token: "0x5", type: "transfer" },
        {
          calldata: executorCalldata(),
          contract: "0x3",
          type: "invoke",
        },
      ],
      buyAmount: "0x5",
      executor: "0x3",
      fee: { amount: "0x1", recipient: "0x6", token: PRIVATE_SWAP_FEE_TOKEN },
      quoteId: "quote-1",
      sellAmount: "0x2",
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(route), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...route,
            actions: route.actions.map((action, index) =>
              index === 2 ? { ...action, recipient: "0x8" } : action,
            ),
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...route,
          actions: route.actions.map((action, index) =>
            index === 3 ? { ...action, calldata: executorCalldata({ minBuyAmount: 0n }) } : action,
          ),
        }),
        { status: 200 },
      ),
    );
    const input = {
      buyToken: "0x5",
      sellAmount: "0x2",
      sellToken: "0x4",
      takerAddress: "0x7",
    };
    await expect(fetchPrivateSwapPlan(input)).resolves.toMatchObject({
      actions: [
        { type: "withdraw" },
        { type: "withdraw" },
        { type: "transfer" },
        { type: "invoke" },
      ],
      executor: "0x3",
      quoteId: "quote-1",
    });
    await expect(fetchPrivateSwapPlan(input)).rejects.toThrow("substituted route");
    await expect(fetchPrivateSwapPlan(input)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledWith(
      "/api/private-swap/plan",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("submits only a complete proof and rejects malformed transaction results", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transactionHash }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transactionHash: "bad" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    const proof = {
      call: {
        calldata: ["0x1"],
        contract_address: "0x2",
        entry_point: "apply_actions",
      },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
    };

    await expect(
      submitPrivateSwapProof(proof, {
        poolFeeToken: PRIVATE_SWAP_FEE_TOKEN,
        tip: "normal",
      }),
    ).resolves.toBe(transactionHash);
    await expect(
      submitPrivateSwapProof(proof, {
        poolFeeToken: PRIVATE_SWAP_FEE_TOKEN,
        tip: "normal",
      }),
    ).rejects.toThrow("invalid transaction hash");
  });
});
