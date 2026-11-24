/**
 * The review cases: a gateway-built outside execution and what the wallet asked for, each one
 * honest or wrong in a single way. `review.ts` runs them through the extension's checks.
 */

import { BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import { type Call, hash } from "starknet";
import {
  ARGENT_ACCOUNT,
  ETH,
  FORWARDER,
  feeTransfer,
  MAX_FELT,
  NOW,
  outsideTypedData,
  RECIPIENT,
  type Reply,
  rpcResult,
  SEPOLIA_TEST_FORWARDER,
  type Terms,
  USDC,
  usdcTransfer,
} from "./shared";

/** One review case. Unset fields take the accepted case's value. */
export type ReviewCase = {
  readonly name: string;
  readonly account?: {
    readonly accountContractType: "argent" | "braavos" | "openzeppelin";
    readonly address: string;
    readonly classHash: string;
    readonly deployed: boolean;
    readonly liveClassHash?: string;
  };
  readonly calls?: readonly Call[];
  readonly chainId?: "SN_MAIN" | "SN_SEPOLIA";
  readonly deployment?: {
    readonly addressSalt: string;
    readonly classHash: string;
    readonly constructorCalldata: readonly string[];
    readonly contractAddress: string;
  };
  /** The execute reply, when the build is accepted. */
  readonly executeReply?: Reply;
  /** Overrides the build reply (the typed data is then ignored). */
  readonly buildReply?: Reply;
  readonly locked?: boolean;
  readonly nowSeconds?: number;
  readonly quotedMax?: string;
  /** Clock read after signing; defaults to `nowSeconds`. */
  readonly readNowSeconds?: number;
  readonly reference?: bigint | null;
  readonly reviewedAmount?: string;
  readonly route?: "sepolia-default" | "sepolia-test";
  readonly typedData?: unknown;
};

const typed = (calls: readonly Call[], terms: Terms = {}) => outsideTypedData(calls, terms);

/** A deep copy of `value` with the field at `path` set to `replacement`. */
const edited = (
  value: unknown,
  path: readonly (number | string)[],
  replacement: unknown,
): unknown => {
  const copy: unknown = structuredClone(value);
  let target = copy as Record<number | string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<number | string, unknown>;
  target[path[path.length - 1] ?? ""] = replacement;
  return copy;
};

const HONEST = typed([usdcTransfer(), feeTransfer()]);
const APPROVE: Call = {
  calldata: [RECIPIENT, "0x10", "0x0"],
  contractAddress: USDC,
  entrypoint: "approve",
};
const TRANSFER_SELECTOR = hash.getSelectorFromName("transfer");
const before = (seconds: number): string => `0x${seconds.toString(16)}`;
const SEPOLIA_ACCOUNT = "0x3a1f4c2d5e6b7a8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6";

/** Every review case, in the order the fixture lists them. */
export const REVIEW_CASES: readonly ReviewCase[] = [
  { name: "accepted: one USDC transfer and a fee inside every bound" },
  {
    name: "accepted: the fee is exactly the quoted maximum and the reviewed amount",
    typedData: typed([usdcTransfer(), feeTransfer("0x7d0")]),
  },
  {
    name: "accepted: the fee is exactly the independent ceiling (600 x 7/2)",
    quotedMax: "0x834",
    reference: 600n,
    reviewedAmount: "2100",
    typedData: typed([usdcTransfer(), feeTransfer("0x834")]),
  },
  {
    name: "accepted: a reference of one rounds the ceiling up to four",
    quotedMax: "0x4",
    reference: 1n,
    reviewedAmount: "4",
    typedData: typed([usdcTransfer(), feeTransfer("0x4")]),
  },
  {
    calls: [APPROVE, usdcTransfer()],
    name: "accepted: two user calls in order",
    typedData: typed([APPROVE, usdcTransfer(), feeTransfer()]),
  },
  {
    name: "accepted: exactly ten seconds of window left",
    nowSeconds: NOW + 590,
  },
  {
    account: {
      accountContractType: "openzeppelin",
      address: SEPOLIA_ACCOUNT,
      classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH,
      deployed: false,
    },
    chainId: "SN_SEPOLIA",
    deployment: {
      addressSalt: "0x4d2",
      classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH,
      constructorCalldata: ["0x4d2"],
      contractAddress: SEPOLIA_ACCOUNT,
    },
    name: "accepted: deploy and invoke on Sepolia over a test route with a made-up forwarder",
    route: "sepolia-test",
    typedData: typed([usdcTransfer(), feeTransfer("0x3e8", USDC, SEPOLIA_TEST_FORWARDER)], {
      caller: SEPOLIA_TEST_FORWARDER,
      chainId: "SN_SEPOLIA",
    }),
  },
  // Calls that differ from what the wallet asked for.
  {
    name: "calls: the gateway changed the user's amount",
    typedData: typed([usdcTransfer("0x11"), feeTransfer()]),
  },
  {
    name: "calls: the gateway changed the user's recipient",
    typedData: typed([{ ...usdcTransfer(), calldata: [FORWARDER, "0x10", "0x0"] }, feeTransfer()]),
  },
  {
    calls: [APPROVE, usdcTransfer()],
    name: "calls: the gateway swapped the order of the user's calls",
    typedData: typed([usdcTransfer(), APPROVE, feeTransfer()]),
  },
  {
    name: "calls: the gateway inserted a call",
    typedData: typed([usdcTransfer(), APPROVE, feeTransfer()]),
  },
  { name: "calls: no fee transfer", typedData: typed([usdcTransfer()]) },
  {
    // Pinned as the extension behaves: an honest body is refused because the rebuild
    // (`outsideExecution.getTypedData`) hashes a felt entrypoint's text as a name.
    calls: [{ ...usdcTransfer(), entrypoint: TRANSFER_SELECTOR }],
    name: "calls: the user's entrypoint is given as its selector felt (an honest body)",
  },
  // The fee transfer.
  {
    name: "fee: paid in ETH, not the chosen token",
    typedData: typed([usdcTransfer(), feeTransfer("0x3e8", ETH)]),
  },
  {
    name: "fee: paid to someone other than the forwarder",
    typedData: typed([usdcTransfer(), feeTransfer("0x3e8", USDC, RECIPIENT)]),
  },
  { name: "fee: a zero amount", typedData: typed([usdcTransfer(), feeTransfer("0x0")]) },
  {
    name: "fee: an approve to the forwarder instead of a transfer",
    typedData: typed([usdcTransfer(), { ...feeTransfer(), entrypoint: "approve" }]),
  },
  {
    name: "fee: a transfer with four calldata felts",
    typedData: typed([
      usdcTransfer(),
      { ...feeTransfer(), calldata: [FORWARDER, "0x3e8", "0x0", "0x0"] },
    ]),
  },
  {
    name: "fee: a high limb makes the amount 2^128 + 1000",
    typedData: typed([usdcTransfer(), { ...feeTransfer(), calldata: [FORWARDER, "0x3e8", "0x1"] }]),
  },
  // The ceiling and the reviewed amount.
  {
    name: "ceiling: one unit above the quoted maximum",
    typedData: typed([usdcTransfer(), feeTransfer("0x7d1")]),
  },
  {
    name: "ceiling: under the quoted maximum but above the independent ceiling (500 x 7/2)",
    reference: 500n,
    typedData: typed([usdcTransfer(), feeTransfer("0x708")]),
  },
  {
    name: "ceiling: inside both bounds but above the amount the user reviewed",
    reviewedAmount: "1500",
    typedData: typed([usdcTransfer(), feeTransfer("0x640")]),
  },
  // The execution window, against the injected clock.
  {
    name: "window: one second longer than ten minutes",
    typedData: typed([usdcTransfer(), feeTransfer()], { before: before(NOW + 601) }),
  },
  { name: "window: expired", nowSeconds: NOW + 600 },
  { name: "window: nine seconds left", nowSeconds: NOW + 591 },
  {
    name: "window: not yet valid (execute after is now)",
    typedData: typed([usdcTransfer(), feeTransfer()], { after: before(NOW) }),
  },
  {
    name: "window: execute before above u64",
    typedData: typed([usdcTransfer(), feeTransfer()], { before: "0x10000000000000000" }),
  },
  {
    name: "window: the clock passed the deadline while the signer waited",
    readNowSeconds: NOW + 600,
  },
  // The caller and the nonce.
  {
    name: "caller: any caller",
    typedData: typed([usdcTransfer(), feeTransfer()], { caller: "0x414e595f43414c4c4552" }),
  },
  {
    name: "caller: another address",
    typedData: typed([usdcTransfer(), feeTransfer()], { caller: RECIPIENT }),
  },
  { name: "caller: zero", typedData: typed([usdcTransfer(), feeTransfer()], { caller: "0x0" }) },
  {
    name: "nonce: decimal digits",
    typedData: edited(HONEST, ["message", "Nonce"], "5"),
  },
  {
    name: "nonce: uppercase hex",
    typedData: edited(HONEST, ["message", "Nonce"], "0xABC"),
  },
  {
    name: "nonce: the largest felt",
    typedData: typed([usdcTransfer(), feeTransfer()], { nonce: MAX_FELT }),
  },
  {
    name: "nonce: above the field",
    typedData: edited(HONEST, ["message", "Nonce"], `0x${(BigInt(MAX_FELT) + 1n).toString(16)}`),
  },
  // The envelope.
  {
    name: "shape: Sepolia typed data on Mainnet",
    typedData: typed([usdcTransfer(), feeTransfer()], { chainId: "SN_SEPOLIA" }),
  },
  {
    name: "shape: the chain id as a hex felt",
    typedData: typed([usdcTransfer(), feeTransfer()], { chainId: "0x534e5f4d41494e" }),
  },
  {
    name: "shape: domain version 1",
    typedData: edited(HONEST, ["domain", "version"], "1"),
  },
  {
    name: "shape: an extra message field",
    typedData: edited(HONEST, ["message", "Tip"], "0x0"),
  },
  {
    name: "shape: execute after as a JSON number",
    typedData: edited(HONEST, ["message", "Execute After"], 1),
  },
  {
    name: "shape: a selector spelled as its name",
    typedData: edited(HONEST, ["message", "Calls", 0, "Selector"], "transfer"),
  },
  {
    name: "shape: a zero To",
    typedData: edited(HONEST, ["message", "Calls", 0, "To"], "0x0"),
  },
  {
    name: "shape: Execute Before typed as felt",
    typedData: edited(HONEST, ["types", "OutsideExecution", 3, "type"], "felt"),
  },
  { name: "shape: no calls", typedData: typed([]) },
  { name: "shape: typed data is null", typedData: null },
  // Gates before the build.
  { name: "gate: the Sepolia route is off", chainId: "SN_SEPOLIA", route: "sepolia-default" },
  {
    account: {
      accountContractType: "braavos",
      address: ARGENT_ACCOUNT.address,
      classHash: BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
      deployed: true,
      liveClassHash: BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
    },
    name: "gate: a Braavos account",
  },
  {
    account: {
      ...ARGENT_ACCOUNT,
      classHash: "0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003",
    },
    name: "gate: Argent 0.3.0, not verified for v2",
  },
  {
    account: { ...ARGENT_ACCOUNT, deployed: false },
    name: "gate: an undeployed account on Mainnet",
  },
  { name: "gate: no independent price for the fee token", reference: null },
  // The build reply and the execute.
  {
    buildReply: rpcResult({ fee: {}, parameters: {}, type: "invoke", typed_data: HONEST }),
    name: "build: the fee block is missing its fields",
  },
  {
    buildReply: rpcResult({
      deployment: {},
      fee: { estimated_fee_in_gas_token: "0x1" },
      parameters: {},
      type: "deploy_and_invoke",
      typed_data: HONEST,
    }),
    name: "build: a deploy-and-invoke reply for an invoke",
  },
  { locked: true, name: "execute: the wallet locked while signing" },
  { executeReply: { body: "", status: 502 }, name: "execute: a 502 with no body is a lost reply" },
  {
    executeReply: { body: JSON.stringify({ error: "screening_denied" }), status: 403 },
    name: "execute: the gateway's own screening refusal",
  },
  {
    executeReply: rpcResult({ transaction_hash: "0x0" }),
    name: "execute: a zero transaction hash",
  },
  { executeReply: rpcResult("0x7a1"), name: "execute: a bare hash result" },
];

/** The accepted case's values, which every other case starts from. */
export const DEFAULTS = {
  calls: [usdcTransfer()],
  nowSeconds: NOW,
  quotedMax: "0x7d0",
  reference: 1000n,
  reviewedAmount: "2000",
  typedData: HONEST,
} as const;
