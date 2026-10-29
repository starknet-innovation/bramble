/**
 * Sponsored deploy (SNIP-29 `deploy`, fee mode `sponsored`) boundary tests.
 * Nothing is signed on this route, so the commitment is the deployment data
 * itself: it must reproduce the stored address, the relay's echo must match it
 * exactly, and only the wallet's own frozen copy is ever broadcast.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  isSponsorableAccountClass,
  isSponsorableDeployment,
  quoteSponsoredDeploy,
  SPONSORED_DEPLOY_NETWORKS,
  type SponsoredDeploymentData,
  SponsoredDeployRefusedError,
  SponsoredDeployUnavailableError,
  sponsoredDeployConfig,
  sponsoredDeploymentData,
  submitSponsoredDeploy,
} from "@bramble/privacy/sponsored-deploy";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import {
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  XVERSE_ARGENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@bramble/wallet-model/accounts";
import { hash } from "starknet";
import { paymasterResponse as response } from "../support/paymaster";

const CLASS_HASH = OPENZEPPELIN_ACCOUNT_CLASS_HASH;
// OpenZeppelin 0.8.1 and Argent 0.3.1: real account classes the gateway does not sponsor.
const OLDER_OZ_CLASS = "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";
const OLDER_ARGENT_CLASS = "0x029927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";
const PUBLIC_KEY = "0x1f3c942d7f492a37608cde0d77b884a5aa9e11d2919225968557370ddb5a5aa";
const ADDRESS = hash.calculateContractAddressFromHash(PUBLIC_KEY, CLASS_HASH, [PUBLIC_KEY], 0);
const config = { url: "https://gateway.test/api/sponsor" };

const deployment = (): SponsoredDeploymentData =>
  sponsoredDeploymentData({
    addressSalt: PUBLIC_KEY,
    classHash: CLASS_HASH,
    constructorCalldata: [PUBLIC_KEY],
    contractAddress: ADDRESS,
  });

const quoteResult = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  deployment: { ...deployment() },
  fee: { estimated_fee_in_strk: "0x10", suggested_max_fee_in_strk: "0x20" },
  parameters: { fee_mode: { mode: "sponsored" }, version: "0x1" },
  type: "deploy",
  ...overrides,
});

const relay =
  (result: unknown, requests: Record<string, unknown>[] = []) =>
  async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(JSON.parse(String(init?.body)));
    return response(result);
  };

describe("sponsored deploy configuration", () => {
  test("asks the wallet gateway's sponsored routes on mainnet and Sepolia only", () => {
    expect(SPONSORED_DEPLOY_NETWORKS).toEqual({
      SN_MAIN: { url: "https://wallet.nodes.starknet.org/api/sponsored-deploy/mainnet" },
      SN_SEPOLIA: { url: "https://wallet.nodes.starknet.org/api/sponsored-deploy/sepolia" },
    });
    expect(sponsoredDeployConfig("SN_MAIN")?.url).toEndWith("/sponsored-deploy/mainnet");
    expect(sponsoredDeployConfig("SN_SEPOLIA")?.url).toEndWith("/sponsored-deploy/sepolia");
    expect(sponsoredDeployConfig("SN_SEPOLIA", { SN_MAIN: config })).toBeNull();
    expect(sponsoredDeployConfig("SN_SEPOLIA", { SN_SEPOLIA: config })).toEqual(config);
  });
});

describe("sponsorable classes", () => {
  const data = (classHash: string, calldata: readonly string[]): SponsoredDeploymentData => ({
    address: "0x1",
    calldata,
    class_hash: classHash,
    salt: PUBLIC_KEY,
    version: 1,
  });
  const ARGENT_CALLDATA = ["0x0", PUBLIC_KEY, "0x1"];

  test("are exactly OpenZeppelin 3.0, Argent 0.4.0 and the Xverse Argent 0.4.0 build", () => {
    // The gateway's list, by the prefix and suffix it publishes.
    for (const [classHash, prefix, suffix] of [
      [OPENZEPPELIN_ACCOUNT_CLASS_HASH, "0x01d1777d", "702381"],
      [ARGENT_ACCOUNT_CLASS_HASH, "0x03607833", "f45927f"],
      [XVERSE_ARGENT_CLASS_HASH, "0x0663fc01", "20bd024"],
    ] as const) {
      expect(classHash.startsWith(prefix) && classHash.endsWith(suffix)).toBe(true);
      expect(isSponsorableAccountClass(classHash)).toBe(true);
    }
    expect(
      isSponsorableAccountClass(`0x${"0".repeat(4)}${XVERSE_ARGENT_CLASS_HASH.slice(3)}`),
    ).toBe(true);
    for (const other of [OLDER_OZ_CLASS, OLDER_ARGENT_CLASS, BRAAVOS_DEPLOYMENT_CLASS_HASH]) {
      expect(isSponsorableAccountClass(other)).toBe(false);
    }
  });

  test("need the constructor calldata the gateway accepts for that class", () => {
    expect(isSponsorableDeployment(data(OPENZEPPELIN_ACCOUNT_CLASS_HASH, [PUBLIC_KEY]))).toBe(true);
    expect(isSponsorableDeployment(data(ARGENT_ACCOUNT_CLASS_HASH, ARGENT_CALLDATA))).toBe(true);
    expect(isSponsorableDeployment(data(XVERSE_ARGENT_CLASS_HASH, ARGENT_CALLDATA))).toBe(true);
    const refused: readonly [string, readonly string[]][] = [
      [OLDER_OZ_CLASS, [PUBLIC_KEY]],
      [OLDER_ARGENT_CLASS, ARGENT_CALLDATA],
      [BRAAVOS_DEPLOYMENT_CLASS_HASH, [PUBLIC_KEY]],
      [OPENZEPPELIN_ACCOUNT_CLASS_HASH, ARGENT_CALLDATA],
      [OPENZEPPELIN_ACCOUNT_CLASS_HASH, ["0x0"]],
      [ARGENT_ACCOUNT_CLASS_HASH, [PUBLIC_KEY]],
      [ARGENT_ACCOUNT_CLASS_HASH, ["0x0", PUBLIC_KEY, "0x0", "0x5"]],
      [ARGENT_ACCOUNT_CLASS_HASH, ["0x1", PUBLIC_KEY, "0x1"]],
      [XVERSE_ARGENT_CLASS_HASH, ["0x0", PUBLIC_KEY, "0x0"]],
      [XVERSE_ARGENT_CLASS_HASH, ["0x0", "0x0", "0x1"]],
    ];
    for (const [classHash, calldata] of refused) {
      expect(isSponsorableDeployment(data(classHash, calldata))).toBe(false);
    }
  });
});

describe("sponsored deployment data", () => {
  test("canonicalizes felts and commits to the deployer-zero address", () => {
    expect(deployment()).toEqual({
      address: ADDRESS,
      calldata: [PUBLIC_KEY],
      class_hash: "0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381",
      salt: PUBLIC_KEY,
      version: 1,
    });
  });

  test("refuses data that would deploy anywhere but the stored address", () => {
    expect(() =>
      sponsoredDeploymentData({
        addressSalt: "0x0",
        classHash: CLASS_HASH,
        constructorCalldata: [PUBLIC_KEY],
        contractAddress: ADDRESS,
      }),
    ).toThrow("do not match the stored address");
  });
});

describe("sponsored deploy quote", () => {
  test("accepts an exact echo under sponsored parameters and freezes its own copy", async () => {
    const requests: Record<string, unknown>[] = [];
    const echo = { ...deployment(), class_hash: `0x${CLASS_HASH.slice(3)}`, sigdata: [] };
    const quote = await quoteSponsoredDeploy({
      config,
      deployment: deployment(),
      http: relay(quoteResult({ deployment: echo }), requests),
    });
    expect(quote.deployment).toEqual(deployment());
    expect(requests[0]).toEqual({
      id: "bramble-strk20",
      jsonrpc: "2.0",
      method: "paymaster_buildTransaction",
      params: {
        parameters: { fee_mode: { mode: "sponsored" }, version: "0x1" },
        transaction: { deployment: deployment(), type: "deploy" },
      },
    });
  });

  const mismatches: readonly [string, Record<string, unknown>][] = [
    ["another address", { deployment: { ...deployment(), address: "0x123" } }],
    ["another class", { deployment: { ...deployment(), class_hash: "0x456" } }],
    ["another salt", { deployment: { ...deployment(), salt: "0x0" } }],
    ["another owner key", { deployment: { ...deployment(), calldata: ["0x789"] } }],
    [
      "an extra constructor argument",
      { deployment: { ...deployment(), calldata: [PUBLIC_KEY, "0x1"] } },
    ],
    ["a deploy signature", { deployment: { ...deployment(), sigdata: ["0x1"] } }],
    ["an unknown deployment field", { deployment: { ...deployment(), unique: true } }],
    ["another transaction type", { type: "deploy_and_invoke" }],
    [
      "a paid fee mode",
      { parameters: { fee_mode: { gas_token: "0x1", mode: "default" }, version: "0x1" } },
    ],
    [
      "time bounds",
      { parameters: { fee_mode: { mode: "sponsored" }, time_bounds: {}, version: "0x1" } },
    ],
    ["a malformed fee", { fee: { estimated_fee_in_strk: 16 } }],
    ["an unknown top-level field", { typed_data: {} }],
  ];

  for (const [name, overrides] of mismatches) {
    test(`refuses an echo with ${name} as unusable, never as a sponsor's no`, async () => {
      await expect(
        quoteSponsoredDeploy({
          config,
          deployment: deployment(),
          http: relay(quoteResult(overrides)),
        }),
      ).rejects.toBeInstanceOf(SponsoredDeployUnavailableError);
    });
  }

  test("reads only the relay's own clean JSON-RPC error as a refusal", async () => {
    const stated = (status: number) => async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          error: { code: -32000, message: "sponsorship_budget_exhausted" },
          id: "bramble-strk20",
          jsonrpc: "2.0",
        }),
        { status },
      );
    for (const http of [stated(200), stated(409), stated(429)]) {
      const quoting = quoteSponsoredDeploy({ config, deployment: deployment(), http });
      await expect(quoting).rejects.toBeInstanceOf(SponsoredDeployRefusedError);
    }
  });

  test("reads the gateway switched off, or any bare 4xx, as unavailable, never this account's no", async () => {
    const answers = [
      async (): Promise<Response> => new Response("sponsored_deploy_disabled", { status: 404 }),
      async (): Promise<Response> => new Response("too_many_requests", { status: 429 }),
      async (): Promise<Response> => new Response("no", { status: 403 }),
    ];
    for (const http of answers) {
      const quoting = quoteSponsoredDeploy({ config, deployment: deployment(), http });
      await expect(quoting).rejects.toBeInstanceOf(SponsoredDeployUnavailableError);
    }
  });

  test("reads a transport failure, a deadline, a 5xx or a garbled answer as unavailable", async () => {
    const answers = [
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
      async (): Promise<Response> => {
        throw new DOMException("deadline", "TimeoutError");
      },
      async (): Promise<Response> => new Response("bad gateway", { status: 502 }),
      async (): Promise<Response> => new Response("{not json"),
      async (): Promise<Response> => new Response(JSON.stringify({ error: "x".repeat(70_000) })),
    ];
    for (const http of answers) {
      const quoting = quoteSponsoredDeploy({ config, deployment: deployment(), http });
      await expect(quoting).rejects.toBeInstanceOf(SponsoredDeployUnavailableError);
    }
  });
});

describe("sponsored deploy submission", () => {
  const quote = (): { readonly deployment: SponsoredDeploymentData } => ({
    deployment: deployment(),
  });

  test("broadcasts the frozen deployment and returns the relay's hash", async () => {
    const requests: Record<string, unknown>[] = [];
    const result = await submitSponsoredDeploy({
      config,
      http: relay({ tracking_id: "0x9", transaction_hash: "0xabc" }, requests),
      isAuthorized: () => true,
      quote: quote(),
    });
    expect(result).toEqual({ transactionHash: "0xabc" });
    expect(requests[0]?.["method"]).toBe("paymaster_executeTransaction");
    expect(requests[0]?.["params"]).toEqual({
      parameters: { fee_mode: { mode: "sponsored" }, version: "0x1" },
      transaction: { deployment: deployment(), type: "deploy" },
    });
  });

  test("broadcasts its own frozen deployment whatever the relay's answer carries", async () => {
    const requests: Record<string, unknown>[] = [];
    const other = { ...deployment(), calldata: ["0x789"], salt: "0x0" };
    const result = await submitSponsoredDeploy({
      config,
      http: relay({ deployment: other, transaction_hash: "0xabc" }, requests),
      isAuthorized: () => true,
      quote: quote(),
    });
    expect(result).toEqual({ transactionHash: "0xabc" });
    const params = requests[0]?.["params"] as { transaction: { deployment: unknown } };
    expect(params.transaction.deployment).toEqual(deployment());
  });

  test("refuses before sending when the wallet locked", async () => {
    let sent = false;
    await expect(
      submitSponsoredDeploy({
        config,
        http: async () => {
          sent = true;
          return response({ transaction_hash: "0xabc" });
        },
        isAuthorized: () => false,
        quote: quote(),
      }),
    ).rejects.toThrow("wallet locked");
    expect(sent).toBe(false);
  });

  test("a lost reply is status unknown, never a refusal", async () => {
    const lost = [
      async (): Promise<Response> => {
        throw new TypeError("connection reset");
      },
      async (): Promise<Response> => new Response("bad gateway", { status: 502 }),
      async (): Promise<Response> => new Response("{not json"),
      relay({ tracking_id: "0x9" }),
      relay({ transaction_hash: "0x0" }),
    ];
    for (const http of lost) {
      await expect(
        submitSponsoredDeploy({ config, http, isAuthorized: () => true, quote: quote() }),
      ).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
    }
  });

  const envelope =
    (body: Record<string, unknown>, status = 200) =>
    async (): Promise<Response> =>
      new Response(JSON.stringify({ id: "bramble-strk20", jsonrpc: "2.0", ...body }), { status });
  const REFUSAL = { error: { code: 163, message: "sponsorship limit reached" } };

  test("only a clean JSON-RPC error is a determinate refusal, so nothing is held open", async () => {
    for (const http of [envelope(REFUSAL), envelope(REFUSAL, 403)]) {
      const refusal = submitSponsoredDeploy({
        config,
        http,
        isAuthorized: () => true,
        quote: quote(),
      });
      await expect(refusal).rejects.toBeInstanceOf(SponsoredDeployRefusedError);
      await expect(refusal).rejects.toBeInstanceOf(WalletError);
      await expect(refusal).rejects.not.toBeInstanceOf(IndeterminateRpcWriteError);
    }
  });

  // The gateway's own pre-forward refusals: JSON-RPC errors echoing the id.
  const gatewayRefusal = (status: number, code: string) =>
    envelope({ error: { code: -32000, message: code } }, status);

  test("the gateway's 4xx refusals before forwarding are determinate: nothing was sent", async () => {
    for (const http of [
      gatewayRefusal(409, "account_already_deployed"),
      gatewayRefusal(429, "sponsored_deploy_already_attempted"),
      gatewayRefusal(429, "sponsorship_budget_exhausted"),
    ]) {
      await expect(
        submitSponsoredDeploy({ config, http, isAuthorized: () => true, quote: quote() }),
      ).rejects.toBeInstanceOf(SponsoredDeployRefusedError);
    }
  });

  const ambiguous: readonly [string, () => Promise<Response>][] = [
    [
      "the gateway's 503 deployment_status_unavailable",
      gatewayRefusal(503, "deployment_status_unavailable"),
    ],
    [
      "a relay 4xx relayed as a plain body after forwarding",
      async () => new Response("upstream_rejected", { status: 400 }),
    ],
    [
      "a switched-off gateway's plain 404",
      async () => new Response("sponsored_deploy_disabled", { status: 404 }),
    ],
    ["a null error", envelope({ error: null })],
    ["a string error", envelope({ error: "rejected" })],
    ["an error without a code", envelope({ error: { message: "rejected" } })],
    ["an error with a non-integer code", envelope({ error: { code: "163", message: "rejected" } })],
    ["an error without a message", envelope({ error: { code: 163 } })],
    ["an error with a non-string message", envelope({ error: { code: 163, message: 7 } })],
    ["an error beside a result", envelope({ ...REFUSAL, result: { transaction_hash: "0xabc" } })],
    [
      "an error under another id",
      async () => new Response(JSON.stringify({ ...REFUSAL, id: 7, jsonrpc: "2.0" })),
    ],
    [
      "an error without jsonrpc 2.0",
      async () => new Response(JSON.stringify({ ...REFUSAL, id: "bramble-strk20" })),
    ],
    ["a bare 4xx", async () => new Response("forbidden", { status: 403 })],
    ["a 4xx carrying a result", envelope({ result: { transaction_hash: "0xabc" } }, 400)],
    ["a clean error on a 5xx", envelope(REFUSAL, 503)],
    ["an oversized body", envelope({ ...REFUSAL, padding: "x".repeat(1_100_000) })],
    ["an empty body", async () => new Response(null)],
    [
      "a deadline",
      async () => {
        throw new DOMException("deadline", "TimeoutError");
      },
    ],
    ["a result that is not an object", envelope({ result: "0xabc" })],
    ["a non-felt hash", envelope({ result: { transaction_hash: "abc" } })],
  ];

  for (const [name, http] of ambiguous) {
    test(`${name} on a broadcast is status unknown, never "nothing was sent"`, async () => {
      const sending = submitSponsoredDeploy({
        config,
        http,
        isAuthorized: () => true,
        quote: quote(),
      });
      await expect(sending).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
      await expect(sending).rejects.not.toBeInstanceOf(SponsoredDeployRefusedError);
    });
  }
});
