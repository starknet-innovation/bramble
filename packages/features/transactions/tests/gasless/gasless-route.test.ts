/**
 * Route pins, the 20% ceiling, which accounts may sign v2, and the build
 * request the gateway's checker accepts.
 */
import { describe, expect, test } from "bun:test";
import { accountSignsGaslessV2 } from "@bramble/transactions/gasless-account";
import { convertStrkFeeToToken, gaslessFeeCeiling } from "@bramble/transactions/gasless-ceiling";
import {
  GASLESS_FEES_ENABLED,
  GASLESS_FORWARDER_ADDRESS,
  GASLESS_PAYMASTER_URLS,
  gaslessRoute,
  gaslessRouteReady,
} from "@bramble/transactions/gasless-config";
import {
  gaslessBuildParams,
  gaslessDeploymentBody,
  readGaslessSupportedTokens,
} from "@bramble/transactions/gasless-request";
import { quoteGaslessOffers } from "@bramble/transactions/gasless-submit";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";

const ARGENT_030 = "0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003";
const ARGENT_031 = "0x29927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";

describe("gasless route", () => {
  test("mainnet forwarder is pinned and Sepolia is unset", () => {
    expect(GASLESS_FORWARDER_ADDRESS.SN_MAIN).toBe(
      "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f",
    );
    expect(GASLESS_FORWARDER_ADDRESS.SN_SEPOLIA).toBeNull();
  });

  test("both wallet flags are off, so neither route is ready", () => {
    expect(GASLESS_FEES_ENABLED).toEqual({ SN_MAIN: false, SN_SEPOLIA: false });
    expect(gaslessRouteReady(gaslessRoute("SN_MAIN"))).toBe(false);
    expect(gaslessRouteReady(gaslessRoute("SN_SEPOLIA"))).toBe(false);
    expect(gaslessRoute("SN_DEVNET")).toBeNull();
  });

  test("Sepolia does not call the gateway, even with the flag on and no pin", async () => {
    let called = false;
    const account = {
      accountContractType: "argent" as const,
      address: "0x1",
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      deployed: true,
    };
    const http = (): Promise<Response> => {
      called = true;
      return Promise.reject(new Error("must not call"));
    };
    const shared = {
      account,
      calls: [],
      deployment: null,
      http,
      nowSeconds: 0,
      referenceFor: async () => null,
      strkShort: true,
      tokens: [],
    };
    expect(await quoteGaslessOffers({ ...shared, route: gaslessRoute("SN_SEPOLIA") })).toEqual([]);
    expect(
      await quoteGaslessOffers({
        ...shared,
        route: {
          chainId: "SN_SEPOLIA",
          enabled: true,
          forwarder: null,
          url: GASLESS_PAYMASTER_URLS.SN_SEPOLIA,
        },
      }),
    ).toEqual([]);
    expect(called).toBe(false);
  });

  test("the routes are the wallet gateway, not AVNU and not the STRK20 paymaster", () => {
    expect(GASLESS_PAYMASTER_URLS.SN_MAIN).toBe(
      "https://wallet.nodes.starknet.org/api/paymaster/mainnet",
    );
    expect(GASLESS_PAYMASTER_URLS.SN_SEPOLIA).toBe(
      "https://wallet.nodes.starknet.org/api/paymaster/sepolia",
    );
    expect(JSON.stringify(GASLESS_PAYMASTER_URLS)).not.toContain("avnu.fi");
    expect(JSON.stringify(GASLESS_PAYMASTER_URLS)).not.toContain("/api/strk20");
  });
});

describe("gaslessFeeCeiling", () => {
  test("is 20% over the reference, rounded up", () => {
    expect(gaslessFeeCeiling(1000n)).toBe(1200n);
    expect(gaslessFeeCeiling(1n)).toBe(2n);
    expect(gaslessFeeCeiling(0n)).toBe(0n);
  });

  test("converts a STRK fee with the wallet's prices and ignores a missing price", () => {
    const converted = convertStrkFeeToToken({
      strkDecimals: 18,
      strkFee: 10n ** 18n,
      strkPrice: 2n,
      tokenDecimals: 6,
      tokenPrice: 1n,
    });
    expect(converted).toBe(2_000_000n);
    expect(
      convertStrkFeeToToken({
        strkDecimals: 18,
        strkFee: 1n,
        strkPrice: 0n,
        tokenDecimals: 6,
        tokenPrice: 1n,
      }),
    ).toBeNull();
  });
});

