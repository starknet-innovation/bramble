/**
 * The gasless typed-data check: SNIP-9 v2 only, the route's shortstring chain
 * id, the user's calls plus one fee transfer to the pinned forwarder, and an
 * independent ceiling. The body that passes is the one a later execute posts.
 */
import { describe, expect, test } from "bun:test";
import { validateGaslessTypedData } from "@bramble/privacy/gasless-typed-data";
import { type Call, OutsideExecutionVersion, outsideExecution, typedData } from "starknet";

const ACCOUNT = "0x5dccf9cfdcabb9e4ef45814bda1b056bb23063d0e9b64e5a845e9dfb3d23f10";
const FORWARDER = "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const USDC = "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const RECIPIENT = "0x5ef2de1a7ccc0e9ef8d1a1e6e9c4c2b5d6a7f8e9d0c1b2a3f4e5d6c7b8a9f01";
const NOW = 1_700_000_000;
const BEFORE = "0x6ae06b9d";

const userCall = (): Call => ({
  calldata: [RECIPIENT, "0x10", "0x0"],
  contractAddress: USDC,
  entrypoint: "transfer",
});

const quote = (calls: readonly Call[], chainId: "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN") =>
  outsideExecution.getTypedData(
    chainId,
    { caller: FORWARDER, execute_after: "0x1", execute_before: BEFORE },
    "0x5",
    [...calls],
    OutsideExecutionVersion.V2,
  );

const check = (
  value: unknown,
  overrides: Partial<Parameters<typeof validateGaslessTypedData>[0]> = {},
) =>
  validateGaslessTypedData({
    accountAddress: ACCOUNT,
    calls: [userCall()],
    ceiling: 1000n,
    chainId: "SN_MAIN",
    forwarder: FORWARDER,
    gasToken: USDC,
    minimumRemainingSeconds: 10n,
    nowSeconds: NOW,
    quotedMax: 1000n,
    value,
    ...overrides,
  });

describe("validateGaslessTypedData", () => {
  test("accepts the user's call plus one fee transfer and keeps the original body", () => {
    const fee: Call = {
      calldata: [FORWARDER, "0x3e8", "0x0"],
      contractAddress: USDC,
      entrypoint: "transfer",
    };
    const body = quote([userCall(), fee]);
    const result = check(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.typedData).toBe(body);
      expect(result.feeAmount).toBe(1000n);
    }
  });

  test("hashes the gateway's mainnet fixture the way that account does", () => {
    const body = {
      types: quote([]).types,
      primaryType: "OutsideExecution",
      domain: {
        name: "Account.execute_from_outside",
        version: "2",
        chainId: "SN_MAIN",
        revision: "1",
      },
      message: {
        Caller: FORWARDER,
        Nonce: "0x2ae7dc78d36cee88224d7b8430686e1d",
        "Execute After": "0x1",
        "Execute Before": BEFORE,
        Calls: [
          {
            To: STRK,
            Selector: "0x219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c",
            Calldata: [ACCOUNT, "0x0", "0x0"],
          },
          {
            To: STRK,
            Selector: "0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e",
            Calldata: [FORWARDER, "0x1b608cce453b450", "0x0"],
          },
        ],
      },
    };
    expect(typedData.getMessageHash(body, ACCOUNT)).toBe(
      "0x44d69d150b511e0084b004806ebb0203070e9be95d5178a209891fee25d55cd",
    );
    const amount = BigInt("0x1b608cce453b450");
    const result = check(body, {
      calls: [
        {
          calldata: [ACCOUNT, "0x0", "0x0"],
          contractAddress: STRK,
          entrypoint: "approve",
        },
      ],
      ceiling: amount,
      gasToken: STRK,
      quotedMax: amount,
    });
    expect(result.ok).toBe(true);
  });

  test("rejects the felt chain id even though it hashes like the shortstring", () => {
    const fee: Call = {
      calldata: [FORWARDER, "0x3e8", "0x0"],
      contractAddress: USDC,
      entrypoint: "transfer",
    };
    const body = quote([userCall(), fee]);
    body.domain.chainId = "0x534e5f4d41494e";
    expect(check(body)).toEqual({ ok: false, reason: "shape" });
  });

  test("rejects the other network's chain id", () => {
    const fee: Call = {
      calldata: [FORWARDER, "0x3e8", "0x0"],
      contractAddress: USDC,
      entrypoint: "transfer",
    };
    const body = quote([userCall(), fee], "SN_SEPOLIA");
    expect(check(body)).toEqual({ ok: false, reason: "shape" });
  });

  test("rejects v1, a decimal felt, an extra call, and a substituted payee", () => {
    const fee: Call = {
      calldata: [FORWARDER, "0x3e8", "0x0"],
      contractAddress: USDC,
      entrypoint: "transfer",
    };
    const v1 = outsideExecution.getTypedData(
      "SN_MAIN",
      { caller: FORWARDER, execute_after: "0x1", execute_before: BEFORE },
      "0x5",
      [userCall(), fee],
      OutsideExecutionVersion.V1,
    );
    expect(check(v1)).toEqual({ ok: false, reason: "shape" });
    const decimal = quote([userCall(), fee]);
    const calls = (decimal.message as { Calls: { Calldata: string[] }[] }).Calls;
    const first = calls[0];
    if (first) {
      first.Calldata[1] = "16";
    }
    expect(check(decimal)).toEqual({ ok: false, reason: "shape" });
    const extra = quote([
      userCall(),
      { calldata: ["0x1"], contractAddress: USDC, entrypoint: "approve" },
      fee,
    ]);
    expect(check(extra)).toEqual({ ok: false, reason: "calls" });
    const swapped = quote([
      userCall(),
      { calldata: [RECIPIENT, "0x3e8", "0x0"], contractAddress: USDC, entrypoint: "transfer" },
    ]);
    expect(check(swapped)).toEqual({ ok: false, reason: "calls" });
  });

  test("rejects a fee above the independent ceiling and a fee above the quoted maximum", () => {
    const fee: Call = {
      calldata: [FORWARDER, "0x3e9", "0x0"],
      contractAddress: USDC,
      entrypoint: "transfer",
    };
    const body = quote([userCall(), fee]);
    expect(check(body, { ceiling: 1000n, quotedMax: 2000n })).toEqual({
      ok: false,
      reason: "ceiling",
    });
    expect(check(body, { ceiling: 2000n, quotedMax: 1000n })).toEqual({
      ok: false,
      reason: "ceiling",
    });
  });

  test("rejects a caller that is not the pinned forwarder", () => {
    const fee: Call = {
      calldata: [FORWARDER, "0x3e8", "0x0"],
      contractAddress: USDC,
      entrypoint: "transfer",
    };
    const body = quote([userCall(), fee]);
    expect(check(body, { forwarder: RECIPIENT }).ok).toBe(false);
  });

  test("rejects a closed execution window", () => {
    const fee: Call = {
      calldata: [FORWARDER, "0x3e8", "0x0"],
      contractAddress: USDC,
      entrypoint: "transfer",
    };
    const body = quote([userCall(), fee]);
    expect(check(body, { nowSeconds: Number(BigInt(BEFORE)) })).toEqual({
      ok: false,
      reason: "window",
    });
  });
});
