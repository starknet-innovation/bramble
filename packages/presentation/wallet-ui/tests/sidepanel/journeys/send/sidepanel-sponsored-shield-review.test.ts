/**
 * The sponsored first shield (#789) on the Send review: the panel accepts the
 * `sponsored-relay` route only in its exact shape, and the review still shows
 * every charge, attributed to the sponsor, so "free" never hides a fee.
 */
import { describe, expect, test } from "bun:test";
import { routeFor } from "@bramble/transactions/send-routes";
import { readPrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import { routeFeeHtml } from "../../../../src/sidepanel/journeys/send/transfer-review-routes";
import { preparedState } from "../../../../src/sidepanel/journeys/send/transfer-submit";

const RECIPIENT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
// 4 STRK pool fee; 0.01 STRK relay gas estimate.
const POOL_FEE = "0x3782dace9d900000";
const GAS = "0x2386f26fc10000";
const DIGEST = `sha256:${"2".repeat(64)}`;

const sponsored = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  amount: "1",
  authorization: {
    caller: "0x99",
    executeAfter: "0x1",
    executeBefore: "0x2710",
    publicCallCount: 1,
  },
  id: DIGEST,
  kind: "deposit",
  payloadDigest: DIGEST,
  poolAddress: "0x1",
  poolFeeFri: POOL_FEE,
  recipient: RECIPIENT,
  route: "sponsored-relay",
  sponsor: { estimatedNetworkFeeFri: GAS, name: "Starknet Foundation" },
  summaries: ["Shield 1 STRK"],
  symbol: "STRK",
  tokenId: "SN_MAIN:STRK:0x1",
  ...overrides,
});

const read = (value: Record<string, unknown>, kind: "deposit" | "transfer" = "deposit") =>
  readPrivacyPreparation({ ok: true, strk20Preparation: value }, { kind });

describe("sponsored shield review", () => {
  test("is accepted in its exact shape", () => {
    const preparation = read(sponsored());
    expect(preparation?.route).toBe("sponsored-relay");
    expect(preparation?.sponsor).toEqual({
      estimatedNetworkFeeFri: GAS,
      name: "Starknet Foundation",
    });
  });

  const malformed: readonly [string, Record<string, unknown>][] = [
    ["no sponsor", { sponsor: undefined }],
    ["a sponsor on another route", { route: "public-account" }],
    ["a fee of the user's", { networkFee: { overallFee: "0x1", unit: "FRI" } }],
    ["a relay fee", { relayFee: { amount: "0x1", recipient: "0x2", token: "0x3" } }],
    ["no authorization", { authorization: undefined }],
    ["no pool fee", { poolFeeFri: undefined }],
    ["an empty sponsor name", { sponsor: { name: "" } }],
    ["a malformed estimate", { sponsor: { estimatedNetworkFeeFri: "lots", name: "S" } }],
    ["an unknown sponsor field", { sponsor: { name: "S", url: "https://x" } }],
  ];
  for (const [name, overrides] of malformed) {
    test(`is rejected with ${name}`, () => {
      const value = sponsored(overrides);
      for (const [key, entry] of Object.entries(overrides)) {
        if (entry === undefined) delete value[key];
      }
      expect(read(value)).toBeNull();
    });
  }

  test("is a shield only", () => {
    expect(read(sponsored({ kind: "transfer" }), "transfer")).toBeNull();
  });

  test("shows every charge, each attributed to the sponsor", () => {
    const preparation = read(sponsored());
    if (!preparation) throw new Error("fixture rejected");
    const html = routeFeeHtml(routeFor("public", "private"), {
      poolFeeFri: POOL_FEE,
      preparation,
      review: null,
    });
    expect(html).toContain("Fee: paid by Starknet Foundation");
    expect(html).toContain("Pool fee: 4 STRK, paid by Starknet Foundation");
    expect(html).toContain("Estimated fee: 0.01 STRK, paid by Starknet Foundation");
    expect(html).not.toContain("from your public balance");
  });

  test("leaves the estimate line out when the relay gave none", () => {
    const preparation = read(sponsored({ sponsor: { name: "Starknet Foundation" } }));
    if (!preparation) throw new Error("fixture rejected");
    const html = routeFeeHtml(routeFor("public", "private"), { preparation, review: null });
    expect(html).toContain("Pool fee: 4 STRK, paid by Starknet Foundation");
    expect(html).not.toContain("Estimated fee");
  });

  test("asks for no public STRK and keeps Confirm available", () => {
    const preparation = read(sponsored());
    if (!preparation) throw new Error("fixture rejected");
    const state = preparedState(
      preparation,
      {
        amount: "1",
        asset: "SN_MAIN:STRK:0x1",
        destination: "private",
        recipient: RECIPIENT,
        source: "public",
      } as never,
      "key",
      { blockShieldStrkShort: true, publicBalances: () => [] },
    );
    expect(state.reviewedKey).toBe("key");
    expect(state.review?.shieldStrkNeed).toBeUndefined();
    expect(state.error).toBe("");
  });
});
