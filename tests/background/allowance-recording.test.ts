/**
 * MCW-V09-108: the allowance log must hold the STANDING allowance after any
 * sequence of calls this wallet submits — `approve` sets it, either spelling of
 * `increase_allowance` adds to it, either spelling of `decrease_allowance`
 * subtracts — or the manager lists an amount the token does not honor and the
 * user cannot judge, or revoke, what a spender may actually take.
 */
import { describe, expect, test } from "bun:test";
import { isUnlimitedAllowance } from "@bramble/transactions/allowance-discovery";
import {
  type AllowanceStore,
  allowanceTarget,
  memoryAllowanceStore,
} from "@bramble/transactions/allowance-store";
import type { ApprovedAssets } from "@bramble/transactions/allowances";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  allowanceOwner,
  recordApproveAllowances,
} from "../../apps/extension/src/background/portfolio/allowance-recording";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";
const CANONICAL_TOKEN = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const CANONICAL_SPENDER = "0x555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const owner = allowanceOwner(account);
// The account tracks TOKEN as an ERC20 and watches COLLECTION as an NFT
// contract, which is what tells the two identically shaped `approve` calls
// apart (MCW-V09-108c).
const COLLECTION = `0x0299${"8".repeat(59)}4`;
const assets: ApprovedAssets = {
  nftContracts: [COLLECTION],
  tokens: [
    {
      address: TOKEN,
      decimals: 18,
      id: "SN_MAIN:ETH",
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    },
  ],
};

const record = (
  store: AllowanceStore,
  calls: readonly Record<string, unknown>[],
  contractAddress = TOKEN,
) =>
  recordApproveAllowances({
    assets,
    calls: calls.map((call) => ({
      calldata: call["calldata"] as string[],
      contractAddress,
      entrypoint: call["entrypoint"] as string,
    })),
    owner,
    store,
  });

const grant = (entrypoint: string, low: string, high = "0", spender = SPENDER) => ({
  calldata: [spender, low, high],
  entrypoint,
});