describe("accountSignsGaslessV2", () => {
  test("allows Argent 0.4, Xverse, OpenZeppelin, and deployed current Braavos", () => {
    expect(
      accountSignsGaslessV2({
        accountContractType: "argent",
        classHash: ARGENT_ACCOUNT_CLASS_HASH,
        deployed: true,
      }),
    ).toBe(true);
    expect(
      accountSignsGaslessV2({
        accountContractType: "openzeppelin",
        classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH,
        deployed: false,
      }),
    ).toBe(true);
    expect(
      accountSignsGaslessV2({
        accountContractType: "braavos",
        classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
        deployed: true,
        liveClassHash: BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
      }),
    ).toBe(true);
  });

  test("leaves Argent 0.3, undeployed Braavos, and multisig on STRK", () => {
    expect(
      accountSignsGaslessV2({
        accountContractType: "argent",
        classHash: ARGENT_030,
        deployed: true,
      }),
    ).toBe(false);
    expect(
      accountSignsGaslessV2({
        accountContractType: "argent",
        classHash: ARGENT_031,
        deployed: true,
      }),
    ).toBe(false);
    expect(
      accountSignsGaslessV2({
        accountContractType: "braavos",
        classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
        deployed: true,
      }),
    ).toBe(false);
    expect(
      accountSignsGaslessV2({
        accountContractType: "braavos",
        classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
        deployed: true,
        liveClassHash: BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
      }),
    ).toBe(false);
    expect(
      accountSignsGaslessV2({
        accountContractType: "braavos",
        classHash: BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
        deployed: false,
        liveClassHash: BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
      }),
    ).toBe(false);
    expect(
      accountSignsGaslessV2({
        accountContractType: "argent-multisig",
        classHash: ARGENT_ACCOUNT_CLASS_HASH,
        deployed: true,
      }),
    ).toBe(false);
  });
});

describe("gaslessBuildParams", () => {
  const user = "0x213c67ed78bc280887234fe5ed5e77272465317978ae86c25a71531d9332a2d";

  test("sends default mode only, with 0x felts and no tip or time bounds", () => {
    const params = gaslessBuildParams({
      calls: [
        {
          calldata: ["1", "2"],
          contractAddress: user,
          entrypoint: "transfer",
        },
      ],
      gasToken: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      userAddress: user,
    });
    expect(Object.keys(params.parameters)).toEqual(["fee_mode", "version"]);
    expect(params.parameters.fee_mode).toEqual({
      gas_token: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      mode: "default",
    });
    expect(params.parameters.version).toBe("0x1");
    expect(params.transaction["type"]).toBe("invoke");
    expect(JSON.stringify(params)).not.toContain("sponsored");
    const invoke = params.transaction["invoke"] as { calls: { calldata: string[] }[] };
    expect(invoke.calls[0]?.calldata).toEqual(["0x1", "0x2"]);
  });

  test("a deployment uses a numeric version and must deploy the invoking account", () => {
    const deployment = gaslessDeploymentBody(
      {
        addressSalt: "0x3",
        classHash: "0x4",
        constructorCalldata: ["0x5"],
        contractAddress: user,
      },
      user,
    );
    expect(deployment?.version).toBe(1);
    expect(typeof deployment?.version).toBe("number");
    expect(
      gaslessDeploymentBody(
        {
          addressSalt: "0x3",
          classHash: "0x4",
          constructorCalldata: [],
          contractAddress: "0x9",
        },
        user,
      ),
    ).toBeNull();
    const params = gaslessBuildParams({
      calls: [{ calldata: [], contractAddress: user, entrypoint: "transfer" }],
      deployment,
      gasToken: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      userAddress: user,
    });
    expect(params.transaction["type"]).toBe("deploy_and_invoke");
    expect(Object.keys(params)).toEqual(["parameters", "transaction", "userAddress"]);
  });
});

describe("readGaslessSupportedTokens", () => {
  const token = "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

  test("keeps one row when the same address is repeated", () => {
    const row = { decimals: 6, token_address: token };
    expect(
      readGaslessSupportedTokens([row, row, { ...row, token_address: `0x0${token.slice(2)}` }]),
    ).toEqual([{ address: token, decimals: 6 }]);
  });

  test("rejects one address quoted with two decimal counts", () => {
    expect(
      readGaslessSupportedTokens([
        { decimals: 6, token_address: token },
        { decimals: 18, token_address: token },
      ]),
    ).toBeNull();
  });
});
