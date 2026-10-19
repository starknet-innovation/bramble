/**
 * Issue 145: a dapp-sent AVNU `multi_route_swap` must reach the review card
 * DECODED, not as "Call multi_route_swap on 0x…".
 *
 * The gap this pins: the wallet decoded the route's beneficiary and minimum
 * output only when it built the swap itself. On the dapp invoke path the same
 * call fell through to the opaque summary, its beneficiary had no recipient
 * felt index, and so a page could ask the user to swap, set the floor to zero,
 * and route the proceeds to itself with nothing on the card naming either fact
 * and the address-poisoning refusal never running.
 *
 * Fixtures come from ../support/poisoned-recipients and the shared AVNU wire
 * fixture so this suite attacks the same addresses and the same layout as its
 * neighbours.
 */
import { describe, expect, test } from "bun:test";
import { AVNU_MULTI_ROUTE_SWAP } from "@bramble/transactions/avnu-route";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import { recipientFeltIndex } from "@bramble/transactions/verify-selectors";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { avnuRouteCalldata } from "../support/avnu-route-fixture";
import {
  CLEAN_RECIPIENT,
  POISONED_RECIPIENT,
  POISONING_CONTACT,
  POISONING_REFUSAL,
  poisoningAccount,
} from "../support/poisoned-recipients";

const ROUTER = "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const UNTRACKED = "0x0abc000000000000000000000000000000000000000000000000000000000def";

const tokens: readonly TokenConfig[] = [
  {
    address: USDC,
    decimals: 6,
    id: `SN_MAIN:USDC:${USDC}`,
    name: "USD Coin",
    networkId: "SN_MAIN",
    symbol: "USDC",
  },
  {
    address: ETH,
    decimals: 18,
    id: `SN_MAIN:ETH:${ETH}`,
    name: "Ether",
    networkId: "SN_MAIN",
    symbol: "ETH",
  },
];

const context = verificationContext(poisoningAccount, {
  addressBook: [
    {
      address: POISONING_CONTACT,
      id: `SN_MAIN:${POISONING_CONTACT}`,
      label: "Friend",
      networkId: "SN_MAIN",
    },
  ],
  tokens,
});

const swapCall = (beneficiary: string, overrides: { readonly buyToken?: string } = {}) => ({
  calldata: avnuRouteCalldata({
    beneficiary,
    buyAmount: 2n * 10n ** 17n,
    buyToken: overrides.buyToken ?? ETH,
    minBuyAmount: 19n * 10n ** 16n,
    sellAmount: 500_000_000n,
    sellToken: USDC,
  }),
  contractAddress: ROUTER,
  entrypoint: AVNU_MULTI_ROUTE_SWAP,
});

const codesOf = (report: ReturnType<typeof verifyCalls>): readonly string[] =>
  report.flags.map((flag) => flag.code);

describe("a dapp multi_route_swap is decoded on the review card", () => {
  test("beneficiary = this account: states the spend, the floor, and the payee, with no warning", () => {
    const report = verifyCalls([swapCall(poisoningAccount.address)], context);

    expect(report.calls[0]).toEqual({
      contractAddress: ROUTER,
      entrypoint: AVNU_MULTI_ROUTE_SWAP,
      kind: "swap",
      summary: "Swap 500 USDC for at least 0.19 ETH, paid to 0x1234…bcde",
    });
    expect(codesOf(report)).not.toContain("foreign-beneficiary");
    expect(codesOf(report)).not.toContain("undecoded-swap");
    // A swap into the wallet's own account is the ordinary case, not a self-send.
    expect(codesOf(report)).not.toContain("self-transfer");
    expect(refuseOnPoisonedRecipient(report)).toBeNull();
  });

  test("a token the wallet does not track is stated in base units with its address", () => {
    const report = verifyCalls(
      [swapCall(poisoningAccount.address, { buyToken: UNTRACKED })],
      context,
    );

    expect(report.calls[0]?.summary).toBe(
      "Swap 500 USDC for at least 190000000000000000 units of 0xabc0…0def, paid to 0x1234…bcde",
    );
  });

  test("beneficiary = another account: names the payee and raises the warning", () => {
    const report = verifyCalls([swapCall(CLEAN_RECIPIENT)], context);

    expect(report.calls[0]?.summary).toBe(
      "Swap 500 USDC for at least 0.19 ETH, paid to 0x777b…bbcc",
    );
    expect(report.flags).toContainEqual({
      code: "foreign-beneficiary",
      message:
        "This swap pays its proceeds to 0x777b…bbcc, not to this account. Reject it unless you meant to send them there.",
    });
    // An annotation, not a refusal: paying a swap to another account can be intended.
    expect(refuseOnPoisonedRecipient(report)).toBeNull();
  });

  test("a beneficiary that mimics a saved contact is refused like any poisoned recipient", () => {
    expect(recipientFeltIndex(AVNU_MULTI_ROUTE_SWAP)).toBe(8);
    const report = verifyCalls([swapCall(POISONED_RECIPIENT)], context);

    expect(refuseOnPoisonedRecipient(report)).toEqual({ error: POISONING_REFUSAL });
  });

  test("malformed calldata falls back to the opaque line, still shows the call, and is flagged", () => {
    const truncated = {
      ...swapCall(CLEAN_RECIPIENT),
      calldata: swapCall(CLEAN_RECIPIENT).calldata.slice(0, 11),
    };
    const report = verifyCalls([truncated], context);

    expect(report.calls[0]).toEqual({
      contractAddress: ROUTER,
      entrypoint: AVNU_MULTI_ROUTE_SWAP,
      kind: "unknown",
      summary: "Call multi_route_swap on 0x4270…3b0f",
    });
    expect(report.flags).toContainEqual({
      code: "undecoded-swap",
      message:
        "The wallet could not read this swap's payee or minimum output. Reject it unless you trust this site.",
    });
    // The beneficiary felt is still where the selector puts it, so the payee
    // rules keep running on a span the decoder refused.
    expect(codesOf(report)).toContain("foreign-beneficiary");
  });

  test("non-string calldata never crashes the reviewer", () => {
    const hostile = { ...swapCall(CLEAN_RECIPIENT), calldata: [1, 2, 3] as unknown as string[] };
    const report = verifyCalls([hostile], context);

    expect(report.calls[0]?.kind).toBe("unknown");
    expect(codesOf(report)).toContain("undecoded-swap");
  });
});
