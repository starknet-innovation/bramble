/**
 * Token handler invalid-input and empty-result branches: the addToken, prices,
 * and detectTokens request guards, the locked-wallet detectTokens context error,
 * and the empty-candidate detect path on a network with no curated tokens.
 * Complements background-token-messages.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { PriceService } from "@bramble/portfolio/prices";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const vaultPassphrase = "correct horse battery staple";

const sepoliaAccount: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_SEPOLIA:acct",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const wallet = {
  async createAccount() {
    return sepoliaAccount;
  },
  async addDerivedAccount() {
    return sepoliaAccount;
  },
  async ensureNetworkAccount() {
    return sepoliaAccount;
  },
  async getGrantedAccounts() {
    return [sepoliaAccount];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [sepoliaAccount];
  },
  async readVault() {
    return {
      accounts: [sepoliaAccount],
      activeAccountId: sepoliaAccount.id,
    } as unknown as Vault;
  },
  async setActiveAccount() {
    return sepoliaAccount;
  },
  async signHash() {
    return { publicKey: sepoliaAccount.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: sepoliaAccount.id,
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
      prices: Object.fromEntries(addresses.map((a) => [a, 1])),
      stale: false,
    };
  },
  async getTokenChart({ currency }) {
    return { currency, points: [1] };
  },
};

// A preferences store whose active network is Sepolia (no curated tokens) with
// no tracked tokens, so detectTokens produces an empty candidate set.
const sepoliaPreferencesStore = {
  ...unavailablePreferencesStore,
  async read() {
    return { ...defaultWalletPreferences(), activeNetworkId: "SN_SEPOLIA" as const, tokens: [] };
  },
};

const makeHandler = (unlocked: boolean) => {
  const session = createUnlockSession();
  if (unlocked) {
    session.unlock(vaultPassphrase);
  }
  return createMessageHandler(wallet, testExtension, {
    preferencesStore: sepoliaPreferencesStore,
    prices,
    runtimeRpc: makeRuntimeRpc(),
    session,
  });
};

describe("token handler invalid-input and empty branches", () => {
  test("rejects a malformed addToken request", async () => {
    await expect(makeHandler(true)({ type: "wallet.addToken" }, sender)).resolves.toEqual({
      error: "invalid add token request",
    });
  });

  test("rejects a detectTokens request carrying extra keys", async () => {
    await expect(
      makeHandler(true)({ extra: 1, type: "wallet.detectTokens" }, sender),
    ).resolves.toEqual({ error: "invalid detect tokens request" });
  });

  test("surfaces the context error when detecting tokens on a locked wallet", async () => {
    await expect(makeHandler(false)({ type: "wallet.detectTokens" }, sender)).resolves.toEqual({
      error: "wallet locked",
    });
  });

  test("returns an empty suggestion list when no curated tokens are untracked", async () => {
    await expect(makeHandler(true)({ type: "wallet.detectTokens" }, sender)).resolves.toEqual({
      ok: true,
      suggestions: [],
    });
  });

  test("rejects a prices request carrying extra keys", async () => {
    await expect(makeHandler(true)({ extra: 1, type: "wallet.prices" }, sender)).resolves.toEqual({
      error: "invalid prices request",
    });
  });
});
