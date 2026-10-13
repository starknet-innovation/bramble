/**
 * Send-route table and gates. These tests are the specification for the four
 * bucket combinations: which submission route each takes, what it puts on chain,
 * and the single reason it refuses or waits.
 */
import { describe, expect, test } from "bun:test";
import {
  resolveSendRoute,
  routeFor,
  type SendRouteInput,
  spendableForRoute,
  type ValueBucket,
} from "@bramble/transactions/send-routes";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";

const SENDER = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RECIPIENT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc8";
const SIX_STRK = 6_000_000_000_000_000_000n;

// A composed send that clears every gate — a private transfer to a third party
// — so each test perturbs one field. Deliberately not a deposit: a deposit to
// anyone but the sender is refused, so it cannot be the baseline.
const ready = (overrides: Partial<SendRouteInput> = {}): SendRouteInput => ({
  amountRaw: 10n * SIX_STRK,
  convertedFeeCeilingRaw: null,
  destination: "private",
  feeTokenAddress: STRK_TOKEN_ADDRESS,
  feeTokenSymbol: "STRK",
  poolFeeFri: SIX_STRK,
  recipient: RECIPIENT,
  recipientRegistration: "registered",
  relayConfigured: true,
  senderAddress: SENDER,
  senderRegistration: "registered",
  source: "private",
  sourceFeeBalanceRaw: 100n * SIX_STRK,
  sourceTokenBalanceRaw: 100n * SIX_STRK,
  tokenAddress: STRK_TOKEN_ADDRESS,
  tokenDecimals: 18,
  tokenSymbol: "STRK",
  ...overrides,
});

const blockerFor = (overrides: Partial<SendRouteInput>): { pending: boolean; reason: string } => {
  const resolution = resolveSendRoute(ready(overrides));
  if (!resolution.blocked) {
    throw new Error("expected the send to be blocked");
  }
  return resolution.blocked;
};

const BUCKETS: readonly ValueBucket[] = ["private", "public"];

describe("route table", () => {
  test("names every source/destination pair", () => {
    expect(routeFor("public", "public").id).toBe("public-public");
    expect(routeFor("public", "private").id).toBe("public-private");
    expect(routeFor("private", "private").id).toBe("private-private");
    expect(routeFor("private", "public").id).toBe("private-public");
  });

  test("spending a private balance never takes the public account route", () => {
    // The pool rejects a non-deposit batch on the account route, and taking it
    // would publish the sender beside the spend. This is the invariant the whole
    // grid rests on, so it is asserted over the table rather than per route.
    for (const destination of BUCKETS) {
      expect(routeFor("private", destination).submission).toBe("relay");
    }
    for (const destination of BUCKETS) {
      expect(routeFor("public", destination).submission).toBe("account");
    }
  });

  test("charges the pool fee to the source bucket, and only when the pool is called", () => {
    // The fee arithmetic assumes the fee leaves the source bucket; if a route
    // ever charged the other one, amount-plus-fee affordability would be wrong.
    for (const source of BUCKETS) {
      for (const destination of BUCKETS) {
        const route = routeFor(source, destination);
        expect(route.feeBucket).toBe(route.poolFeeRequired ? source : "none");
      }
    }
    expect(routeFor("public", "public").poolFeeRequired).toBe(false);
  });

  test("discloses what each route actually publishes", () => {
    expect(routeFor("public", "public").reveals).toEqual(["amount", "recipient", "sender"]);
    // A deposit names the payer and the amount; the credited note's owner is hidden.
    expect(routeFor("public", "private").reveals).toEqual(["amount", "sender"]);
    // A withdrawal names who is paid; the spender stays hidden behind the relay.
    expect(routeFor("private", "public").reveals).toEqual(["amount", "recipient"]);
    expect(routeFor("private", "private").reveals).toEqual([]);
  });
});

