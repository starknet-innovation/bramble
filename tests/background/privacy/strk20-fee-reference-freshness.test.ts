/**
 * mc-wallet #357 over the real price service: the converted-fee ceiling must
 * never be derived from an old STRK price that a refresh of some other token
 * made look current. Freshness is per address, so each leg vouches for itself.
 */
import { describe, expect, test } from "bun:test";
import { createPriceService, type HttpResponse } from "@bramble/portfolio/prices";
import { createMemoryStore } from "@bramble/store/kv";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { createStrk20FeeReference } from "../../../apps/extension/src/background/privacy/strk20-fee-reference";

const USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const POOL_FEE_6_STRK = 6_000_000_000_000_000_000n;
const DAY = 86_400_000;
const STRK_KEY = STRK_TOKEN_ADDRESS.toLowerCase().replace(/^0x0*/, "");

const ok = (body: unknown): HttpResponse => ({ json: async () => body, ok: true });
const notOk = (): HttpResponse => ({ json: async () => ({}), ok: false });

const harness = () => {
  const clock = { value: 1_000 };
  const feed: { strkBody: "price" | "empty" | "usd-only"; strkUp: boolean; strkUsd: number } = {
    strkBody: "price",
    strkUp: true,
    strkUsd: 10,
  };
  const service = createPriceService({
    http: async (url) => {
      if (url.toLowerCase().includes(STRK_KEY)) {
        const usd = feed.strkUsd;
        if (!feed.strkUp) return notOk();
        if (feed.strkBody === "empty") return ok({});
        if (feed.strkBody === "usd-only") return ok({ [STRK_TOKEN_ADDRESS]: { usd } });
        return ok({ [STRK_TOKEN_ADDRESS]: { eur: usd, gbp: usd, usd } });
      }
      return ok({ [USDC]: { eur: 1, gbp: 1, usd: 1 } });
    },
    now: () => clock.value,
    store: createMemoryStore(),
  });
  const reference = createStrk20FeeReference(service);
  const quote = () =>
    reference({ feeToken: USDC, networkId: "SN_MAIN", poolFeeFri: POOL_FEE_6_STRK });
  return { clock, feed, quote, service };
};

describe("createStrk20FeeReference over a partially refreshed price cache", () => {
  test("keeps refusing while the STRK leg is down, not only on the first call", async () => {
    const h = harness();
    // Day 0: STRK at $10, so 6 STRK bounds the fee at 60 USDC.
    await expect(h.quote()).resolves.toBe(60_000_000n);
    h.clock.value += 90 * DAY;
    h.feed.strkUp = false;
    h.feed.strkUsd = 0.1;
    await expect(h.quote()).resolves.toBeNull();
    // The USDC leg answered a second ago; that must not re-freshen STRK.
    h.clock.value += 1_000;
    await expect(h.quote()).resolves.toBeNull();
  });

  test("a USDC-only read by another caller does not re-freshen an old STRK price", async () => {
    const h = harness();
    await h.quote();
    h.clock.value += 90 * DAY;
    h.feed.strkUp = false;
    await h.service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" });
    h.clock.value += 1_000;
    await expect(h.quote()).resolves.toBeNull();
  });

  test("with the feed up, an old STRK price is refetched rather than reused", async () => {
    const h = harness();
    await h.quote();
    h.clock.value += 90 * DAY;
    h.feed.strkUsd = 0.1;
    await h.service.getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" });
    h.clock.value += 1_000;
    // 6 STRK at $0.10 is 0.6 USDC, not the 60 USDC the day-0 price would give.
    await expect(h.quote()).resolves.toBe(600_000n);
  });

  // A 200 that carries no usable STRK price is an answer, but not a price: it
  // must not stamp the old price as current (mc-wallet #357).
  for (const body of ["empty", "usd-only"] as const) {
    test(`a 200 whose STRK body is ${body} does not freshen the old price`, async () => {
      const h = harness();
      await expect(h.quote()).resolves.toBe(60_000_000n);
      h.clock.value += 90 * DAY;
      h.feed.strkBody = body;
      h.feed.strkUsd = 0.1;
      await expect(h.quote()).resolves.toBeNull();
      h.clock.value += 1_000;
      await expect(h.quote()).resolves.toBeNull();
    });
  }
});
