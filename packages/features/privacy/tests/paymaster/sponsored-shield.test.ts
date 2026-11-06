/**
 * Sponsored first shield (#789) boundary tests. The relay pays the pool fee and
 * gas, so the wallet's guarantees are: the quote commits to exactly the deposit
 * approvals for this account and chain, under sponsored parameters, with no fee
 * action of any kind; and only a clean refusal is a refusal at broadcast.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  quoteSponsoredShield,
  SPONSORED_SHIELD_DECLINED,
  SPONSORED_SHIELD_EXPIRED,
  SPONSORED_SHIELD_NETWORKS,
  SPONSORED_SHIELD_SPONSOR,
  SponsoredShieldRefusedError,
  SponsoredShieldUnavailableError,
  type Strk20SponsoredShieldPlan,
  sponsoredShieldConfig,
  submitSponsoredShield,
  summarizeSponsoredShield,
} from "@bramble/privacy/sponsored-shield";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { type Call, OutsideExecutionVersion, outsideExecution } from "starknet";
import { paymasterChainId as CHAIN_ID, paymasterResponse as response } from "../support/paymaster";

const ACCOUNT = "0x123";
const POOL = "0x2";
const TOKEN = "0x77";
const config = { url: "https://gateway.test/api/sponsored-shield" };
const NOW = 100;
const APPROVALS: readonly Call[] = [
  { calldata: [POOL, "0x500", "0x0"], contractAddress: TOKEN, entrypoint: "approve" },
];
const POOL_CALL: Call = { calldata: ["0x1"], contractAddress: POOL, entrypoint: "apply_actions" };
const PROOF = { data: "AAEC", output: ["0xb"], proof_facts: ["0xc"] };

const typedDataFor = (
  calls: readonly Call[] = APPROVALS,
  chainId = CHAIN_ID,
  window = { execute_after: "0x1", execute_before: "0x2710" },
) =>
  outsideExecution.getTypedData(
    chainId,
    { caller: "0x99", ...window },
    "0x5",
    [...calls],
    OutsideExecutionVersion.V2,
  );

const quoteResult = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  fee: { estimated_fee_in_strk: "0x0010", suggested_max_fee_in_strk: "0x20" },
  parameters: { fee_mode: { mode: "sponsored" }, version: "0x1" },
  type: "invoke_and_apply_action",
  typed_data: typedDataFor(),
  ...overrides,
});

const relay =
  (answer: () => Response | Promise<Response>, requests: Record<string, unknown>[] = []) =>
  async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(JSON.parse(String(init?.body)));
    return answer();
  };

const refusal = (): Response =>
  new Response(
    JSON.stringify({
      error: { code: 163, message: "sponsored_budget_exhausted" },
      id: "bramble-strk20",
      jsonrpc: "2.0",
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );

const quote = (http: ReturnType<typeof relay>, approveCalls: readonly Call[] = APPROVALS) =>
  quoteSponsoredShield({
    accountAddress: ACCOUNT,
    approveCalls,
    chainId: CHAIN_ID,
    config,
    http,
    nowSeconds: NOW,
    poolAddress: POOL,
  });

describe("sponsored shield configuration", () => {
  test("asks the wallet gateway on mainnet and Sepolia; the gateway is the switch", () => {
    expect(SPONSORED_SHIELD_NETWORKS).toEqual({
      SN_MAIN: { url: "https://wallet.nodes.starknet.org/api/sponsored-shield/mainnet" },
      SN_SEPOLIA: { url: "https://wallet.nodes.starknet.org/api/sponsored-shield/sepolia" },
    });
    expect(sponsoredShieldConfig("SN_MAIN")).toEqual({
      url: "https://wallet.nodes.starknet.org/api/sponsored-shield/mainnet",
    });
    expect(sponsoredShieldConfig("SN_SEPOLIA")).toEqual({
      url: "https://wallet.nodes.starknet.org/api/sponsored-shield/sepolia",
    });
    expect(sponsoredShieldConfig("SN_SEPOLIA", {})).toBeNull();
    expect(sponsoredShieldConfig("SN_SEPOLIA", { SN_MAIN: config })).toBeNull();
    expect(sponsoredShieldConfig("SN_SEPOLIA", { SN_SEPOLIA: config })).toEqual(config);
    expect(SPONSORED_SHIELD_SPONSOR).toBe("Starknet Foundation");
  });
});

describe("sponsored shield quote", () => {
  test("sends the contract's request and freezes a fee-free plan", async () => {
    const requests: Record<string, unknown>[] = [];
    const plan = await quote(relay(() => response(quoteResult()), requests));
    expect(requests[0]).toEqual({
      id: "bramble-strk20",
      jsonrpc: "2.0",
      method: "paymaster_buildTransaction",
      params: {
        parameters: { fee_mode: { mode: "sponsored" }, version: "0x1" },
        transaction: {
          apply_action: { pool_address: POOL },
          invoke: {
            calls: [
              {
                calldata: [POOL, "0x500", "0x0"],
                selector: "0x219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c",
                to: TOKEN,
              },
            ],
            user_address: ACCOUNT,
          },
          type: "invoke_and_apply_action",
        },
      },
    });
    expect(plan).toEqual({
      authorization: {
        caller: "0x99",
        executeAfter: "0x1",
        executeBefore: "0x2710",
        publicCallCount: 1,
      },
      estimatedNetworkFeeFri: "0x10",
      mode: "sponsored-deposit",
      sponsor: "Starknet Foundation",
      typedData: typedDataFor(),
    });
  });

  test("accepts a quote with no gas estimate and leaves the estimate out", async () => {
    const plan = await quote(relay(() => response(quoteResult({ fee: undefined }))));
    expect(plan.estimatedNetworkFeeFri).toBeUndefined();
  });

  const unusable: readonly [string, Record<string, unknown>][] = [
    [
      "a fee action",
      { fee_action: { amount: "0x1", recipient: "0x9", token: TOKEN, type: "withdraw" } },
    ],
    ["a null fee action", { fee_action: null }],
    ["another transaction type", { type: "apply_action" }],
    [
      "a paid fee mode",
      { parameters: { fee_mode: { mode: "sponsored_private" }, version: "0x1" } },
    ],
    [
      "time bounds",
      { parameters: { fee_mode: { mode: "sponsored" }, time_bounds: {}, version: "0x1" } },
    ],
    ["a malformed fee", { fee: { estimated_fee_in_strk: 16 } }],
    ["no typed data", { typed_data: undefined }],
    [
      "typed data that also approves the pool fee",
      {
        typed_data: typedDataFor([
          ...APPROVALS,
          { calldata: [POOL, "0x9", "0x0"], contractAddress: "0x4", entrypoint: "approve" },
        ]),
      },
    ],
    ["typed data for another chain", { typed_data: typedDataFor(APPROVALS, "0x534e5f4d41494e") }],
    [
      "an authorization window that has closed",
      {
        typed_data: typedDataFor(APPROVALS, CHAIN_ID, {
          execute_after: "0x1",
          execute_before: "0x64",
        }),
      },
    ],
    ["an unknown top-level field", { proof: [] }],
  ];

  for (const [name, overrides] of unusable) {
    test(`treats a quote with ${name} as unusable, never as a sponsor's yes`, async () => {
      const result = quoteResult(overrides);
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete result[key];
      }
      await expect(quote(relay(() => response(result)))).rejects.toBeInstanceOf(
        SponsoredShieldUnavailableError,
      );
    });
  }

  test("reads only the relay's own clean JSON-RPC error as a refusal", async () => {
    const refused = await quote(relay(refusal)).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SponsoredShieldRefusedError);
    expect((refused as SponsoredShieldRefusedError).reason).toBe("sponsored_budget_exhausted");
    for (const answer of [
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 503 }),
      () => Promise.reject(new TypeError("network")),
    ]) {
      await expect(quote(relay(answer))).rejects.toBeInstanceOf(SponsoredShieldUnavailableError);
    }
  });

  test("never asks for a batch with no approvals or with another call in it", async () => {
    const requests: Record<string, unknown>[] = [];
    const http = relay(() => response(quoteResult()), requests);
    await expect(quote(http, [])).rejects.toBeInstanceOf(SponsoredShieldUnavailableError);
    await expect(quote(http, [POOL_CALL])).rejects.toBeInstanceOf(SponsoredShieldUnavailableError);
    expect(requests).toHaveLength(0);
  });
});

describe("sponsored shield broadcast", () => {
  const plan: Strk20SponsoredShieldPlan = {
    authorization: {
      caller: "0x99",
      executeAfter: "0x1",
      executeBefore: "0x2710",
      publicCallCount: 1,
    },
    mode: "sponsored-deposit",
    sponsor: SPONSORED_SHIELD_SPONSOR,
    typedData: typedDataFor(),
  };

  const submit = (
    http: ReturnType<typeof relay>,
    options: { readonly authorized?: boolean; readonly now?: number } = {},
  ) => {
    const signed: unknown[] = [];
    const outcome = submitSponsoredShield({
      accountAddress: ACCOUNT,
      call: POOL_CALL,
      config,
      http,
      isAuthorized: () => options.authorized ?? true,
      nowSeconds: options.now ?? NOW,
      plan,
      proof: PROOF,
      signTypedData: async (value) => {
        signed.push(value);
        return ["0x1", "0x2"];
      },
    });
    return { outcome, signed };
  };

  test("sends the frozen typed data, its signature, the pool call and the proof", async () => {
    const requests: Record<string, unknown>[] = [];
    const { outcome, signed } = submit(
      relay(() => response({ transaction_hash: "0xabc" }), requests),
    );
    expect(await outcome).toEqual({ transactionHash: "0xabc" });
    expect(signed).toEqual([plan.typedData]);
    expect(requests[0]).toEqual({
      id: "bramble-strk20",
      jsonrpc: "2.0",
      method: "paymaster_executeTransaction",
      params: {
        parameters: { fee_mode: { mode: "sponsored" }, version: "0x1" },
        transaction: {
          apply_action: {
            apply_actions_call: {
              calldata: ["0x1"],
              selector: expect.any(String),
              to: POOL,
            },
            proof: "AAEC",
            proof_facts: ["0xc"],
          },
          invoke: { signature: ["0x1", "0x2"], typed_data: plan.typedData, user_address: ACCOUNT },
          type: "invoke_and_apply_action",
        },
      },
    });
  });

  test("refuses before sending when locked or when the window has run out", async () => {
    const requests: Record<string, unknown>[] = [];
    const http = relay(() => response({ transaction_hash: "0xabc" }), requests);
    await expect(submit(http, { authorized: false }).outcome).rejects.toThrow("wallet locked");
    const expired = submit(http, { now: 0x2710 - 5 });
    await expect(expired.outcome).rejects.toThrow(SPONSORED_SHIELD_EXPIRED);
    expect(expired.signed).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  test("shows a clean refusal as declined with nothing sent", async () => {
    const refused = await submit(relay(refusal)).outcome.catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(WalletError);
    expect(refused).not.toBeInstanceOf(IndeterminateRpcWriteError);
    expect((refused as Error).message).toBe(SPONSORED_SHIELD_DECLINED);
  });

  test("reads every other answer as status unknown, so nothing is re-sent", async () => {
    for (const answer of [
      () => Promise.reject(new TypeError("reset")),
      () => new Response("", { status: 502 }),
      () => new Response("not json", { status: 200 }),
      () => response({}),
      () => response({ transaction_hash: "0x0" }),
    ]) {
      await expect(submit(relay(answer)).outcome).rejects.toBeInstanceOf(
        IndeterminateRpcWriteError,
      );
    }
  });
});

describe("sponsored shield review line", () => {
  test("names the sponsor and every charge it pays", () => {
    const plan: Strk20SponsoredShieldPlan = {
      authorization: {
        caller: "0x99",
        executeAfter: "0x1",
        executeBefore: "0x2",
        publicCallCount: 2,
      },
      estimatedNetworkFeeFri: "0x2386f26fc10000",
      mode: "sponsored-deposit",
      sponsor: SPONSORED_SHIELD_SPONSOR,
      typedData: {},
    };
    const line = summarizeSponsoredShield(plan, "0x3782dace9d900000");
    expect(line).toContain("Starknet Foundation pays the pool fee 4 STRK");
    expect(line).toContain("network fee (about 0.01 STRK)");
    expect(line).toContain("public and names this account");
    expect(line).toContain("2 public approval calls");
    const { estimatedNetworkFeeFri: _estimate, ...withoutEstimate } = plan;
    expect(summarizeSponsoredShield(withoutEstimate, "0x1")).toContain("and the network fee.");
  });
});
