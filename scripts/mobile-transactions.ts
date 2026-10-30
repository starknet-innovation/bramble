/**
 * Transaction parity vectors for the mobile Rust core (`mobile/core/src/send`): fee policy,
 * amount grammar and call encoding, presentation rules, status judgement, and timing. Every value
 * is produced by the extension's own production code (starknet.js 10.8.0 as the extension pins
 * it, the wallet's fee policy, verifier and formatters), never by Krusty and never by hand. The
 * wire capture lives in `./mobile-transactions-capture`, the copy in `./mobile-transactions-copy`.
 */
import {
  exceedsReviewedFee,
  type FeeEstimate,
  feeBoundsMaxSpend,
  REVIEWED_FEE_HEADROOM,
  reviewedSpendFor,
} from "@bramble/starknet/fee-bounds";
import { createRpcProvider } from "@bramble/starknet/provider";
import {
  buildErc20TransferCall,
  formatTokenAmount,
  getTransactionStatuses,
  parseTokenAmount,
} from "@bramble/starknet/rpc";
import { type ActivityEntry, monotonicActivityStatus } from "@bramble/transactions/activity";
import { MAX_TRANSACTION_ALERTS_PER_DRAIN } from "@bramble/transactions/alerts";
import { verifyCalls } from "@bramble/transactions/verify";
import { shortAddress } from "@bramble/transactions/verify-decode";
import {
  DEFAULT_TOKENS,
  explorerTransactionUrl,
  isStarkFieldElement,
  normalizeFeltInput,
} from "@bramble/wallet-model/networks";
import { config, hash, stark, transaction } from "starknet";
// Not package exports: the send journey's copy and formatters are side-panel modules, read here
// only to pin the mobile port, exactly as `./mobile-parity` reads the avatar renderer.
import {
  expiredObservations,
  FAST_OBSERVATION_PERIOD_MINUTES,
  failureNoticeMessage,
  isObservedAt,
  L1_FINALITY_WINDOW_MS,
  NOT_FOUND_FAILURE_THRESHOLD,
  retiredOutcome,
  SLOW_OBSERVATION_PERIOD_MINUTES,
  UNRESOLVED_WINDOW_MS,
} from "../apps/extension/src/background/transactions/tx-observation";
import { recipientFieldError } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-model";
import { CONFIRMATION_DELAYS_MS } from "../packages/presentation/wallet-ui/src/sidepanel/shared/confirm-submitted";
import { formatFri } from "../packages/presentation/wallet-ui/src/sidepanel/shared/parts";
import { formatFeeEstimate } from "../packages/presentation/wallet-ui/src/sidepanel/shared/review-render";

const errorText = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const ESTIMATES = [
  {
    l1_data_gas_consumed: "0x180",
    l1_data_gas_price: "0x5a0",
    l1_gas_consumed: "0x0",
    l1_gas_price: "0x2d5c6b1e1ef",
    l2_gas_consumed: "0x1234a0",
    l2_gas_price: "0xb2d05e00",
    overall_fee: "0x1",
    unit: "FRI",
  },
  {
    l1_data_gas_consumed: "0x1",
    l1_data_gas_price: "0x3",
    l1_gas_consumed: "0x7",
    l1_gas_price: "0x9",
    l2_gas_consumed: "0x20000000000000",
    l2_gas_price: "0x20000000000000",
    overall_fee: "0x0",
  },
  {
    l1_data_gas_consumed: "0x0",
    l1_data_gas_price: "0x0",
    l1_gas_consumed: "0xaaaaaaaaaaaaaaaa",
    l1_gas_price: "0x1",
    l2_gas_consumed: "0x0",
    l2_gas_price: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    overall_fee: "0x0",
    unit: "WEI",
  },
  {
    l1_data_gas_consumed: "0x0",
    l1_data_gas_price: "0x0",
    l1_gas_consumed: "0xffffffffffffffff",
    l1_gas_price: "0x1",
    l2_gas_consumed: "0x0",
    l2_gas_price: "0xffffffffffffffffffffffffffffffff",
    overall_fee: "0x0",
    unit: "FRI",
  },
] as const;

const hex = (value: bigint): string => `0x${value.toString(16)}`;

/**
 * Fee policy vectors: node estimate → starknet.js overhead bounds → the spend those bounds
 * authorise, plus the reviewed-fee ceiling verdicts at and around 3/2.
 */