describe("recordApproveAllowances", () => {
  test("tracks both increase_allowance spellings so they can be revoked", async () => {
    for (const entrypoint of ["increase_allowance", "increaseAllowance"]) {
      const store = memoryAllowanceStore();
      await record(store, [grant(entrypoint, "1000")]);

      const records = await store.list();
      expect(records).toHaveLength(1);
      expect(records[0]?.amount).toBe("1000");
      expect(records[0]?.spender).toBe(CANONICAL_SPENDER);
      expect(records[0]?.token).toBe(CANONICAL_TOKEN);
      // The revoke path resolves its target from the id, so a tracked increase
      // is revokable exactly like a tracked approve.
      expect(allowanceTarget(records[0]?.id ?? "", account.id)).toEqual({
        spender: CANONICAL_SPENDER,
        token: CANONICAL_TOKEN,
      });
    }
  });

  test("records an unlimited increase alongside an approve in one transaction", async () => {
    const store = memoryAllowanceStore();
    const unlimited = (1n << 128n).toString();
    await record(store, [
      grant("approve", "5"),
      grant("increase_allowance", "0", "1", "0x777"),
      grant("transfer", "1"),
    ]);

    const records = await store.list();
    expect(records.map((entry) => entry.amount).sort()).toEqual(["5", unlimited].sort());
    expect(records.map((entry) => entry.spender)).toContain("0x777");
  });

  test("an increase of zero never erases a tracked allowance", async () => {
    // increase_allowance(spender, 0) moves nothing on chain, while the store
    // reads a zero amount as a removal — so it must not be recorded.
    const store = memoryAllowanceStore();
    await record(store, [grant("approve", "1000")]);
    await record(store, [grant("increase_allowance", "0")]);

    expect((await store.list()).map((entry) => entry.amount)).toEqual(["1000"]);
  });

  test("a zero approve still clears the tracked allowance", async () => {
    const store = memoryAllowanceStore();
    await record(store, [grant("approve", "1000")]);
    await record(store, [grant("approve", "0")]);

    expect(await store.list()).toEqual([]);
  });

  test("an increase never reduces the tracked allowance", async () => {
    // The store upserts by (account, token, spender), so recording an increase
    // as its increment would rewrite a standing unlimited grant down to a few
    // wei — the manager, and the side panel's "Unlimited" badge, would then
    // understate what the spender may actually take.
    const store = memoryAllowanceStore();
    const unlimited = 1n << 128n;
    await record(store, [grant("approve", "0", "1")]);
    await record(store, [grant("increase_allowance", "1")]);

    const [entry] = await store.list();
    expect(entry?.amount).toBe((unlimited + 1n).toString());
    expect(isUnlimitedAllowance(entry?.amount ?? "")).toBe(true);
  });

  test("repeated increases accumulate instead of overwriting", async () => {
    const store = memoryAllowanceStore();
    await record(store, [grant("increase_allowance", "40"), grant("increaseAllowance", "2")]);

    expect((await store.list()).map((entry) => entry.amount)).toEqual(["42"]);
  });

  test("an approve after an increase still replaces the tracked amount", async () => {
    // `approve` sets an absolute allowance on chain, so lowering one must be
    // mirrored locally — the no-downgrade rule belongs to deltas only.
    const store = memoryAllowanceStore();
    await record(store, [grant("increase_allowance", "1000")]);
    await record(store, [grant("approve", "7")]);

    expect((await store.list()).map((entry) => entry.amount)).toEqual(["7"]);
  });

  test("a decrease subtracts from the tracked total instead of being ignored", async () => {
    // Tracking increases but not decreases leaves the manager claiming a
    // spender may still take an amount the user has already pulled back.
    const store = memoryAllowanceStore();
    await record(store, [grant("approve", "1000")]);
    for (const entrypoint of ["decrease_allowance", "decreaseAllowance"]) {
      await record(store, [grant(entrypoint, "400")]);
    }

    expect((await store.list()).map((entry) => entry.amount)).toEqual(["200"]);
  });

  test("a decrease that empties the allowance clears the entry", async () => {
    const store = memoryAllowanceStore();
    await record(store, [grant("approve", "1000")]);
    await record(store, [grant("decrease_allowance", "1000")]);

    expect(await store.list()).toEqual([]);
  });

  // MCW-V09-108: lower-bound erasure. The wallet does not know the standing
  // amount, so it must not guess one — but writing NOTHING was its own claim:
  // it left the pair unlisted and unrevokable while the allowance granted
  // elsewhere still stood. A zero lower bound is the honest statement, and the
  // pair it keeps is what a later `allowance(owner, spender)` reading corrects.
  test("a decrease against an untracked allowance keeps the pair as an unknown amount", async () => {
    const store = memoryAllowanceStore();
    await record(store, [grant("decrease_allowance", "5")]);

    expect(await store.list()).toMatchObject([
      { amount: "0", lowerBound: true, spender: CANONICAL_SPENDER, token: CANONICAL_TOKEN },
    ]);
  });

  test("decreasing a lower bound to its floor does not erase the pair", async () => {
    // The reported sequence: the base was granted on the dapp's own site, this
    // wallet only saw `increase_allowance(100)`, and the matching
    // `decrease_allowance(100)` used to delete the record — leaving the unseen
    // base standing with nothing in the manager to revoke it from.
    const store = memoryAllowanceStore();
    await record(store, [grant("increase_allowance", "100")]);
    await record(store, [grant("decrease_allowance", "100")]);

    expect(await store.list()).toMatchObject([{ amount: "0", lowerBound: true }]);
    expect(allowanceTarget((await store.list())[0]?.id ?? "", account.id)).toEqual({
      spender: CANONICAL_SPENDER,
      token: CANONICAL_TOKEN,
    });
  });

  test("a collection approval is filed as nothing at all", async () => {
    // MCW-V09-108(c): `approve(to, item_id)` on a watched collection is the
    // same three felts as an ERC20 approve. Filing it would put an item id in
    // the log as if it were a spend cap.
    const store = memoryAllowanceStore();
    await record(store, [grant("approve", "5")], COLLECTION);

    expect(await store.list()).toEqual([]);
  });

  test("an increase with no known base is recorded as a lower bound, not a total", async () => {
    // The base may have been granted on the dapp's own site or evicted by the
    // retention cap. Writing the increment as if it were the standing allowance
    // is what made a one-wei top-up of an unlimited grant read as "1"; the
    // record says "at least 1" instead, and never claims to be the total.
    const store = memoryAllowanceStore();
    await record(store, [grant("increase_allowance", "1")]);

    const [entry] = await store.list();
    expect(entry?.amount).toBe("1");
    expect(entry?.lowerBound).toBe(true);
  });

  test("a lower bound stays one through further deltas and an approve resolves it", async () => {
    const store = memoryAllowanceStore();
    await record(store, [grant("increase_allowance", "10")]);
    await record(store, [grant("increase_allowance", "5")]);
    expect((await store.list())[0]).toMatchObject({ amount: "15", lowerBound: true });

    await record(store, [grant("decrease_allowance", "5")]);
    expect((await store.list())[0]).toMatchObject({ amount: "10", lowerBound: true });

    // `approve` states the standing allowance outright, so the record stops
    // being an estimate.
    await record(store, [grant("approve", "3")]);
    const [entry] = await store.list();
    expect(entry?.amount).toBe("3");
    expect(entry?.lowerBound).toBeUndefined();
  });

  test("an increase on a tracked exact base stays exact", async () => {
    const store = memoryAllowanceStore();
    await record(store, [grant("approve", "10")]);
    await record(store, [grant("increase_allowance", "5")]);

    const [entry] = await store.list();
    expect(entry?.amount).toBe("15");
    expect(entry?.lowerBound).toBeUndefined();
  });

  test("a failing write never throws back into the submitting path", async () => {
    const store: AllowanceStore = {
      applyDelta: () => Promise.reject(new Error("quota exceeded")),
      list: async () => [],
      record: () => Promise.reject(new Error("quota exceeded")),
      remove: async () => undefined,
    };

    expect(await record(store, [grant("approve", "1000")])).toBeUndefined();
    expect(await record(store, [grant("increase_allowance", "1000")])).toBeUndefined();
  });

  test("ignores calls that do not change an allowance", async () => {
    const store = memoryAllowanceStore();
    await record(store, [
      grant("transfer", "1"),
      grant("Approve", "1000"),
      grant("increase_Allowance", "1000"),
      { calldata: [SPENDER], entrypoint: "increase_allowance" },
    ]);

    expect(await store.list()).toEqual([]);
  });
});
