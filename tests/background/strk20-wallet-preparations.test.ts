/**
 * Wallet-owned privacy preparations are digest-bound, bounded, cloned, and
 * consumed once before asynchronous submission begins.
 */
import { describe, expect, test } from "bun:test";
import { type ApprovalContext, createApprovalContext } from "../../src/background/approval-context";
import {
  createStrk20WalletPreparationStore,
  type Strk20RegistrationPreparation,
  strk20WalletPreparationPayload,
} from "../../src/background/strk20-wallet-preparations";
import type { TokenConfig } from "../../src/storage/preferences-store";
import { account } from "../support/background-wallet-stub";

const token: TokenConfig = {
  address: "0x456",
  decimals: 18,
  id: "SN_SEPOLIA:ETH:0x456",
  name: "Sepolia Ether",
  networkId: "SN_SEPOLIA",
  symbol: "ETH",
};

const registration = async (suffix = ""): Promise<Strk20RegistrationPreparation> => {
  const unsigned = {
    kind: "register" as const,
    poolAddress: `0x123${suffix}`,
    summaries: ["Register private balances"],
    token,
  };
  const context = await createApprovalContext(account, strk20WalletPreparationPayload(unsigned));
  return { ...unsigned, context, id: context.payloadDigest };
};

describe("STRK20 wallet preparation store", () => {
  test("returns a display-safe review and claims a deep clone exactly once", async () => {
    const store = createStrk20WalletPreparationStore();
    const value = await registration();

    expect(store.put(value)).toEqual({
      id: value.id,
      kind: "register",
      payloadDigest: value.id,
      poolAddress: value.poolAddress,
      route: "public-account",
      summaries: value.summaries,
      symbol: "ETH",
      tokenId: token.id,
    });
    expect(store.claim(value.id)).toEqual(value);
    expect(store.claim(value.id)).toBeNull();
    expect(store.claim("not-a-digest")).toBeNull();
  });

  test("rejects an invalid or mismatched digest commitment", async () => {
    const store = createStrk20WalletPreparationStore();
    const value = await registration();
    const badContext: ApprovalContext = {
      ...value.context,
      payloadDigest: `sha256:${"b".repeat(64)}`,
    };

    expect(() => store.put({ ...value, id: "bad" })).toThrow(
      "Invalid privacy preparation commitment",
    );
    expect(() => store.put({ ...value, context: badContext })).toThrow(
      "Invalid privacy preparation commitment",
    );
  });

  test("evicts the oldest preparation after the bounded capacity", async () => {
    const store = createStrk20WalletPreparationStore();
    const values = await Promise.all(
      Array.from({ length: 21 }, (_, index) => registration(index.toString(16))),
    );
    for (const value of values) {
      store.put(value);
    }

    expect(store.claim(values[0]?.id ?? "")).toBeNull();
    expect(store.claim(values[20]?.id ?? "")).not.toBeNull();
  });
});
