/**
 * Send-route table and gates. These tests are the specification for the four
 * bucket combinations: which submission route each takes, what it puts on chain,
 * and the single reason it refuses or waits.
 */
import { describe, expect, test } from "bun:test";
import { STRK_TOKEN_ADDRESS } from "../../src/starknet/networks";
import {
  resolveSendRoute,
  routeFor,
  type SendRouteInput,
  spendableForRoute,
  type ValueBucket,
} from "../../src/starknet/send-routes";

const SENDER = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RECIPIENT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc8";
const SIX_STRK = 6_000_000_000_000_000_000n;

// A composed send that clears every gate — a private transfer to a third party
// — so each test perturbs one field. Deliberately not a deposit: a deposit to
// anyone but the sender is refused, so it cannot be the baseline.
const ready = (overrides: Partial<SendRouteInput> = {}): SendRouteInput => ({
  amountRaw: 10n * SIX_STRK,
  destination: "private",
  poolFeeFri: SIX_STRK,
  recipient: RECIPIENT,
  recipientRegistration: "registered",
  relayConfigured: true,
  senderAddress: SENDER,
  senderRegistration: "registered",
  source: "private",
  sourceStrkBalanceRaw: 100n * SIX_STRK,
  sourceTokenBalanceRaw: 100n * SIX_STRK,
  tokenAddress: STRK_TOKEN_ADDRESS,
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
      reason: "Not enough private STRK for this amount plus the pool fee",
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
      "Not enough private ETH",
    );
    expect(blockerFor({ ...eth, sourceStrkBalanceRaw: 0n }).reason).toBe(
      "Not enough private STRK to cover the pool fee",
    );
  });

  test("names a private shortfall as private", () => {
    expect(blockerFor({ amountRaw: 200n * SIX_STRK, destination: "public" }).reason).toBe(
      "Not enough private STRK for this amount plus the pool fee",
    );
    expect(
      blockerFor({
        destination: "public",
        sourceStrkBalanceRaw: 0n,
        tokenAddress: ETH,
        tokenSymbol: "ETH",
      }).reason,
    ).toBe("Not enough private STRK to cover the pool fee");
  });
});

describe("spendableForRoute", () => {
  const fee = { poolFeeFri: SIX_STRK, sourceTokenBalanceRaw: 100n * SIX_STRK };

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

  test("withholds a maximum until the live fee is known", () => {
    // Max must not offer an amount the pool would reject.
    expect(
      spendableForRoute(routeFor("private", "private"), {
        poolFeeFri: null,
        sourceTokenBalanceRaw: 100n * SIX_STRK,
        tokenAddress: STRK_TOKEN_ADDRESS,
      }),
    ).toBeNull();
  });

  test("floors at zero rather than offering a negative amount", () => {
    expect(
      spendableForRoute(routeFor("public", "private"), {
        poolFeeFri: SIX_STRK,
        sourceTokenBalanceRaw: SIX_STRK / 2n,
        tokenAddress: STRK_TOKEN_ADDRESS,
      }),
    ).toBe(0n);
  });
});

describe("shielding to someone else", () => {
  // A v1 deposit credits the depositor and carries no recipient. Naming someone
  // else once shielded to the sender while every screen reported a payment, so
  // the route is refused rather than redirected.
  test("refuses a public -> private send to anyone but the sender", () => {
    expect(blockerFor({ destination: "private", recipient: RECIPIENT, source: "public" })).toEqual({
      pending: false,
      reason:
        "Shielding credits your own private balance; paying someone privately from a public balance is not supported yet",
    });
  });

  test("allows shielding into the sender's own balance", () => {
    expect(
      resolveSendRoute(ready({ destination: "private", recipient: SENDER, source: "public" })).route
        ?.id,
    ).toBe("public-private");
  });

  test("refuses before asking whether that recipient is registered", () => {
    // The recipient's pool status is irrelevant on this route, so the reason
    // names the real limitation instead of sending the user to register.
    expect(
      blockerFor({
        destination: "private",
        recipient: RECIPIENT,
        recipientRegistration: "registered",
        source: "public",
      }).reason,
    ).toContain("Shielding credits your own private balance");
  });
});

describe("unknown balances", () => {
  // An absent balance is not a zero balance. Refusing on one blocked every send
  // while the account's balances were still loading.
  test("does not assert affordability against a balance it has not read", () => {
    expect(
      resolveSendRoute(ready({ amountRaw: 10_000n * SIX_STRK, sourceTokenBalanceRaw: null })).route
        ?.id,
    ).toBe("private-private");
  });

  test("still refuses when the balance is known and short", () => {
    expect(blockerFor({ amountRaw: 10_000n * SIX_STRK }).reason).toContain("Not enough private");
  });

  test("skips the STRK fee check when the STRK balance is unknown", () => {
    expect(
      resolveSendRoute(ready({ sourceStrkBalanceRaw: null, tokenAddress: ETH, tokenSymbol: "ETH" }))
        .route?.id,
    ).toBe("private-private");
  });

  test("withholds a maximum rather than offering one from an unread balance", () => {
    expect(
      spendableForRoute(routeFor("public", "public"), {
        poolFeeFri: SIX_STRK,
        sourceTokenBalanceRaw: null,
        tokenAddress: STRK_TOKEN_ADDRESS,
      }),
    ).toBeNull();
  });
});
