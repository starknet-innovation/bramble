/**
 * The build block: a quote, then `wallet.swapPrepare` against it, through the real handler. Each
 * case records the build AVNU answered, the POST the service sent, and the handler's answer: the
 * review (per-call lines, flags, the route's minimum) or the refusal. An accepted build is then
 * executed (`wallet.swapExecute`) against a node that lands it, and the case records the calls
 * that reached the signer and the activity row and allowances filed for them.
 */
import { avnuDirectRoute, avnuRouteCalldata } from "@bramble/testkit/avnu-route";
import type { SwapCall } from "@bramble/transactions/avnu";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import {
  AGGREGATOR_CHOSEN_CONTRACT,
  ATTACKER_ADDRESS,
  account,
  approveRouter,
  BUY_AMOUNT,
  ETH_TOKEN_ADDRESS,
  ROUTER_ADDRESS,
  routeCall,
  routeWith,
  SELL_AMOUNT,
  STRK_TOKEN_ADDRESS,
} from "../../tests/support/swap-policy-harness";
import { quoteReply } from "./quotes";
import { json, quoteMessage, type Reply, type SwapAsk, swapHarness, tokenId } from "./run";

type BuildCase = {
  readonly name: string;
  readonly ask?: SwapAsk;
  readonly buyAmount?: string;
  readonly quote?: Reply;
  readonly slippage?: number;
  readonly build: Reply;
};

const ETH_STRK: SwapAsk = { amount: "0.01", buy: "STRK", sell: "ETH" };
const SELL_HEX = `0x${SELL_AMOUNT.toString(16)}`;
const MAX_U128 = 2n ** 128n - 1n;
const MAX_U128_HEX = `0x${MAX_U128.toString(16)}`;
// 2^128 - 1 wei, as the panel writes it.
const MAX_U128_ETH = "340282366920938463463.374607431768211455";
// The floor a 0.5% quote of 12.5 STRK implies: 12.5 × (10 000 − 50 − 1) / 10 000.
const FLOOR = (BUY_AMOUNT * 9_949n) / 10_000n;

const built = (calls: readonly unknown[], chainId: string = STARKNET_NETWORKS.SN_MAIN.chainId) =>
  json({ calls, chainId });
const honest = (name: string, calls: readonly unknown[]): BuildCase => ({
  build: built(calls),
  name,
});
const approve = (calldata: readonly string[], overrides: Partial<SwapCall> = {}): SwapCall => ({
  ...approveRouter,
  calldata,
  ...overrides,
});

// STRK → USDC: 25 STRK for 11.234567 USDC at 1% slippage, with a two-way split route.
const STRK_USDC: SwapAsk = { amount: "25", buy: "USDC", sell: "STRK" };
const USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const STRK_SELL = 25n * 10n ** 18n;
const strkUsdc: readonly SwapCall[] = [
  {
    calldata: [ROUTER_ADDRESS, `0x${STRK_SELL.toString(16)}`, "0x0"],
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "approve",
  },
  {
    calldata: avnuRouteCalldata({
      beneficiary: account.address,
      buyAmount: 11_234_567n,
      buyToken: USDC,
      minBuyAmount: 11_122_221n,
      routes: [
        avnuDirectRoute({ buyToken: USDC, percent: "0x12a05f200", sellToken: STRK_TOKEN_ADDRESS }),
        avnuDirectRoute({
          buyToken: USDC,
          params: [],
          percent: "0x12a05f200",
          sellToken: STRK_TOKEN_ADDRESS,
        }),
      ],
      sellAmount: STRK_SELL,
      sellToken: STRK_TOKEN_ADDRESS,
    }),
    contractAddress: ROUTER_ADDRESS,
    entrypoint: "multi_route_swap",
  },
];

