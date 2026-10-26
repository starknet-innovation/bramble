/**
 * Sponsored deploy (SNIP-29 `deploy`, fee mode `sponsored`) boundary tests.
 * Nothing is signed on this route, so the commitment is the deployment data
 * itself: it must reproduce the stored address, the relay's echo must match it
 * exactly, and only the wallet's own frozen copy is ever broadcast.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  isSponsorableAccountType,
  quoteSponsoredDeploy,
  SPONSORED_DEPLOY_NETWORKS,
  SPONSORED_DEPLOY_REFUSED,
  SPONSORED_DEPLOY_UNREACHABLE,
  type SponsoredDeploymentData,
  SponsoredDeployRefusedError,
  SponsoredDeployUnavailableError,
  sponsoredDeployConfig,
  sponsoredDeploymentData,
  submitSponsoredDeploy,
} from "@bramble/privacy/sponsored-deploy";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { hash } from "starknet";
import { paymasterResponse as response } from "../support/paymaster";

const CLASS_HASH = "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";
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
  test("is off on every network by default", () => {
    expect(Object.keys(SPONSORED_DEPLOY_NETWORKS)).toEqual([]);
    expect(sponsoredDeployConfig("SN_MAIN")).toBeNull();
    expect(sponsoredDeployConfig("SN_SEPOLIA")).toBeNull();
    expect(sponsoredDeployConfig("SN_SEPOLIA", { SN_SEPOLIA: config })).toEqual(config);
  });

  test("offers only classes whose constructor needs no deploy signature", () => {
    expect(isSponsorableAccountType("openzeppelin")).toBe(true);
    expect(isSponsorableAccountType("argent")).toBe(true);
    expect(isSponsorableAccountType("braavos")).toBe(false);
  });
});

describe("sponsored deployment data", () => {
  test("canonicalizes felts and commits to the deployer-zero address", () => {
    expect(deployment()).toEqual({
      address: ADDRESS,
      calldata: [PUBLIC_KEY],
      class_hash: CLASS_HASH,
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
    const echo = { ...deployment(), class_hash: `0x0${CLASS_HASH.slice(2)}`, sigdata: [] };
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

  test("reads only the relay's own refusal as a refusal", async () => {
    const stated = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          error: { code: 163, message: "sponsorship limit reached" },
          id: "bramble-strk20",
          jsonrpc: "2.0",
        }),
      );
    const forbidden = async (): Promise<Response> => new Response("no", { status: 403 });
    for (const http of [stated, forbidden]) {
      const quoting = quoteSponsoredDeploy({ config, deployment: deployment(), http });
      await expect(quoting).rejects.toBeInstanceOf(SponsoredDeployRefusedError);
      await expect(quoting).rejects.toThrow(SPONSORED_DEPLOY_REFUSED);
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
      await expect(quoting).rejects.toThrow(SPONSORED_DEPLOY_UNREACHABLE);
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

  test("a refusal the relay states is determinate, so nothing is held open", async () => {
    const refusal = submitSponsoredDeploy({
      config,
      http: async () => new Response("forbidden", { status: 403 }),
      isAuthorized: () => true,
      quote: quote(),
    });
    await expect(refusal).rejects.toBeInstanceOf(SponsoredDeployRefusedError);
    await expect(refusal).rejects.toBeInstanceOf(WalletError);
    await expect(refusal).rejects.not.toBeInstanceOf(IndeterminateRpcWriteError);
  });
});
