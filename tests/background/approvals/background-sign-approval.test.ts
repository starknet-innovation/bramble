/**
 * signTypedData is gated behind a per-request approval: the request is held,
 * queued as a "sign-typed-data" approval, and only signs on user approval —
 * the signature returns through the request's own channel. Deny rejects it.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef, LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { ec } from "starknet";
import { setApprovalNotifier } from "../../../apps/extension/src/background/approvals/approval-notifier";
import type { LedgerSignQueue } from "../../../apps/extension/src/background/ledger/ledger-sign-queue";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { executeSignApproval } from "../../../apps/extension/src/background/transactions/chain-ops";
import { chromiumExtension } from "../../support/background-wallet-stub";
import { flushHeld, waitForPendingApprovals } from "../../support/held";

const PASSPHRASE = "correct horse battery staple";
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
const vault = {
  accounts: [account],
  accountSecrets: [],
  activeAccountId: account.id,
  importedSeeds: [],
  mnemonic: null,
  originGrants: [{ accountIds: [account.id], origin: "https://dapp.example" }],
  schemaVersion: 10,
  signingKeys: [{ accountId: account.id, privateKey: "0x7e5" }],
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
    return [account];
  },
  async generateMnemonic() {
    return "phrase";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
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

// A well-formed SNIP-12 typed message that hashes cleanly.
const MESSAGE = {
  domain: { chainId: "0x534e5f4d41494e", name: "Example", revision: "1", version: "1" },
  message: { contents: "hello" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "contents", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
};

const content: RuntimeSender = { id: "ext", url: "https://dapp.example/swap" };
const page: RuntimeSender = { id: "ext", url: "chrome-extension://ext/sidepanel.html" };

const makeHandler = () => {
  setApprovalNotifier(() => undefined);
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  return createMessageHandler(wallet, chromiumExtension("ext"), { session });
};

const signMessage = {
  origin: "https://dapp.example",
  type: "wallet.signTypedData",
  typedData: MESSAGE,
};

describe("signTypedData approval gate", () => {
  test("returns the standard Argent account signature for approved typed data", async () => {
    const argentAccount = {
      ...account,
      accountContractType: "argent" as const,
      deploymentSalt: account.publicKeyX,
    };
    const session = createUnlockSession();
    session.unlock(PASSPHRASE);

    await expect(
      executeSignApproval(
        {
          preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
          session,
          wallet: {
            ...wallet,
            async getGrantedAccounts() {
              return [argentAccount];
            },
          },
        },
        { origin: "https://dapp.example", typedData: MESSAGE },
      ),
    ).resolves.toEqual({
      ok: true,
      signature: ["1", "0", account.publicKeyX, "0x1", "0x2"],
    });
  });

  test("valid request never auto-signs — it queues and holds until approval", async () => {
    const handler = makeHandler();
    let settled = false;
    const held = handler(signMessage, content).then((r) => {
      settled = true;
      return r;
    });
    // The request stays pending (no signature yet).
    await Promise.resolve();
    expect(settled).toBe(false);
    await flushHeld();

    // The queued approval is visible to the side panel.
    const pending = await waitForPendingApprovals<{ id: string; kind: string }>(handler, page);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe("sign-typed-data");

    // Approving from the side panel delivers the signature back to the dapp.
    await handler({ id: pending[0]?.id, type: "wallet.approveOrigin" }, page);
    const result = await held;
    expect(result).toEqual({
      ok: true,
      signature: ["0x1", "0x2"],
    });
  });

  test("deny rejects the held request with an error", async () => {
    const handler = makeHandler();
    const held = handler(signMessage, content);
    await flushHeld();
    const pending = await waitForPendingApprovals(handler, page);
    await handler({ id: pending[0]?.id, type: "wallet.denyOrigin" }, page);
    expect(await held).toEqual({ error: "request rejected" });
  });

  test("an unconnected origin cannot queue a signature", async () => {
    const lonely = {
      ...wallet,
      async getGrantedAccounts() {
        return [];
      },
    };
    const session = createUnlockSession();
    session.unlock(PASSPHRASE);
    const handler = createMessageHandler(lonely, chromiumExtension("ext"), { session });
    expect(await handler(signMessage, content)).toEqual({ error: "origin not connected" });
  });

  test("a failed Ledger device sign settles the held dapp request with { error }", async () => {
    // A keyless Ledger account whose device returns a signature that does not
    // verify. executeSignApproval must RETURN `{ error }` (not throw) so the
    // applier settles the held dapp request instead of leaving it to hang — the
    // same latent bug fixed on the invoke/declare paths. Nothing is leaked.
    const { starkCurve } = ec;
    const ledgerPublicKeyX = starkCurve.getStarkKey("0x1234567890abcdef");
    const ledgerAccount: LedgerAccountRef = {
      accountContractType: "openzeppelin",
      address: "0xabc111111",
      classHash: "0x111111",
      derivation: {
        accountIndex: 2,
        eip2645application: "LedgerW",
        kind: "ledger",
        path: ledgerAccountPath(2),
      },
      id: "SN_MAIN:0xabc111111",
      networkId: "SN_MAIN",
      publicKeyX: ledgerPublicKeyX,
    };
    // Device signs with the WRONG key, so the verify-before-broadcast gate throws
    // a WalletError inside executeSignApproval's sign path.
    const wrongKeyQueue: LedgerSignQueue = {
      pending: () => [],
      reject: () => false,
      rejectAll: () => 0,
      settle: () => false,
      async request(request) {
        const sig = starkCurve.sign(request.messageHash, "0xdeadbeef");
        return { r: `0x${sig.r.toString(16)}`, s: `0x${sig.s.toString(16)}` };
      },
    };
    const ledgerWallet = {
      ...wallet,
      async getGrantedAccounts() {
        return [ledgerAccount];
      },
      async signHash(): Promise<never> {
        throw new Error("vault signHash must not be reached for a Ledger account");
      },
    };
    setApprovalNotifier(() => undefined);
    const session = createUnlockSession();
    session.unlock(PASSPHRASE);
    const handler = createMessageHandler(ledgerWallet, chromiumExtension("ext"), {
      ledgerSignQueue: wrongKeyQueue,
      session,
    });

    let settled = false;
    const held = handler(signMessage, content).then((r) => {
      settled = true;
      return r;
    });
    const pending = await waitForPendingApprovals<{ id: string }>(handler, page);
    // The held dapp request has not settled before approval.
    expect(settled).toBe(false);

    const decision = await handler({ id: pending[0]?.id, type: "wallet.approveOrigin" }, page);

    // The dapp waiter settles to the real reason (no hang, no unhandled throw),
    // and no signature is leaked to the dapp.
    const result = await held;
    expect(result).toEqual({ error: "Ledger signature verification failed" });
    expect("signature" in (result as object)).toBe(false);
    // The approve response also surfaces the error rather than a stale ok.
    expect(decision).toEqual({ error: "Ledger signature verification failed" });
  });
});

for (const boundary of ["preferences", "grants"] as const) {
  for (const replacement of [false, true]) {
    test(`typed-data execution binds the session before ${boundary} (replacement: ${replacement})`, async () => {
      const session = createUnlockSession();
      session.unlock(PASSPHRASE);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const pause = async () => {
        entered.resolve();
        await release.promise;
      };
      const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
      let signatures = 0;
      const pending = executeSignApproval(
        {
          session,
          preferencesStore: {
            ...preferencesStore,
            async read() {
              if (boundary === "preferences") await pause();
              return preferencesStore.read();
            },
          },
          wallet: {
            ...wallet,
            async getGrantedAccounts() {
              if (boundary === "grants") await pause();
              return [account];
            },
            async signHash() {
              signatures += 1;
              return wallet.signHash();
            },
          },
        },
        { origin: "https://dapp.example", typedData: MESSAGE },
      );
      await entered.promise;
      session.lock();
      if (replacement) session.unlock(PASSPHRASE);
      release.resolve();
      await expect(pending).resolves.toEqual({ error: "wallet locked" });
      expect(signatures).toBe(0);
    });
  }
}
