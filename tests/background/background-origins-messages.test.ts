/**
 * Connected-sites and reputation message checks: listing origin grants with
 * account counts, revoking one (and its accountsChanged broadcast), refusing
 * blocklisted account requests, and attaching first-seen insights to pending
 * approvals. All connected-sites messages are privileged and need an unlocked
 * session.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../../src/background/approvals";
import { walletEventBroadcasts } from "../../src/background/events";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import { memoryOriginHistory } from "../../src/storage/origin-history";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";
import { flushHeld } from "../support/held";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const second: AccountRef = {
  ...account,
  address: "0x9994567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "SN_MAIN:0x9994567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const vault = {
  accounts: [account, second],
  activeAccountId: account.id,
  originGrants: [
    { accountIds: [account.id], origin: "https://alpha.example" },
    { accountIds: [account.id, second.id], origin: "https://beta.example" },
  ],
  schemaVersion: 1,
  signingKeys: [],
} as unknown as Vault;

const wallet = {
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
    return [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async revokeOrigin({ origin }: { readonly origin: string }) {
    return vault.originGrants
      .filter((grant) => grant.origin !== origin)
      .map((grant) => ({ accountCount: grant.accountIds.length, origin: grant.origin }));
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 2,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

const vaultPassphrase = "correct horse battery staple";
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const unlockedHandler = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return createMessageHandler(wallet, "extension-id", {
    approvals: createApprovalQueue(),
    originHistory: memoryOriginHistory(),
    session,
  });
};

describe("connected-sites messages", () => {
  test("lists origin grants with account counts, ordered by origin", async () => {
    await expect(
      unlockedHandler()({ type: "wallet.connectedSites" }, extensionSender),
    ).resolves.toEqual({
      ok: true,
      sites: [
        { accountCount: 1, origin: "https://alpha.example" },
        { accountCount: 2, origin: "https://beta.example" },
      ],
    });
  });

  test("refuses connected-sites while locked", async () => {
    const handler = createMessageHandler(wallet, "extension-id", {
      session: createUnlockSession(),
    });
    await expect(handler({ type: "wallet.connectedSites" }, extensionSender)).resolves.toEqual({
      error: "wallet locked",
    });
  });

  test("requires a privileged extension sender for connected-sites", async () => {
    const contentSender: RuntimeSender = { id: "extension-id", url: "https://alpha.example/" };
    await expect(
      unlockedHandler()({ type: "wallet.connectedSites" }, contentSender),
    ).resolves.toEqual({ error: "privileged sender required" });
  });

  test("revokes an origin and returns the remaining connected sites", async () => {
    await expect(
      unlockedHandler()(
        { origin: "https://alpha.example", type: "wallet.revokeOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual({ ok: true, sites: [{ accountCount: 2, origin: "https://beta.example" }] });
  });

  test("rejects malformed revoke requests", async () => {
    await expect(
      unlockedHandler()({ origin: "not-a-url", type: "wallet.revokeOrigin" }, extensionSender),
    ).resolves.toEqual({ error: "invalid revoke origin request" });
  });

  test("broadcasts accountsChanged after a revocation", () => {
    expect(walletEventBroadcasts({ type: "wallet.revokeOrigin" }, { ok: true, sites: [] })).toEqual(
      [{ event: "accountsChanged", type: "wallet.event" }],
    );
  });
});

describe("origin reputation on account requests", () => {
  test("refuses account requests from a blocklisted origin", async () => {
    const blockedSender: RuntimeSender = {
      id: "extension-id",
      url: "https://starknet-airdrop.com/",
    };
    await expect(
      unlockedHandler()(
        { origin: "https://starknet-airdrop.com", type: "wallet.requestAccounts" },
        blockedSender,
      ),
    ).resolves.toEqual({ error: "origin blocked" });
  });

  test("records first-seen and surfaces insights on pending approvals", async () => {
    const session = createUnlockSession();
    const approvals = createApprovalQueue();
    const handler = createMessageHandler(wallet, "extension-id", {
      approvals,
      originHistory: memoryOriginHistory(() => 1000),
      session,
    });
    const dappSender: RuntimeSender = { id: "extension-id", url: "https://cleandapp.example/" };

    // The ungranted request holds behind a queued connection approval, so fire
    // it without awaiting and inspect the enriched pending list.
    const held = handler(
      { origin: "https://cleandapp.example", type: "wallet.requestAccounts" },
      dappSender,
    );
    await flushHeld();
    const response = await handler({ type: "wallet.pendingApprovals" }, extensionSender);

    expect(response).toMatchObject({ ok: true });
    const pending = (
      response as {
        pending: readonly {
          blocked?: boolean;
          id: string;
          insights?: readonly string[];
          origin: string;
        }[];
      }
    ).pending;
    expect(pending[0]?.origin).toBe("https://cleandapp.example");
    expect(pending[0]?.blocked).toBe(false);
    // The origin is recorded only by the enricher, so the very first listing of
    // a brand-new site correctly reports it as never-before-seen.
    expect(pending[0]?.insights?.some((insight) => insight.includes("First time"))).toBe(true);

    // Settle the held request so nothing is left pending.
    await handler({ id: pending[0]?.id, type: "wallet.denyOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "connection rejected" });
  });
});
