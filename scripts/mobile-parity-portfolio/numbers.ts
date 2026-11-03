/**
 * Number parity blocks: the bounds the core restates, each pinned to its TypeScript constant, and
 * the JavaScript number semantics (`toFixed`, `toLocaleString`, `Number`, `String`) it reproduces.
 */
import { HTTP_BODY_LIMITS, HTTP_REQUEST_TIMEOUT_MS } from "@bramble/core/http-json";
import { PRICE_CHART_POINT_LIMIT } from "@bramble/portfolio/prices";
import { RPC_BODY_LIMIT_BYTES, RPC_REQUEST_TIMEOUT_MS } from "@bramble/starknet/rpc-transport";

/** Bounds the core restates, each pinned to the TypeScript constant. */
export const limitsBlock = () => ({
  chartPoints: PRICE_CHART_POINT_LIMIT,
  httpTimeout: HTTP_REQUEST_TIMEOUT_MS,
  price: HTTP_BODY_LIMITS.price,
  rpcBody: RPC_BODY_LIMIT_BYTES,
  rpcTimeout: RPC_REQUEST_TIMEOUT_MS,
  starkscan: HTTP_BODY_LIMITS.starkscan,
});

const show = (value: number): string => String(value);

/** JavaScript number semantics the core reproduces. */
export const numbersBlock = () => ({
  fixed: [
    0, 0.125, 1.005, 2.675, 0.005, -0.001, 1e21, 123.456, 99.995, 5e-7, 1.45, 8.345, 1234.5678,
  ].map((value) => ({ out: value.toFixed(2), value })),
  locale: [
    0.01, 0.125, 1.005, 2.675, 999.995, 1234567.895, 1e21, 1.23e25, 0.015, 10.005,
    5030.000845459129, 7.1e-3,
  ].map((value) => ({
    out: value.toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      useGrouping: true,
    }),
    value,
  })),
  number: [
    "12.5",
    " 12 ",
    "",
    ".5",
    "5.",
    "0x10",
    "1e3",
    "-Infinity",
    "Infinity",
    "1,000",
    "abc",
    "0b11",
    "-0x1",
    "1e",
    "+.5",
    "0.1e-2",
  ].map((input) => ({ input, out: show(Number(input)) })),
  string: [0.1 + 0.2, 1e21, 123.45, 5e-7, 1e-6, -0, 1.5e300, 100, 33.33, 0.01, 2 ** 53].map(
    (value) => ({
      out: String(value),
      value,
    }),
  ),
});