export const computeFeeVectors = () => ({
  bounds: ESTIMATES.map((estimate) => {
    // Estimates without a unit are part of the vector set; starknet.js reads only the gas fields.
    const resourceBounds = stark.toOverheadResourceBounds(estimate as never);
    const spend = reviewedSpendFor({ ...estimate, resourceBounds }, "standard");
    return {
      estimate,
      maxSpend: feeBoundsMaxSpend(resourceBounds)?.toString() ?? null,
      resourceBounds: {
        l1_data_gas: {
          max_amount: hex(resourceBounds.l1_data_gas.max_amount),
          max_price_per_unit: hex(resourceBounds.l1_data_gas.max_price_per_unit),
        },
        l1_gas: {
          max_amount: hex(resourceBounds.l1_gas.max_amount),
          max_price_per_unit: hex(resourceBounds.l1_gas.max_price_per_unit),
        },
        l2_gas: {
          max_amount: hex(resourceBounds.l2_gas.max_amount),
          max_price_per_unit: hex(resourceBounds.l2_gas.max_price_per_unit),
        },
      },
      reviewed: spend,
    };
  }),
  ceiling: (
    [
      [
        { overallFee: "1000", unit: "FRI" },
        { overallFee: "1500", unit: "FRI" },
      ],
      [
        { overallFee: "1000", unit: "FRI" },
        { overallFee: "1501", unit: "FRI" },
      ],
      [
        { overallFee: "1001", unit: "FRI" },
        { overallFee: "1501", unit: "FRI" },
      ],
      [
        { overallFee: "1000", unit: "FRI" },
        { overallFee: "1000", unit: "WEI" },
      ],
      [
        { overallFee: "0", unit: "FRI" },
        { overallFee: "0", unit: "FRI" },
      ],
      [
        { overallFee: "0", unit: "FRI" },
        { overallFee: "1", unit: "FRI" },
      ],
    ] as const satisfies readonly (readonly [FeeEstimate, FeeEstimate])[]
  ).map(([reviewed, quoted]) => ({
    exceeds: exceedsReviewedFee(reviewed, quoted),
    quoted,
    reviewed,
  })),
  headroom: REVIEWED_FEE_HEADROOM,
});

const AMOUNT_CASES = [
  ["1.5", 18],
  ["1", 18],
  [" 2.25 ", 18],
  ["0.000000000000000001", 18],
  ["0.0000000000000000001", 18],
  ["0", 18],
  ["0.0", 18],
  ["", 18],
  ["1.", 18],
  [".5", 18],
  ["1e3", 18],
  ["-1", 18],
  ["1,5", 18],
  ["12", 0],
  ["1.5", 0],
  ["340282366920938463463.374607431768211456", 18],
  ["115792089237316195423570985008687907853269984665640564039457.584007913129639936", 18],
  ["0001.10", 6],
] as const;

const RECIPIENT = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3";

/** Amount grammar, the ERC-20 transfer call, its selector, and the Cairo-1 execute calldata. */
export const computeCallVectors = () => {
  const strk = DEFAULT_TOKENS.find(
    (token) => token.networkId === "SN_SEPOLIA" && token.symbol === "STRK",
  );
  if (!strk) throw new Error("no STRK");
  const call = buildErc20TransferCall(strk.address, RECIPIENT, 1_500_000_000_000_000_000n);
  return {
    amounts: AMOUNT_CASES.map(([amount, decimals]) => {
      let raw: string | null = null;
      const error = errorText(() => {
        raw = parseTokenAmount(amount, decimals).toString();
      });
      return { amount, decimals, error, raw };
    }),
    executeCalldata: transaction.getExecuteCalldata([call], "1"),
    overflowError: errorText(() => buildErc20TransferCall(strk.address, RECIPIENT, 2n ** 256n)),
    transferCall: call,
    transferSelector: hash.getSelectorFromName("transfer"),
    zeroAddressErrors: [
      ["0x0", RECIPIENT],
      [strk.address, "0x0"],
      [strk.address, `0x${"0".repeat(64)}`],
    ].map(([token, recipient]) => ({
      error: errorText(() => buildErc20TransferCall(token ?? "", recipient ?? "", 1n)),
      recipient,
      token,
    })),
  };
};

