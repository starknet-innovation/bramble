/**
 * The read block: the extension's pure gasless functions over direct inputs, one case per value.
 *
 * - `buildParams`: `gaslessBuildParams` (the `paymaster_buildTransaction` params) and
 *   `gaslessDeploymentBody`, or the refusal;
 * - `supportedTokens`, `available`, `quote`, `transactionHash`, `offerShape`: how the extension reads
 *   each paymaster result (and whether an echoed offer is one it could have rendered);
 * - `account`: `accountSignsGaslessV2` per account class;
 * - `ceiling`: `convertStrkFeeToToken` and `gaslessFeeCeiling`.
 */
import { accountSignsGaslessV2 } from "@bramble/transactions/gasless-account";
import { convertStrkFeeToToken, gaslessFeeCeiling } from "@bramble/transactions/gasless-ceiling";
import {
  gaslessBuildParams,
  gaslessDeploymentBody,
  isGaslessFeeOffer,
  readGaslessAvailable,
  readGaslessQuote,
  readGaslessSupportedTokens,
  readGaslessTransactionHash,
} from "@bramble/transactions/gasless-request";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
  XVERSE_ARGENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import {
  ACCOUNT,
  buildResult,
  ETH,
  feeTransfer,
  MAX_FELT,
  NOW,
  outsideTypedData,
  quoteFee,
  STRK,
  thrown,
  USDC,
  usdcTransfer,
} from "./shared";

const attempt = (run: () => unknown): object => {
  try {
    const output = run();
    return { output: output === undefined ? null : output };
  } catch (error) {
    return { refused: thrown(error) };
  }
};

const DEPLOYMENT = {
  addressSalt: "0x0",
  classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH,
  constructorCalldata: ["0x00abc", "0"],
  contractAddress: ACCOUNT,
};

const BUILD_PARAMS: readonly (readonly [string, Parameters<typeof gaslessBuildParams>[0]])[] = [
  [
    "one transfer, padded token and account",
    {
      calls: [usdcTransfer()],
      gasToken: USDC,
      nowSeconds: NOW,
      userAddress: `0x000${ACCOUNT.slice(2)}`,
    },
  ],
  [
    "an entrypoint given as a felt and decimal calldata",
    {
      calls: [{ calldata: ["16", "0"], contractAddress: ETH, entrypoint: "0x1234" }],
      gasToken: ETH,
      nowSeconds: NOW,
      userAddress: ACCOUNT,
    },
  ],
  [
    "deploy and invoke",
    {
      calls: [usdcTransfer()],
      deployment: gaslessDeploymentBody(DEPLOYMENT, ACCOUNT),
      gasToken: USDC,
      nowSeconds: NOW,
      userAddress: ACCOUNT,
    },
  ],
  [
    "the clock at zero",
    { calls: [usdcTransfer()], gasToken: USDC, nowSeconds: 0, userAddress: ACCOUNT },
  ],
  ["no calls", { calls: [], gasToken: USDC, nowSeconds: NOW, userAddress: ACCOUNT }],
  [
    "a negative clock",
    { calls: [usdcTransfer()], gasToken: USDC, nowSeconds: -1, userAddress: ACCOUNT },
  ],
  [
    "a fractional clock",
    { calls: [usdcTransfer()], gasToken: USDC, nowSeconds: 1.5, userAddress: ACCOUNT },
  ],
  [
    "a zero gas token",
    { calls: [usdcTransfer()], gasToken: "0x0", nowSeconds: NOW, userAddress: ACCOUNT },
  ],
  [
    "a calldata felt above the field",
    {
      calls: [{ ...usdcTransfer(), calldata: [`0x${(BigInt(MAX_FELT) + 1n).toString(16)}`] }],
      gasToken: USDC,
      nowSeconds: NOW,
      userAddress: ACCOUNT,
    },
  ],
];

const KNOWN_BUGS: Readonly<Record<string, string>> = {
  "a calldata felt above the field":
    "The refusal is starknet.js's raw range error, not a GaslessRefusal; the port should refuse without matching this text.",
};