describe("gates", () => {
  test("resolves a fully composed send", () => {
    const resolution = resolveSendRoute(ready());
    expect(resolution.route?.id).toBe("private-private");
    expect(resolution.blocked).toBeUndefined();
  });

  test("a public transfer clears the pool gates entirely", () => {
    // No registration, no relay, no fee: an ordinary ERC-20 transfer must not
    // inherit privacy preconditions.
    const resolution = resolveSendRoute(
      ready({
        destination: "public",
        poolFeeFri: null,
        recipientRegistration: "unregistered",
        relayConfigured: false,
        senderRegistration: "unregistered",
        source: "public",
      }),
    );
    expect(resolution.route?.id).toBe("public-public");
  });

  test("distinguishes an unfinished registration check from a refusal", () => {
    // A wait must never read as a refusal: callers keep an enabled control on
    // through a pending re-check, and turn it off only for a real block.
    expect(blockerFor({ senderRegistration: "unknown" })).toEqual({
      pending: true,
      reason: "Discovering your private balance…",
    });
    expect(blockerFor({ senderRegistration: "pending" })).toEqual({
      pending: true,
      reason: "Waiting for your registration to be indexed…",
    });
    expect(blockerFor({ senderRegistration: "unregistered" })).toEqual({
      pending: false,
      reason: "Activate private balances before sending privately",
    });
  });

  test("refuses to spend a private balance with no relay configured", () => {
    expect(blockerFor({ relayConfigured: false })).toEqual({
      pending: false,
      reason: "No private relay is configured for this network",
    });
    // A public source needs no unlinkable broadcast route.
    expect(
      resolveSendRoute(ready({ recipient: SENDER, relayConfigured: false, source: "public" })).route
        ?.id,
    ).toBe("public-private");
  });

  test("requires a recipient on every route, including into your own balance", () => {
    expect(blockerFor({ recipient: null }).reason).toBe("Choose a recipient first");
    expect(blockerFor({ recipient: "0x0" }).reason).toBe("Choose a recipient first");
    expect(blockerFor({ recipient: "not-a-felt" }).reason).toBe("Choose a recipient first");
  });

  test("treats a private send to the sending account as unsupported", () => {
    expect(blockerFor({ recipient: SENDER, source: "private" })).toEqual({
      pending: false,
      reason: "Private sends to the sending account are not supported",
    });
  });

  test("checks the recipient's registration only when crediting someone else", () => {
    expect(blockerFor({ recipientRegistration: "unregistered" })).toEqual({
      pending: false,
      reason: "The recipient has not activated private balances",
    });
    expect(blockerFor({ recipientRegistration: "unknown" })).toEqual({
      pending: true,
      reason: "Checking the recipient's privacy registration…",
    });
    // Shielding into your own balance is covered by your own registration, so an
    // unknown answer for yourself-as-recipient must not gate it.
    expect(
      resolveSendRoute(
        ready({ recipient: SENDER, recipientRegistration: "unknown", source: "public" }),
      ).route?.id,
    ).toBe("public-private");
    // A public destination never needs the recipient in the pool at all.
    expect(
      resolveSendRoute(ready({ destination: "public", recipientRegistration: "unregistered" }))
        .route?.id,
    ).toBe("private-public");
  });

  test("asks for an amount before anything about fees", () => {
    expect(blockerFor({ amountRaw: 0n, poolFeeFri: null })).toEqual({
      pending: false,
      reason: "Enter an amount to send. Toggle the public/private button to shield or unshield.",
    });
    expect(blockerFor({ amountRaw: -1n })).toEqual({
      pending: false,
      reason: "Enter an amount to send. Toggle the public/private button to shield or unshield.",
    });
  });

  test("waits for the live pool fee rather than composing an unaffordable batch", () => {
    expect(blockerFor({ poolFeeFri: null })).toEqual({
      pending: true,
      reason: "Checking the pool fee…",
    });
    // A route with no pool call does not wait on a fee it never pays.
    expect(
      resolveSendRoute(ready({ destination: "public", poolFeeFri: null, source: "public" })).route
        ?.id,
    ).toBe("public-public");
  });

  test("requires the amount and the fee to fit together when sending STRK", () => {
    // The fee leaves the same pot as the amount, so a balance that covers only
    // the amount is not enough.
    expect(blockerFor({ amountRaw: 100n * SIX_STRK })).toEqual({
      pending: false,
      reason:
        "Not enough private STRK for this amount plus the pool fee. You need at least 606 STRK.",
    });
    // Exactly balance-minus-fee is sendable.
    expect(resolveSendRoute(ready({ amountRaw: 99n * SIX_STRK })).route?.id).toBe(
      "private-private",
    );
  });

  test("checks a non-STRK amount and the STRK fee against their own balances", () => {
    const eth = { tokenAddress: ETH, tokenSymbol: "ETH" } as const;
    // The full token balance is sendable, because the fee comes out of STRK.
    expect(resolveSendRoute(ready({ ...eth, amountRaw: 100n * SIX_STRK })).route?.id).toBe(
      "private-private",
    );
    expect(blockerFor({ ...eth, amountRaw: 101n * SIX_STRK }).reason).toBe(
      "Not enough private ETH. You need at least 606 ETH.",
    );
    expect(blockerFor({ ...eth, sourceFeeBalanceRaw: 0n }).reason).toBe(
      "Not enough private STRK to cover the pool fee. You need at least 6 STRK.",
    );
  });

  test("names a private shortfall as private", () => {
    expect(blockerFor({ amountRaw: 200n * SIX_STRK, destination: "public" }).reason).toBe(
      "Not enough private STRK for this amount plus the pool fee. You need at least 1206 STRK.",
    );
    expect(
      blockerFor({
        destination: "public",
        sourceFeeBalanceRaw: 0n,
        tokenAddress: ETH,
        tokenSymbol: "ETH",
      }).reason,
    ).toBe("Not enough private STRK to cover the pool fee. You need at least 6 STRK.");
  });
});

