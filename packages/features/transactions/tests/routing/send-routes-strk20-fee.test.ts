/**
 * Regression tests for #356: the Send affordability gate must reserve the pool
 * fee in the token the relay will actually charge it in. Since #348 a private
 * send may quote its fee in the token being moved, so a holder of shielded USDC
 * with no shielded STRK must be able to send, and Max must withhold the bounded
 * converted fee from the same balance.
 */
import { describe, expect, test } from "bun:test";
import {
  resolveSendRoute,
  routeFor,
  type SendRouteInput,
  spendableForRoute,
} from "@bramble/transactions/send-routes";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";

const SENDER = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RECIPIENT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
// A non-STRK token address (USDC mainnet), just needs to differ from STRK.
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const SIX_STRK = 6_000_000_000_000_000_000n; // 6 STRK in FRI, the pool fee
const SIX_USDC = 6_000_000n; // 6 USDC at 6 decimals
const USDC_FEE_CEILING = SIX_USDC; // the bounded converted fee in USDC base units

// A private USDC transfer whose batch fee the relay quotes in the sent token
// (per #348's converted-fee selection): the user holds plenty of private USDC
// and zero private STRK, and the fee token follows the token being sent.
const privateUsdcSend = (overrides: Partial<SendRouteInput> = {}): SendRouteInput => ({
  amountRaw: 100n * SIX_USDC,
  convertedFeeCeilingRaw: USDC_FEE_CEILING,
  destination: "private",
  feeTokenAddress: USDC,
  feeTokenSymbol: "USDC",
  poolFeeFri: SIX_STRK,
  recipient: RECIPIENT,
  recipientRegistration: "registered",
  relayConfigured: true,
  senderAddress: SENDER,
  senderRegistration: "registered",
  source: "private",
  sourceFeeBalanceRaw: 1_000n * SIX_USDC,
  sourceTokenBalanceRaw: 1_000n * SIX_USDC,
  tokenAddress: USDC,
  tokenSymbol: "USDC",
  ...overrides,
});

describe("#356 converted-fee affordability", () => {
  test("ample private USDC with no private STRK resolves", () => {
    const res = resolveSendRoute(privateUsdcSend());
    expect(res.blocked).toBeUndefined();
    expect(res.route?.id).toBe("private-private");
  });

  test("the amount plus the converted fee must fit the sent-token balance", () => {
    expect(
      resolveSendRoute(privateUsdcSend({ amountRaw: 1_000n * SIX_USDC })).blocked?.reason,
    ).toBe("Not enough private USDC for this amount plus the pool fee");
    // Exactly balance-minus-fee is sendable.
    expect(
      resolveSendRoute(privateUsdcSend({ amountRaw: 1_000n * SIX_USDC - USDC_FEE_CEILING }))
        .blocked,
    ).toBeUndefined();
  });

  test("Max withholds the bounded converted fee from the sent-token balance", () => {
    expect(spendableForRoute(routeFor("private", "private"), privateUsdcSend())).toBe(
      1_000n * SIX_USDC - USDC_FEE_CEILING,
    );
  });

  test("falls back to STRK when the relay has no independent reference", () => {
    // The quote falls back to the configured fee token when no converted ceiling
    // exists, so the gate must require the STRK fee it would then charge.
    expect(
      resolveSendRoute(
        privateUsdcSend({
          convertedFeeCeilingRaw: null,
          feeTokenAddress: STRK_TOKEN_ADDRESS,
          feeTokenSymbol: "STRK",
          sourceFeeBalanceRaw: 0n,
        }),
      ).blocked?.reason,
    ).toBe("Not enough private STRK to cover the pool fee");
  });

  test("waits, rather than refusing, while the sent-token balance is unknown", () => {
    expect(
      resolveSendRoute(
        privateUsdcSend({ convertedFeeCeilingRaw: null, sourceTokenBalanceRaw: null }),
      ).blocked,
    ).toEqual({ pending: true, reason: "Checking your private USDC balance…" });
  });

  test("waits, rather than refusing, while a converted ceiling is unknown", () => {
    // The balance is known, so only the fee's size is missing: the gate must
    // wait on the pool charge rather than compose an amount it cannot back.
    expect(resolveSendRoute(privateUsdcSend({ convertedFeeCeilingRaw: null })).blocked).toEqual({
      pending: true,
      reason: "Checking the pool fee…",
    });
  });
});