const RECIPIENT_INPUTS = [
  RECIPIENT,
  "  0x3FA78C2861131190760B151F3EE110F473940ECA3FEC8CC423ECC307B5241A3  ",
  "0x0003fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3",
  "0x0",
  `0x${"0".repeat(64)}`,
  "0x",
  "0X3fa7",
  "3fa7",
  "0x3fa7g",
  "0x800000000000011000000000000000000000000000000000000000000000001",
  "0x800000000000011000000000000000000000000000000000000000000000000",
  `0x1${"0".repeat(64)}`,
  "alice.stark",
  "",
] as const;

const SHORT_INPUTS = [RECIPIENT, "0x1", "0x12345", "0x123456789a", "not an address", ""] as const;

const MAINNET_ACCOUNT = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";
const LOOKALIKE = "0x2083610000000000000000000000000000000000000000000000000000098d9";

/** Display rules: truncation, recipient grammar, explorer links, fee and amount text, summaries. */
export const computePresentationVectors = () => ({
  explorerTransactionUrls: [
    ["SN_MAIN", "0x2270039c0c7c45f14e8e57652884c8a44726d67423b2d1959b454b6ce39f099"],
    ["SN_SEPOLIA", "0x00ab"],
    ["SN_MAIN", "0x0"],
    ["SN_MAIN", "0xAB"],
    ["SN_SEPOLIA", "not a hash"],
  ].map(([networkId, txHash]) => ({
    hash: txHash,
    networkId,
    url: explorerTransactionUrl(networkId ?? "", txHash ?? ""),
  })),
  feeText: [
    { overallFee: "8053560001244160", unit: "FRI" },
    { overallFee: "1000000000000000000", unit: "FRI" },
    { overallFee: "1234567890123456789012", unit: "FRI" },
    { overallFee: "999", unit: "FRI" },
    { overallFee: "0", unit: "FRI" },
    { overallFee: "12345", unit: "WEI" },
  ].map((fee) => ({ fee, formatFri: formatFri(fee.overallFee), text: formatFeeEstimate(fee) })),
  recipients: RECIPIENT_INPUTS.map((input) => {
    const normalized = normalizeFeltInput(input);
    return {
      error: recipientFieldError(input),
      input,
      valid: isStarkFieldElement(normalized) ? normalized : null,
    };
  }),
  shortAddresses: SHORT_INPUTS.map((input) => ({ input, short: shortAddress(input) })),
  tokenAmounts: [
    ["1500000000000000000", 18],
    ["1", 18],
    ["0", 18],
    ["1000000", 6],
    ["123456789012345678901234567890", 18],
    ["7", 0],
  ].map(([raw, decimals]) => ({
    decimals,
    raw,
    text: formatTokenAmount(BigInt(raw ?? "0"), Number(decimals)),
  })),
  verification: (["SN_MAIN", "SN_SEPOLIA"] as const).flatMap((networkId) => {
    const tokens = DEFAULT_TOKENS.filter((token) => token.networkId === networkId).map((token) => ({
      ...token,
      id: `${networkId}:${token.address}`,
    }));
    const account = { address: MAINNET_ACCOUNT, networkId } as never;
    return [RECIPIENT, MAINNET_ACCOUNT, LOOKALIKE].flatMap((recipient) =>
      tokens.map((token) => {
        const report = verifyCalls(
          [buildErc20TransferCall(token.address, recipient, 1_500_000_000_000_000_000n)],
          { account, addressBook: [], tokens },
        );
        return {
          account: MAINNET_ACCOUNT,
          flags: report.flags,
          networkId,
          recipient,
          summary: report.calls[0]?.summary ?? null,
          token: token.address,
        };
      }),
    );
  }),
});

