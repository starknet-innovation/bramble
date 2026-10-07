/**
 * End-to-end enforcement of the live phishing feed (issue #34): a domain that
 * is NOT in the compiled-in baseline but IS in the runtime feed snapshot must be
 * refused at wallet.requestAccounts without an extension release, while a domain
 * on neither list still connects. Mirrors the issue's Gherkin scenarios for the
 * post-release phishing domain "starknet-rewards-2026.com".
 */
import { describe, expect, test } from "bun:test";
import { createOriginGuard } from "@bramble/permissions/blocklist";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";

const FEED_ONLY = "https://starknet-rewards-2026.com";
const CLEAN = "https://legit-starknet-dapp.xyz";
const vaultPassphrase = "correct horse battery staple";

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

// Grants any origin a live account, so it is the blocklist re-check — not a
// missing grant — that must stop the feed-listed origin from connecting.
const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return {
      accounts: [account],
      accountSecrets: [],
      activeAccountId: account.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [],
      schemaVersion: 11 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x123456" }],
    };
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
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

const senderFor = (origin: string): RuntimeSender => ({ id: "extension-id", url: `${origin}/app` });

// A feed snapshot that gained the phishing domain after the extension shipped.
const makeHandler = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return createMessageHandler(walletStub, testExtension, {
    originGuard: createOriginGuard(() => new Set(["starknet-rewards-2026.com"])),
    preferencesStore: unavailablePreferencesStore,
    session,
  });
};

describe("live phishing feed enforced at connect (issue #34)", () => {
  test("a feed-listed domain absent from the baseline is refused at requestAccounts", async () => {
    await expect(
      makeHandler()({ origin: FEED_ONLY, type: "wallet.requestAccounts" }, senderFor(FEED_ONLY)),
    ).resolves.toEqual({ error: "origin blocked" });
  });

  test("a feed-listed domain is also refused at getGrantedAccounts", async () => {
    await expect(
      makeHandler()({ origin: FEED_ONLY, type: "wallet.getGrantedAccounts" }, senderFor(FEED_ONLY)),
    ).resolves.toEqual({ accounts: [], ok: true });
  });

  test("a domain on neither the baseline nor the feed still connects", async () => {
    await expect(
      makeHandler()({ origin: CLEAN, type: "wallet.requestAccounts" }, senderFor(CLEAN)),
    ).resolves.toEqual({ accounts: [account], ok: true });
  });
});
