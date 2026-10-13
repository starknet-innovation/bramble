/**
 * Issue 647: eviction ranks risk across tokens, not raw base units. One raw
 * figure means nothing across tokens of different decimals (1000 of a
 * 6-decimal token is a thousand tokens; 5 * 10^17 of an 18-decimal token is
 * half of one), so the caps evict untracked tokens first, then tracked tokens
 * by their decimal-normalised amount, and unlimited grants last. Ranking only
 * reads the tokens the wallet trusts, and a log that cannot read them still
 * writes, ranking every record as untracked.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type TokenConfig } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import {
  ALLOWANCE_LIMITS,
  type AllowanceInput,
  type AllowanceStore,
  type AllowanceStoreOptions,
  createAllowanceStore,
  memoryAllowanceStore,
} from "@bramble/transactions/allowance-store";
import { createRankedAllowanceStore } from "../../apps/extension/src/background/portfolio/allowance-log";

const ACCOUNT = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const CAP = ALLOWANCE_LIMITS.entriesPerScope;
const UNLIMITED = ((1n << 128n) - 1n).toString();

const token = (address: string, symbol: string, decimals: number): TokenConfig => ({
  address,
  decimals,
  id: `SN_MAIN:${symbol}:${address}`,
  name: `${symbol} token`,
  networkId: "SN_MAIN",
  symbol,
});
// Two tracked tokens of different decimals, and a contract nobody tracks.
const SIX = token("0xa6", "SIXD", 6);
const EIGHTEEN = token("0xa18", "EIGHTD", 18);
const UNTRACKED = "0xbad";

const tracked: AllowanceStoreOptions = { trackedTokens: async () => [SIX, EIGHTEEN] };

const grant = (
  index: number,
  tokenAddress: string,
  amount: string,
  accountId = ACCOUNT,
): AllowanceInput => ({
  accountId,
  amount,
  networkId: "SN_MAIN",
  spender: `0x${(index + 1).toString(16)}`,
  token: tokenAddress,
});

const tokensKept = async (store: AllowanceStore): Promise<readonly string[]> =>
  (await store.list()).map((entry) => entry.token);

const HALF_EIGHTEEN = (5n * 10n ** 17n).toString(); // 0.5 of the 18-decimal token
const THOUSAND_SIX = (1000n * 10n ** 6n).toString(); // 1000 of the 6-decimal token

const cases: readonly (readonly [string, (options: AllowanceStoreOptions) => AllowanceStore])[] = [
  [
    "createAllowanceStore",
    (options) => createAllowanceStore({ ...options, store: createMemoryStore() }),
  ],
  ["memoryAllowanceStore", memoryAllowanceStore],
];

for (const [name, make] of cases) {
  describe(`${name}: mixed-token eviction keeps the riskiest grants`, () => {
    test("compares tracked tokens in whole tokens, not raw base units", async () => {
      const store = make(tracked);
      for (let index = 0; index < CAP; index += 1) {
        await store.record(grant(index, EIGHTEEN.address, HALF_EIGHTEEN));
      }
      // Raw, 10^9 is far below 5 * 10^17; in tokens, 1000 is far above 0.5.
      await store.record(grant(CAP, SIX.address, THOUSAND_SIX));

      const kept = await tokensKept(store);
      expect(kept).toHaveLength(CAP);
      expect(kept).toContain(SIX.address);
    });

    test("evicts an untracked token before any tracked one, however large its raw amount", async () => {
      const store = make(tracked);
      for (let index = 0; index < CAP; index += 1) {
        await store.record(grant(index, SIX.address, "1"));
      }
      await store.record(grant(CAP, UNTRACKED, (10n ** 30n).toString()));

      expect(await tokensKept(store)).not.toContain(UNTRACKED);
    });

    test("keeps an unlimited grant last, even on an untracked token", async () => {
      const store = make(tracked);
      await store.record(grant(0, UNTRACKED, UNLIMITED));
      for (let index = 1; index <= CAP; index += 1) {
        await store.record(grant(index, SIX.address, (10n ** 30n).toString()));
      }

      expect(await tokensKept(store)).toContain(UNTRACKED);
    });

    test("the total cap ranks by the same rule", async () => {
      const store = make(tracked);
      const perScope = ALLOWANCE_LIMITS.entriesTotal / 5;
      const scopes = [0, 1, 2, 3, 4].map((scope) => `${ACCOUNT.slice(0, -1)}${scope}`);
      for (const accountId of scopes) {
        for (let index = 0; index < perScope; index += 1) {
          await store.record(grant(index, EIGHTEEN.address, HALF_EIGHTEEN, accountId));
        }
      }
      // One more grant in the first scope makes it the tallest, so it gives one
      // up to the total cap: the half-token grant goes, not the thousand-token one.
      await store.record(grant(perScope, SIX.address, THOUSAND_SIX, scopes[0]));

      const entries = await store.list();
      expect(entries).toHaveLength(ALLOWANCE_LIMITS.entriesTotal);
      expect(entries.some((entry) => entry.token === SIX.address)).toBe(true);
    });

    test("a token list that cannot be read ranks everything as untracked", async () => {
      const store = make({ trackedTokens: () => Promise.reject(new Error("unavailable")) });
      for (let index = 0; index < CAP; index += 1) {
        await store.record(grant(index, EIGHTEEN.address, HALF_EIGHTEEN));
      }
      await store.record(grant(CAP, SIX.address, THOUSAND_SIX));

      const kept = await tokensKept(store);
      expect(kept).toHaveLength(CAP);
      // Raw order, the only figure left: the smaller raw amount went.
      expect(kept).not.toContain(SIX.address);
    });
  });
}

describe("the background's ranked allowance log", () => {
  test("ranks by the trusted tokens in the preferences it reads", async () => {
    const store = createRankedAllowanceStore(createMemoryStore(), async () => ({
      ...defaultWalletPreferences(),
      tokens: [SIX, EIGHTEEN],
    }));
    for (let index = 0; index < CAP; index += 1) {
      await store.record(grant(index, EIGHTEEN.address, HALF_EIGHTEEN));
    }
    await store.record(grant(CAP, SIX.address, THOUSAND_SIX));
    expect(await tokensKept(store)).toContain(SIX.address);
  });

  test("lends no decimals to a token a dapp added", async () => {
    // A site-named token could claim few decimals to outrank real grants; it is
    // not trusted, so it ranks as untracked and goes first.
    const dappToken = token("0xd06", "DAPPX", 0);
    const store = createRankedAllowanceStore(createMemoryStore(), async () => ({
      ...defaultWalletPreferences(),
      dappTokenIds: [dappToken.id],
      tokens: [SIX, dappToken],
    }));
    for (let index = 0; index < CAP; index += 1) {
      await store.record(grant(index, SIX.address, "1"));
    }
    await store.record(grant(CAP, dappToken.address, "1000000"));
    expect(await tokensKept(store)).not.toContain(dappToken.address);
  });
});

describe("memoryAllowanceStore: concurrent writes while ranking is read", () => {
  // The token list resolves asynchronously, as the preferences read does, so a
  // write that read the log before awaiting it would overwrite its sibling.
  const slowTokens: AllowanceStoreOptions = {
    trackedTokens: () => new Promise((resolve) => setTimeout(() => resolve([SIX]), 1)),
  };

  test("two concurrent records both survive", async () => {
    const store = memoryAllowanceStore(slowTokens);
    await Promise.all([
      store.record(grant(0, SIX.address, "1")),
      store.record(grant(1, SIX.address, "2")),
    ]);
    expect(await store.list()).toHaveLength(2);
  });

  test("two concurrent increases both apply", async () => {
    const store = memoryAllowanceStore(slowTokens);
    await store.record(grant(0, SIX.address, "10"));
    await Promise.all([
      store.applyDelta({ direction: "add", input: grant(0, SIX.address, "1") }),
      store.applyDelta({ direction: "add", input: grant(0, SIX.address, "2") }),
    ]);
    expect((await store.list())[0]?.amount).toBe("13");
  });
});
