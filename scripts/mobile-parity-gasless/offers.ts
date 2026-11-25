/**
 * The offer block: `quoteGaslessOffers`, the review's fee choices, over a scripted paymaster. Each
 * case records the account, the held tokens and their independent references, the replies, every
 * body posted (`paymaster_isAvailable`, `paymaster_getSupportedTokens`, then one
 * `paymaster_buildTransaction` per token tried) and the offers the review would show.
 */
import { gaslessRoute } from "@bramble/transactions/gasless-config";
import { quoteGaslessOffers } from "@bramble/transactions/gasless-submit";
import { sameFelt } from "@bramble/wallet-model/networks";
import {
  ARGENT_ACCOUNT,
  buildResult,
  ETH,
  feeTransfer,
  jsonReply,
  NOW,
  outsideTypedData,
  type Reply,
  rpcResult,
  type Sent,
  STRK,
  scriptedHttp,
  USDC,
  usdcTransfer,
} from "./shared";

const TOKEN_A = "0x1111111111111111111111111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222222222222222222222222";

type Held = {
  readonly address: string;
  readonly balance: string | null;
  readonly decimals: number;
  readonly label: string;
};

const HELD: readonly Held[] = [
  { address: USDC, balance: "5000", decimals: 6, label: "USDC" },
  { address: ETH, balance: "5000", decimals: 18, label: "ETH" },
  { address: STRK, balance: "0", decimals: 18, label: "STRK" },
  { address: TOKEN_A, balance: "5000", decimals: 18, label: "AAA" },
  { address: TOKEN_B, balance: "5000", decimals: 18, label: "BBB" },
];

const listed = (address: string, decimals: number) => ({ decimals, token_address: address });
const available = rpcResult(true);
const tokens = (...rows: readonly object[]): Reply => rpcResult(rows);
const quote = (token: string, amount = "0x3e8", max = "0x7d0"): Reply =>
  rpcResult(
    buildResult(outsideTypedData([usdcTransfer(), feeTransfer(amount, token)]), "invoke", max),
  );

type OfferCase = {
  readonly name: string;
  readonly replies: readonly Reply[];
  readonly account?:
    | typeof ARGENT_ACCOUNT
    | {
        readonly accountContractType: string;
        readonly address: string;
        readonly classHash: string;
        readonly deployed: boolean;
      };
  readonly held?: readonly Held[];
  /** Tokens with no independent price. */
  readonly unpriced?: readonly string[];
  readonly strkShort?: boolean;
};

const CASES: readonly OfferCase[] = [
  {
    name: "USDC and ETH listed and held: both offered, in the paymaster's order",
    replies: [available, tokens(listed(USDC, 6), listed(ETH, 18)), quote(USDC), quote(ETH)],
  },
  { name: "STRK covers the fee: nothing is asked", replies: [], strkShort: false },
  {
    account: { ...ARGENT_ACCOUNT, accountContractType: "argent-multisig" },
    name: "a multisig account: nothing is asked",
    replies: [],
  },
  {
    account: { ...ARGENT_ACCOUNT, deployed: false },
    name: "an undeployed account on Mainnet: nothing is asked",
    replies: [],
  },
  { name: "the route says it is not available", replies: [rpcResult(false)] },
  { name: "the route answers available as a string", replies: [rpcResult("true")] },
  { name: "the token list is malformed", replies: [available, tokens({ token_address: USDC })] },
  {
    name: "STRK, a token not held and a token with other decimals are skipped without a build",
    replies: [
      available,
      tokens(listed(STRK, 18), listed("0x9999", 18), listed(USDC, 18), listed(ETH, 18)),
      quote(ETH),
    ],
  },
  {
    held: HELD.map((token) => (token.label === "USDC" ? { ...token, balance: "1015" } : token)),
    name: "USDC cannot cover the fee plus the transfer: only ETH is offered",
    replies: [available, tokens(listed(USDC, 6), listed(ETH, 18)), quote(USDC), quote(ETH)],
  },
  {
    held: HELD.map((token) => (token.label === "USDC" ? { ...token, balance: null } : token)),
    name: "an unread USDC balance: only ETH is offered",
    replies: [available, tokens(listed(USDC, 6), listed(ETH, 18)), quote(USDC), quote(ETH)],
  },
  {
    name: "a USDC quote above the ceiling is dropped, ETH is offered",
    replies: [
      available,
      tokens(listed(USDC, 6), listed(ETH, 18)),
      quote(USDC, "0xdad", "0xdad"),
      quote(ETH),
    ],
  },
  {
    name: "no independent price for USDC: skipped without a build",
    replies: [available, tokens(listed(USDC, 6), listed(ETH, 18)), quote(ETH)],
    unpriced: [USDC],
  },
  {
    name: "a stated refusal on the second build hides every offer",
    replies: [
      available,
      tokens(listed(USDC, 6), listed(ETH, 18)),
      quote(USDC),
      jsonReply({ error: "screening_denied" }, 403),
    ],
  },
  {
    name: "four tokens listed and held: three builds, three offers",
    replies: [
      available,
      tokens(listed(USDC, 6), listed(ETH, 18), listed(TOKEN_A, 18), listed(TOKEN_B, 18)),
      quote(USDC),
      quote(ETH),
      quote(TOKEN_A),
    ],
  },
];

/** Every offer case through the real quote path. */
export const computeOffers = async (): Promise<readonly object[]> => {
  const cases: object[] = [];
  for (const item of CASES) {
    const sent: Sent[] = [];
    const account = item.account ?? ARGENT_ACCOUNT;
    const held = item.held ?? HELD;
    const unpriced = item.unpriced ?? [];
    const offers = await quoteGaslessOffers({
      account,
      calls: [usdcTransfer()],
      deployment: null,
      http: scriptedHttp(item.replies, sent),
      nowSeconds: NOW,
      referenceFor: async (token) =>
        unpriced.some((address) => sameFelt(address, token.address)) ? null : 1000n,
      route: gaslessRoute("SN_MAIN"),
      strkShort: item.strkShort ?? true,
      tokens: held,
    });
    cases.push({
      account,
      calls: [usdcTransfer()],
      held,
      name: item.name,
      nowSeconds: NOW,
      offers,
      reference: "1000",
      replies: item.replies,
      sent,
      strkShort: item.strkShort ?? true,
      unpriced,
    });
  }
  return cases;
};