const buildParams = (): readonly object[] => [
  ...BUILD_PARAMS.map(([name, input]) => ({
    input,
    ...(KNOWN_BUGS[name] ? { knownExtensionBug: KNOWN_BUGS[name] } : {}),
    name,
    ...attempt(() => gaslessBuildParams(input)),
  })),
  {
    input: { deployment: DEPLOYMENT, userAddress: USDC },
    name: "a deployment for another address",
    ...attempt(() => gaslessDeploymentBody(DEPLOYMENT, USDC)),
  },
];

const values = (fn: (value: unknown) => unknown, inputs: readonly (readonly [string, unknown])[]) =>
  inputs.map(([name, input]) => ({ input, name, ...attempt(() => fn(input)) }));

const TYPED = outsideTypedData([usdcTransfer(), feeTransfer()]);

const quoteInputs: readonly (readonly [string, unknown])[] = [
  ["an invoke", buildResult(TYPED)],
  ["no typed data", { fee: quoteFee(), parameters: {}, type: "invoke" }],
  [
    "a fee felt in decimal",
    { ...buildResult(TYPED), fee: { ...quoteFee(), suggested_max_fee_in_gas_token: "2000" } },
  ],
  ["an extra fee key", { ...buildResult(TYPED), fee: { ...quoteFee(), tip: "0x0" } }],
  ["an extra top-level key", { ...buildResult(TYPED), extra: 1 }],
  ["a deployment on an invoke", { ...buildResult(TYPED), deployment: {} }],
  ["parameters missing", { fee: quoteFee(), type: "invoke", typed_data: TYPED }],
  ["null", null],
];

const ACCOUNTS: readonly (readonly [string, Parameters<typeof accountSignsGaslessV2>[0]])[] = [
  [
    "argent 0.4",
    { accountContractType: "argent", classHash: ARGENT_ACCOUNT_CLASS_HASH, deployed: true },
  ],
  [
    "argent 0.4, padded differently",
    {
      accountContractType: "argent",
      classHash: ARGENT_ACCOUNT_CLASS_HASH.replace("0x0", "0x"),
      deployed: false,
    },
  ],
  [
    "xverse argent",
    { accountContractType: "argent", classHash: XVERSE_ARGENT_CLASS_HASH, deployed: true },
  ],
  [
    "openzeppelin",
    {
      accountContractType: "openzeppelin",
      classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH,
      deployed: true,
    },
  ],
  [
    "openzeppelin with the argent class",
    { accountContractType: "openzeppelin", classHash: ARGENT_ACCOUNT_CLASS_HASH, deployed: true },
  ],
  [
    "argent 0.3.0",
    {
      accountContractType: "argent",
      classHash: "0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003",
      deployed: true,
    },
  ],
  [
    "braavos",
    {
      accountContractType: "braavos",
      classHash: BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
      deployed: true,
      liveClassHash: BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
    },
  ],
  [
    "argent multisig",
    {
      accountContractType: "argent-multisig",
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      deployed: true,
    },
  ],
  [
    "read-only",
    { accountContractType: "read-only", classHash: ARGENT_ACCOUNT_CLASS_HASH, deployed: true },
  ],
];

const CONVERSIONS: readonly (readonly [string, Parameters<typeof convertStrkFeeToToken>[0]])[] = [
  [
    "STRK at 0.5 to USDC at 1",
    { strkDecimals: 18, strkFee: 10n ** 16n, strkPrice: 50n, tokenDecimals: 6, tokenPrice: 100n },
  ],
  [
    "rounds down",
    { strkDecimals: 18, strkFee: 1n, strkPrice: 1n, tokenDecimals: 6, tokenPrice: 3n },
  ],
  [
    "to an 18-decimal token",
    { strkDecimals: 18, strkFee: 123_456_789n, strkPrice: 7n, tokenDecimals: 18, tokenPrice: 3n },
  ],
  [
    "a zero fee",
    { strkDecimals: 18, strkFee: 0n, strkPrice: 1n, tokenDecimals: 6, tokenPrice: 1n },
  ],
  [
    "a zero token price",
    { strkDecimals: 18, strkFee: 1n, strkPrice: 1n, tokenDecimals: 6, tokenPrice: 0n },
  ],
  [
    "37 decimals",
    { strkDecimals: 18, strkFee: 1n, strkPrice: 1n, tokenDecimals: 37, tokenPrice: 1n },
  ],
  [
    "fractional decimals",
    { strkDecimals: 18, strkFee: 1n, strkPrice: 1n, tokenDecimals: 6.5, tokenPrice: 1n },
  ],
];