const CASES: readonly BuildCase[] = [
  honest("the honest approve-then-route build", [approveRouter, routeCall]),
  honest("the route before the approval", [routeCall, approveRouter]),
  honest("a route promising exactly the floor", [
    approveRouter,
    routeWith({ minBuyAmount: FLOOR }),
  ]),
  honest("an integrator fee at the cap", [
    approveRouter,
    routeWith({ integratorFeeBps: 100n, integratorFeeRecipient: AGGREGATOR_CHOSEN_CONTRACT }),
  ]),
  honest("the router and the sell token spelled unpadded", [
    approve([ROUTER_ADDRESS.replace("0x0", "0x"), SELL_HEX, "0x0"], {
      contractAddress: ETH_TOKEN_ADDRESS.replace("0x0", "0x"),
    }),
    routeCall,
  ]),
  {
    build: built([approveRouter, routeWith({ minBuyAmount: (BUY_AMOUNT * 9_899n) / 10_000n })]),
    name: "a 1% slippage",
    slippage: 0.01,
  },
  {
    ask: STRK_USDC,
    build: built(strkUsdc),
    buyAmount: "11.234567",
    name: "a six-decimal buy over a split route",
    slippage: 0.01,
  },
  {
    // The largest sell the policy admits (its approval's high limb must be zero) is the
    // unlimited cut-off itself, so the review flags the approval it accepts.
    ask: { ...ETH_STRK, amount: MAX_U128_ETH },
    build: built([
      approve([ROUTER_ADDRESS, MAX_U128_HEX, "0x0"]),
      routeWith({ sellAmount: MAX_U128 }),
    ]),
    name: "a sell of 2^128 - 1 units, whose approval reads as unlimited",
  },
  // Refused by the build policy, in the order it judges.
  honest("an additive allowance", [
    approve(approveRouter.calldata, { entrypoint: "increase_allowance" }),
    routeCall,
  ]),
  honest("an approval on a token not being sold", [
    approve(approveRouter.calldata, { contractAddress: STRK_TOKEN_ADDRESS }),
    routeCall,
  ]),
  honest("an approval for more than the quoted amount", [
    approve([ROUTER_ADDRESS, "0x2386f26fc10001", "0x0"]),
    routeCall,
  ]),
  honest("an approval with a high limb", [approve([ROUTER_ADDRESS, SELL_HEX, "0x1"]), routeCall]),
  honest("an approval with an extra felt", [
    approve([ROUTER_ADDRESS, SELL_HEX, "0x0", "0x0"]),
    routeCall,
  ]),
  honest("an approval naming another spender", [
    approve([AGGREGATOR_CHOSEN_CONTRACT, SELL_HEX, "0x0"]),
    routeCall,
  ]),
  honest("two approvals", [approveRouter, approveRouter, routeCall]),
  honest("no approval", [routeCall]),
  honest("a direct transfer beside the swap", [
    approveRouter,
    routeCall,
    {
      calldata: [ATTACKER_ADDRESS, SELL_HEX, "0x0"],
      contractAddress: ETH_TOKEN_ADDRESS,
      entrypoint: "transfer",
    },
  ]),
  honest("an approval and nothing else", [approveRouter]),
  honest("a call on a contract that is not the router", [
    approveRouter,
    routeCall,
    { calldata: ["0x1"], contractAddress: ATTACKER_ADDRESS, entrypoint: "drain" },
  ]),
  honest("a non-swap entrypoint on the router", [
    approveRouter,
    { calldata: ["0x1"], contractAddress: ROUTER_ADDRESS, entrypoint: "upgrade" },
  ]),
  honest("the exact-out entrypoint", [
    approveRouter,
    { ...routeCall, entrypoint: "swap_exact_token_to" },
  ]),
  honest("two swap calls", [approveRouter, routeCall, routeCall]),
  honest("a route that does not decode", [
    approveRouter,
    { ...routeCall, calldata: routeCall.calldata.slice(0, 11) },
  ]),
  honest("a route selling another token", [
    approveRouter,
    routeWith({ sellToken: STRK_TOKEN_ADDRESS }),
  ]),
  honest("a route selling another amount", [
    approveRouter,
    routeWith({ sellAmount: SELL_AMOUNT + 1n }),
  ]),
  honest("a route buying another token", [approveRouter, routeWith({ buyToken: USDC })]),
  honest("a route paying another account", [
    approveRouter,
    routeWith({ beneficiary: ATTACKER_ADDRESS }),
  ]),
  honest("a route one unit under the floor", [
    approveRouter,
    routeWith({ minBuyAmount: FLOOR - 1n }),
  ]),
  honest("a route with no minimum", [approveRouter, routeWith({ minBuyAmount: 0n })]),
  honest("an integrator fee over the cap", [approveRouter, routeWith({ integratorFeeBps: 101n })]),
  // Refused before the policy: the envelope, each call's grammar, the panel's input.
  {
    build: built([approveRouter, routeCall], STARKNET_NETWORKS.SN_SEPOLIA.chainId),
    name: "a build for another chain",
  },
  honest("a build with no calls", []),
  honest("a build with five calls", [approveRouter, routeCall, routeCall, routeCall, routeCall]),
  {
    build: json(
      { calls: [approveRouter, routeCall], chainId: STARKNET_NETWORKS.SN_MAIN.chainId },
      502,
    ),
    name: "AVNU answers 502",
  },
  { build: { body: "{", status: 200 }, name: "AVNU answers with broken JSON" },
  honest("a call whose entrypoint is out of grammar", [
    approveRouter,
    { ...routeCall, entrypoint: "multi-route-swap" },
  ]),
  honest("a call on a contract that is not a felt", [
    approveRouter,
    { ...routeCall, contractAddress: "router" },
  ]),
  honest("an approval limb that is not a felt", [approve([ROUTER_ADDRESS, "", "0x0"]), routeCall]),
  honest("an approval naming the router in upper-case hex", [
    approve([ROUTER_ADDRESS.toUpperCase().replace("0X", "0x"), SELL_HEX, "0x0"]),
    routeCall,
  ]),
  honest("a call over the calldata cap", [
    approveRouter,
    { ...routeCall, calldata: Array.from({ length: 2001 }, () => "0x0") },
  ]),
  { build: built([approveRouter, routeCall]), name: "a slippage above 5%", slippage: 0.06 },
  { build: built([approveRouter, routeCall]), name: "a zero slippage", slippage: 0 },
  {
    build: built([approveRouter, routeCall]),
    name: "a quote id outside the id grammar",
    quote: quoteReply(ETH_STRK, "12.5", { quoteId: "dae4e180_e2cb" }),
  },
];