/** Status judgement: every finality × execution pair, not-found answers, and monotonic merging. */
export const computeStatusVectors = async () => {
  const finalities = [
    "RECEIVED",
    "CANDIDATE",
    "PRE_CONFIRMED",
    "ACCEPTED_ON_L2",
    "ACCEPTED_ON_L1",
    "REJECTED",
    null,
  ];
  const executions = ["SUCCEEDED", "REVERTED", null];
  const replies: { readonly reply: unknown }[] = [];
  for (const finality of finalities) {
    for (const execution of executions) {
      replies.push({
        reply: {
          result: {
            ...(execution ? { execution_status: execution } : {}),
            ...(finality ? { finality_status: finality } : {}),
          },
        },
      });
    }
  }
  replies.push(
    { reply: { error: { code: 29, message: "Transaction hash not found" } } },
    { reply: { error: { code: 1, message: "transaction hash not found" } } },
    { reply: { error: { code: 24, message: "Block not found" } } },
  );
  const judged = [];
  for (const { reply } of replies) {
    const provider = (url: string) =>
      createRpcProvider(url, {
        baseFetch: (async (_input: unknown, init?: RequestInit) => {
          const request = JSON.parse(String(init?.body)) as { readonly id: number };
          return new Response(
            JSON.stringify({ id: request.id, jsonrpc: "2.0", ...(reply as object) }),
          );
        }) as never,
      });
    const txHash = "0xabc";
    const reports = await getTransactionStatuses(
      { hashes: [txHash], rpcUrls: ["https://capture.invalid/rpc"] },
      provider,
    );
    judged.push({ reply, report: reports[txHash] });
  }
  const statuses = ["pending", "preconfirmed", "accepted", "rejected", "reverted"] as const;
  return {
    judged,
    monotonic: statuses.flatMap((current) =>
      statuses.map((observed) => ({
        current,
        merged: monotonicActivityStatus(current, observed),
        observed,
      })),
    ),
    notFoundThreshold: NOT_FOUND_FAILURE_THRESHOLD,
    fastObservationPeriodMinutes: FAST_OBSERVATION_PERIOD_MINUTES,
    unresolvedWindowMs: UNRESOLVED_WINDOW_MS,
    l1FinalityWindowMs: L1_FINALITY_WINDOW_MS,
    maxAlertsPerDrain: MAX_TRANSACTION_ALERTS_PER_DRAIN,
    notices: statuses.map((status) => ({
      message: failureNoticeMessage(observedEntry(status)),
      status,
      summary: observedEntry(status).summary,
    })),
    slowObservationPeriodMinutes: SLOW_OBSERVATION_PERIOD_MINUTES,
  };
};

const OBSERVED_AT = 1_000;

const observedEntry = (
  status: ActivityEntry["status"],
  extra: Partial<ActivityEntry> = {},
): ActivityEntry => ({
  accountId: "SN_SEPOLIA:0x1",
  hash: "0xabc",
  kind: "transfer",
  networkId: "SN_SEPOLIA",
  status,
  submittedAt: OBSERVED_AT,
  summary: "Send 1.5 STRK to 0x1…0x1",
  ...extra,
});

/**
 * The observation tiers (`isObservedAt`) and retirement (`expiredObservations` +
 * `retiredOutcome`) from `tx-observation.ts`, over status × `finalizedOnL1` × `failureNotice` ×
 * age. One compact row per case (see `columns`) keeps the file within the 500-line limit.
 */
export const computeObservationVectors = () => {
  const statuses = ["pending", "preconfirmed", "accepted", "rejected", "reverted"] as const;
  const ages = [
    0,
    UNRESOLVED_WINDOW_MS - 1,
    UNRESOLVED_WINDOW_MS,
    L1_FINALITY_WINDOW_MS - 1,
    L1_FINALITY_WINDOW_MS,
  ];
  const cases = statuses.flatMap((status) =>
    [undefined, false, true].flatMap((finalizedOnL1) =>
      [undefined, "pending" as const].flatMap((failureNotice) =>
        ages.map((ageMs) => {
          const stored = observedEntry(status, {
            ...(finalizedOnL1 === undefined ? {} : { finalizedOnL1 }),
            ...(failureNotice === undefined ? {} : { failureNotice }),
          });
          const now = OBSERVED_AT + ageMs;
          return [
            status,
            finalizedOnL1 ?? null,
            failureNotice ?? null,
            ageMs,
            isObservedAt(stored, "fast", now),
            isObservedAt(stored, "slow", now),
            expiredObservations([stored], now).length === 1,
          ];
        }),
      ),
    ),
  );
  return {
    cases,
    columns: ["status", "finalizedOnL1", "failureNotice", "ageMs", "fast", "slow", "expired"],
    retired: statuses.map((status) => retiredOutcome(observedEntry(status))),
  };
};

/** Timing and retry constants the mobile plan must share with the extension. */
export const computeTimingVectors = () => {
  const channel = config.get("channelDefaults") as {
    readonly options: {
      readonly retries: number;
      readonly transactionRetryIntervalFallback: number;
    };
  };
  return {
    confirmationDelaysMs: CONFIRMATION_DELAYS_MS,
    deployPollAttempts: channel.options.retries,
    deployPollIntervalMs: channel.options.transactionRetryIntervalFallback,
    feeHeadroom: REVIEWED_FEE_HEADROOM,
  };
};