describe("spendableForRoute", () => {
  const fee = {
    convertedFeeCeilingRaw: null,
    feeTokenAddress: STRK_TOKEN_ADDRESS,
    poolFeeFri: SIX_STRK,
    sourceTokenBalanceRaw: 100n * SIX_STRK,
  };

  test("reserves the pool fee when it is charged in the token being sent", () => {
    expect(
      spendableForRoute(routeFor("public", "private"), {
        ...fee,
        tokenAddress: STRK_TOKEN_ADDRESS,
      }),
    ).toBe(99n * SIX_STRK);
  });

  test("reserves nothing on a route that pays no pool fee", () => {
    expect(
      spendableForRoute(routeFor("public", "public"), { ...fee, tokenAddress: STRK_TOKEN_ADDRESS }),
    ).toBe(100n * SIX_STRK);
  });

  test("reserves nothing from a non-STRK balance, since the fee is STRK", () => {
    expect(spendableForRoute(routeFor("private", "public"), { ...fee, tokenAddress: ETH })).toBe(
      100n * SIX_STRK,
    );
  });

  test("reserves the bounded converted fee when it is charged in the token being sent", () => {
    // #356: a private USDC send whose fee is quoted in USDC must withhold the
    // converted ceiling from the same balance, not the whole amount.
    expect(
      spendableForRoute(routeFor("private", "private"), {
        convertedFeeCeilingRaw: SIX_STRK,
        feeTokenAddress: ETH,
        poolFeeFri: SIX_STRK,
        sourceTokenBalanceRaw: 100n * SIX_STRK,
        tokenAddress: ETH,
      }),
    ).toBe(99n * SIX_STRK);
  });

  test("withholds a maximum until the live fee is known", () => {
    // Max must not offer an amount the pool would reject.
    expect(
      spendableForRoute(routeFor("private", "private"), {
        convertedFeeCeilingRaw: null,
        feeTokenAddress: STRK_TOKEN_ADDRESS,
        poolFeeFri: null,
        sourceTokenBalanceRaw: 100n * SIX_STRK,
        tokenAddress: STRK_TOKEN_ADDRESS,
      }),
    ).toBeNull();
  });

  test("withholds a maximum until a converted ceiling is known", () => {
    expect(
      spendableForRoute(routeFor("private", "private"), {
        convertedFeeCeilingRaw: null,
        feeTokenAddress: ETH,
        poolFeeFri: SIX_STRK,
        sourceTokenBalanceRaw: 100n * SIX_STRK,
        tokenAddress: ETH,
      }),
    ).toBeNull();
  });

  test("floors at zero rather than offering a negative amount", () => {
    expect(
      spendableForRoute(routeFor("public", "private"), {
        convertedFeeCeilingRaw: null,
        feeTokenAddress: STRK_TOKEN_ADDRESS,
        poolFeeFri: SIX_STRK,
        sourceTokenBalanceRaw: SIX_STRK / 2n,
        tokenAddress: STRK_TOKEN_ADDRESS,
      }),
    ).toBe(0n);
  });
});

