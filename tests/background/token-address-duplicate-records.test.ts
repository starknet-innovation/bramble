/**
 * MCW-V09-110: two spellings of one token address must not become two token
 * records.
 *
 * The seeded defaults, the curated registry, and the watch-asset boundary all
 * store the zero-padded 64-hex form, while the Add-token field normalizes a
 * paste to the minimal form. Both are valid `TokenConfig` addresses and produce
 * different ids, so the same token could be tracked twice — and the private
 * balance read rejects a request carrying two numerically-equal token addresses
 * outright, disabling the whole STRK20 surface for that account with no
 * in-product way to undo it.
 *
 * These pin that the add path accepts exactly one spelling, so the duplicate
 * cannot be created in the first place.
 */
import { describe, expect, test } from "bun:test";
import type { PriceService } from "@bramble/portfolio/prices";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { DEFAULT_TOKENS, sameFelt } from "@bramble/wallet-model/networks";
import { withTokenId } from "@bramble/wallet-model/preferences";
import { readAddTokenInput } from "../../apps/extension/src/background/portfolio/token-inputs";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { testExtension } from "../support/background-wallet-stub";

// The seeded Mainnet ETH spelling, and the spelling the Add-token field's
// normalizeFeltInput produces for the very same address.
const ETH_PADDED = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const ETH_MINIMAL = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

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
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const walletStub = {
  async getGrantedAccounts() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

const prices: PriceService = {
  async getPrices({ addresses, currency }) {
    return {
      asOf: 1000,
      changes: {},
      currency,
      prices: Object.fromEntries(addresses.map((address) => [address, 1])),
      stale: false,
    };
  },
  async getTokenChart({ currency }) {
    return { currency, points: [] };
  },
};

const makeHandler = () => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const handler = createMessageHandler(walletStub as never, testExtension, {
    preferencesStore,
    prices,
    runtimeRpc: {
      async getTokenMetadata() {
        return { decimals: 18, name: "Ether", symbol: "ETH" };
      },
    } as never,
    session,
  });
  return { handler, preferencesStore };
};

describe("token address canonicalization", () => {
  test("accepts both spellings of one address as the seeded spelling", () => {
    const seeded = DEFAULT_TOKENS.find(
      (token) => token.networkId === "SN_MAIN" && token.symbol === "ETH",
    );

    expect(readAddTokenInput({ address: ETH_MINIMAL, type: "wallet.addToken" })).toEqual({
      address: ETH_PADDED,
    });
    expect(readAddTokenInput({ address: ETH_PADDED, type: "wallet.addToken" })).toEqual({
      address: ETH_PADDED,
    });
    // The one spelling accepted is the one already on disk, so the derived id
    // collides with the seeded record rather than sitting beside it.
    expect(seeded?.address).toBe(ETH_PADDED);
  });

  test("still refuses a value that is not a non-zero field element", () => {
    expect(readAddTokenInput({ address: "0x0", type: "wallet.addToken" })).toBeNull();
    expect(readAddTokenInput({ address: "not-hex", type: "wallet.addToken" })).toBeNull();
  });

  test("re-adding a seeded token by its other spelling keeps one record", async () => {
    const { handler, preferencesStore } = makeHandler();

    await expect(
      handler({ address: ETH_MINIMAL, type: "wallet.addToken" }, sender),
    ).resolves.toMatchObject({ ok: true });

    const mainnet = (await preferencesStore.read()).tokens.filter(
      (token) => token.networkId === "SN_MAIN",
    );
    expect(mainnet.filter((token) => sameFelt(token.address, ETH_PADDED))).toHaveLength(1);
    // What the private-balance read rejects: two requested token addresses that
    // are numerically equal. No pair of tracked addresses may collide.
    const numeric = mainnet.map((token) => BigInt(token.address));
    expect(new Set(numeric).size).toBe(numeric.length);
  });

  test("re-adding a tracked address that now reports another symbol changes nothing", async () => {
    // A token contract can rename itself, or a dapp-supplied symbol can differ
    // from the chain's. Either way the id differs, so only an address check
    // stops a second record, and a hide flag for a record that never existed.
    const { handler, preferencesStore } = makeHandler();
    const ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000abc";
    await preferencesStore.upsertToken(
      {
        address: ADDRESS,
        decimals: 18,
        name: "Prize Token",
        networkId: "SN_MAIN",
        symbol: "PRZ",
      },
      "user",
    );
    const before = await preferencesStore.read();

    await expect(
      handler({ address: ADDRESS, type: "wallet.addToken" }, sender),
    ).resolves.toMatchObject({ ok: true });

    const after = await preferencesStore.read();
    expect(after.tokens).toEqual(before.tokens);
    expect(after.hiddenTokens ?? []).toEqual(before.hiddenTokens ?? []);
  });

  test("derives the stored hide id from the shared builder", async () => {
    const { preferencesStore } = makeHandler();
    const seeded = (await preferencesStore.read()).tokens.find(
      (token) => token.networkId === "SN_MAIN" && token.symbol === "ETH",
    );

    // The spam-hide path keys off this id; a locally re-interpolated one that
    // drifted from withTokenId would hide nothing while reporting success.
    expect(
      withTokenId({
        address: ETH_PADDED,
        decimals: 18,
        name: "Ether",
        networkId: "SN_MAIN",
        symbol: "ETH",
      }).id,
    ).toBe(seeded?.id ?? "");
  });
});