const stringify = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  );

/** The read blocks, keyed by block name. */
export const computeReads = (): readonly (readonly [string, readonly object[]])[] => [
  ["buildParams", buildParams()],
  [
    "supportedTokens",
    values(readGaslessSupportedTokens, [
      [
        "two tokens with prices",
        [
          { decimals: 6, price_in_strk: "0x2540be400", token_address: USDC },
          { decimals: 18, token_address: ETH },
        ],
      ],
      [
        "a repeated token, once padded",
        [
          { decimals: 6, token_address: USDC },
          { decimals: 6, token_address: USDC.replace("0x0", "0x") },
        ],
      ],
      [
        "a repeated token with other decimals",
        [
          { decimals: 6, token_address: USDC },
          { decimals: 18, token_address: USDC },
        ],
      ],
      ["a price in decimal", [{ decimals: 6, price_in_strk: "10", token_address: USDC }]],
      ["an extra key", [{ decimals: 6, symbol: "USDC", token_address: USDC }]],
      ["37 decimals", [{ decimals: 37, token_address: STRK }]],
      ["a zero address", [{ decimals: 6, token_address: "0x0" }]],
      ["an empty list", []],
      ["not a list", { tokens: [] }],
    ]),
  ],
  [
    "available",
    values(readGaslessAvailable, [
      ["true", true],
      ["the string true", "true"],
      ["1", 1],
      ["null", null],
    ]),
  ],
  [
    "quote",
    [
      ...values((value) => stringify(readGaslessQuote(value, "invoke")), quoteInputs),
      {
        input: buildResult(TYPED, "deploy_and_invoke"),
        name: "a deploy and invoke, asked as one",
        ...attempt(() =>
          stringify(readGaslessQuote(buildResult(TYPED, "deploy_and_invoke"), "deploy_and_invoke")),
        ),
      },
    ],
  ],
  [
    "transactionHash",
    values(readGaslessTransactionHash, [
      ["an object", { transaction_hash: "0x7a1ce5" }],
      ["a bare string", "0x7a1ce5"],
      ["padded", { transaction_hash: "0x0007a1ce5" }],
      ["zero", { transaction_hash: "0x0" }],
      ["decimal", { transaction_hash: "123" }],
      ["above the field", { transaction_hash: `0x${(BigInt(MAX_FELT) + 1n).toString(16)}` }],
      ["missing", {}],
    ]),
  ],
  [
    "offerShape",
    values(isGaslessFeeOffer, [
      [
        "an offer the wallet renders",
        { amount: "1000", decimals: 6, label: "USDC", tokenAddress: USDC.replace("0x0", "0x") },
      ],
      [
        "a padded token address",
        { amount: "1000", decimals: 6, label: "USDC", tokenAddress: USDC },
      ],
      [
        "STRK",
        { amount: "1000", decimals: 18, label: "STRK", tokenAddress: STRK.replace("0x0", "0x") },
      ],
      [
        "a leading zero amount",
        { amount: "01000", decimals: 6, label: "USDC", tokenAddress: USDC.replace("0x0", "0x") },
      ],
      [
        "a label with a space",
        { amount: "1", decimals: 6, label: "US DC", tokenAddress: USDC.replace("0x0", "0x") },
      ],
      [
        "an extra key",
        {
          amount: "1",
          decimals: 6,
          label: "USDC",
          price: 1,
          tokenAddress: USDC.replace("0x0", "0x"),
        },
      ],
    ]),
  ],
  [
    "account",
    ACCOUNTS.map(([name, input]) => ({ input, name, output: accountSignsGaslessV2(input) })),
  ],
  [
    "ceiling",
    [
      ...CONVERSIONS.map(([name, input]) => ({
        input: stringify(input),
        name,
        output: convertStrkFeeToToken(input)?.toString() ?? null,
      })),
      ...[0n, 1n, 2n, 3n, 1000n, -5n].map((reference) => ({
        input: reference.toString(),
        name: `the ceiling over ${reference}`,
        output: gaslessFeeCeiling(reference).toString(),
      })),
    ],
  ],
];