describe("depositing into someone else's private balance", () => {
  test("allows a public -> private send to a registered third party", () => {
    expect(
      resolveSendRoute(
        ready({
          destination: "private",
          recipient: RECIPIENT,
          recipientRegistration: "registered",
          source: "public",
        }),
      ).route?.id,
    ).toBe("public-private");
  });

  test("allows shielding into the sender's own balance", () => {
    expect(
      resolveSendRoute(ready({ destination: "private", recipient: SENDER, source: "public" })).route
        ?.id,
    ).toBe("public-private");
  });

  // The note lands in the recipient's channel, which is derived from their
  // registered viewing key — the same requirement a private transfer has.
  test("refuses an unregistered third party", () => {
    expect(
      blockerFor({
        destination: "private",
        recipient: RECIPIENT,
        recipientRegistration: "unregistered",
        source: "public",
      }),
    ).toEqual({ pending: false, reason: "The recipient has not activated private balances" });
  });

  test("waits rather than refuses while the third party's status is unknown", () => {
    expect(
      blockerFor({
        destination: "private",
        recipient: RECIPIENT,
        recipientRegistration: "unknown",
        source: "public",
      }),
    ).toEqual({ pending: true, reason: "Checking the recipient's privacy registration…" });
  });

  // Shielding to yourself needs no recipient lookup: your own registration
  // already covers the channel the surplus lands in.
  test("does not gate a self-deposit on a recipient lookup", () => {
    expect(
      resolveSendRoute(
        ready({
          destination: "private",
          recipient: SENDER,
          recipientRegistration: "unregistered",
          source: "public",
        }),
      ).route?.id,
    ).toBe("public-private");
  });
});

describe("unknown balances", () => {
  // An absent balance is not a zero balance. Refusing on one blocked every send
  // while the account's balances were still loading.
  test("waits until the source token balance has been read", () => {
    expect(
      resolveSendRoute(ready({ amountRaw: 10_000n * SIX_STRK, sourceTokenBalanceRaw: null }))
        .blocked,
    ).toEqual({ pending: true, reason: "Checking your private STRK balance…" });
  });

  test("still refuses when the balance is known and short", () => {
    expect(blockerFor({ amountRaw: 10_000n * SIX_STRK }).reason).toContain("Not enough private");
  });

  test("waits until the separate STRK fee balance has been read", () => {
    expect(
      resolveSendRoute(ready({ sourceFeeBalanceRaw: null, tokenAddress: ETH, tokenSymbol: "ETH" }))
        .blocked,
    ).toEqual({ pending: true, reason: "Checking your private STRK balance…" });
  });

  test("withholds a maximum rather than offering one from an unread balance", () => {
    expect(
      spendableForRoute(routeFor("public", "public"), {
        convertedFeeCeilingRaw: null,
        feeTokenAddress: STRK_TOKEN_ADDRESS,
        poolFeeFri: SIX_STRK,
        sourceTokenBalanceRaw: null,
        tokenAddress: STRK_TOKEN_ADDRESS,
      }),
    ).toBeNull();
  });
});