/** `value` as plain JSON records (the submitted calls, the allowance rows). */
const plain = (calls: unknown) => JSON.parse(JSON.stringify(calls)) as unknown;

/** Runs every build case through the real handler, executing the ones it prepares. */
export const computeBuilds = async (): Promise<readonly object[]> => {
  const out: object[] = [];
  for (const item of CASES) {
    const ask = item.ask ?? ETH_STRK;
    const quote = item.quote ?? quoteReply(ask, item.buyAmount ?? "12.5");
    const harness = swapHarness([quote, item.build]);
    const quoted = (await harness.send(quoteMessage(ask))) as {
      readonly swapQuote?: { readonly buyAmount: string; readonly quoteId: string };
    };
    if (!quoted.swapQuote) throw new Error(`${item.name}: the quote was refused`);
    const prepared = (await harness.send({
      amount: ask.amount,
      buyAmount: quoted.swapQuote.buyAmount,
      buyTokenId: tokenId(ask.buy),
      quoteId: quoted.swapQuote.quoteId,
      sellTokenId: tokenId(ask.sell),
      ...(item.slippage === undefined ? {} : { slippage: item.slippage }),
      type: "wallet.swapPrepare",
    })) as { readonly error?: string; readonly swapPreparation?: Record<string, unknown> };
    const { quote: _quote, ...rest } = item;
    const record = { ...rest, ask, quote, requests: harness.sent };
    if (!prepared.swapPreparation) {
      out.push({ ...record, response: prepared });
      continue;
    }
    // The digest, its id and the fee estimate are the extension's preparation store and fee
    // read, which the core leaves to the host; the review the person reads is the rest.
    const { flags, minBuyAmount, summaries } = prepared.swapPreparation;
    const executed = await harness.send({
      preparationId: prepared.swapPreparation["id"],
      type: "wallet.swapExecute",
    });
    const rows = await harness.activity.list();
    const allowances = await harness.allowanceStore.list();
    out.push({
      ...record,
      activity: rows.map((row) => ({
        amount: row.amount,
        summary: row.summary,
        token: row.token,
        tokenAddress: row.tokenAddress,
      })),
      allowances: allowances.map((row) =>
        plain({ amount: row.amount, spender: row.spender, token: row.token }),
      ),
      executed,
      response: { ok: true, swapPreparation: { flags, minBuyAmount, summaries } },
      submitted: plain(harness.submitted),
    });
  }
  return out;
};
