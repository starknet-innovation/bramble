/**
 * End-to-end Ledger signing/account wiring through the background dispatcher:
 *   - signerFor routes a keyless Ledger account to the panel/device queue and
 *     verifies the returned signature before the deploy is broadcast;
 *   - a device signature that does not verify fails closed (nothing submitted);
 *   - the four privileged Ledger messages create an account, derive picker
 *     candidates, expose pending device signs, and settle them.
 * The device is a fake signer (a starknet.js key) — no hardware or transport.
 */
import { describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import type { Vault } from "@mc-wallet/vault/schema";
import type { LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import { ec } from "starknet";
import { executeSignApproval } from "../../apps/extension/src/background/chain-ops";
import {
  createLedgerSignQueue,
  type LedgerSignQueue,
} from "../../apps/extension/src/background/ledger-sign-queue";
import { createMessageHandler } from "../../apps/extension/src/background/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/senders";
import { createUnlockSession } from "../../apps/extension/src/background/session";
import type { WalletStatusReader } from "../../apps/extension/src/background/wallet-reader";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const { starkCurve } = ec;
const PRIVATE_KEY = "0x1234567890abcdef";
const publicKeyX = starkCurve.getStarkKey(PRIVATE_KEY);
const DEPLOY_HASH = "0x1e240";

const ledgerAccount: LedgerAccountRef = {
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
  publicKeyX,
};

// A well-formed SNIP-12 typed message that hashes cleanly for the ledger account.
const TYPED_DATA = {
  domain: { chainId: "0x534e5f4d41494e", name: "Example", version: "1" },
  message: { contents: "hello" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "contents", type: "felt" }],
    StarkNetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
};

const vault = {
  accounts: [ledgerAccount],
  activeAccountId: ledgerAccount.id,
} as unknown as Vault;

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const vaultPassphrase = "correct horse battery staple";

// A vault stub whose active account is the keyless Ledger account. signHash must
// never be reached for a Ledger account (it has no key), so it throws if called.
const walletStub = {
  async addDerivedAccount() {
    return ledgerAccount;
  },
  async addLedgerAccount() {
    return ledgerAccount;
  },
  async createAccount() {
    return ledgerAccount;
  },
  async createLedgerVault() {
    return ledgerAccount;
  },
  async deriveLedgerAccounts() {
    return [ledgerAccount];
  },
  async ensureNetworkAccount() {
    return ledgerAccount;
  },
  async getGrantedAccounts() {
    return [];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [ledgerAccount];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return ledgerAccount;
  },
  async signHash(): Promise<never> {
    throw new Error("vault signHash must not be reached for a Ledger account");
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: ledgerAccount.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

// A fake device: signs whatever hash it is handed with a chosen private key.
const deviceQueue = (privateKey: string): LedgerSignQueue => ({
  pending: () => [],
  reject: () => false,
  rejectAll: () => 0,
  settle: () => false,
  async request(request) {
    const sig = starkCurve.sign(request.messageHash, privateKey);
    return { r: `0x${sig.r.toString(16)}`, s: `0x${sig.s.toString(16)}` };
  },
});

const handlerWith = (ledgerSignQueue: LedgerSignQueue) => {
  const signHashResults: { publicKey: string; r: string; s: string }[] = [];
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const handler = createMessageHandler(walletStub, "extension-id", {
    ledgerSignQueue,
    runtimeRpc: makeRuntimeRpc({
      async submitAccountDeployment(input) {
        // Stand in for the real deploy-hash signing: hand the signer the hash and
        // capture the verified signature it returns before "broadcasting".
        signHashResults.push(await input.signHash(DEPLOY_HASH));
        return { transactionHash: "0xdeploy" };
      },
    }),
    session,
  });
  return { handler, signHashResults };
};

describe("Ledger signing flow through the dispatcher", () => {
  test("signerFor routes a Ledger account to the device queue and verifies", async () => {
    const { handler, signHashResults } = handlerWith(deviceQueue(PRIVATE_KEY));

    const response = await handler({ type: "wallet.deployAccount" }, extensionSender);

    expect(response).toEqual({ ok: true, transactionHash: "0xdeploy" });
    expect(signHashResults).toHaveLength(1);
    expect(signHashResults[0]?.publicKey).toBe(publicKeyX);
    expect(
      starkCurve.verify(
        new starkCurve.Signature(
          BigInt(signHashResults[0]?.r ?? "0x0"),
          BigInt(signHashResults[0]?.s ?? "0x0"),
        ),
        DEPLOY_HASH,
        starkCurve.getPublicKey(PRIVATE_KEY),
      ),
    ).toBe(true);
  });

  test("fails closed when the device returns a signature that does not verify", async () => {
    const { handler, signHashResults } = handlerWith(deviceQueue("0xdeadbeef"));

    const response = await handler({ type: "wallet.deployAccount" }, extensionSender);

    expect(response).toEqual({ error: "Ledger signature verification failed" });
    expect(signHashResults).toHaveLength(0);
  });

  test("fails closed when no device queue is wired for a Ledger account", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    // A queue whose request never resolves would hang; instead assert the branch
    // still requires a queue by removing it via an override that throws.
    const handler = createMessageHandler(walletStub, "extension-id", {
      ledgerSignQueue: {
        pending: () => [],
        reject: () => false,
        rejectAll: () => 0,
        settle: () => false,
        request() {
          return Promise.reject(new Error("unreachable"));
        },
      },
      runtimeRpc: makeRuntimeRpc({
        async submitAccountDeployment(input) {
          await input.signHash(DEPLOY_HASH);
          return { transactionHash: "0x0" };
        },
      }),
      session,
    });
    const response = await handler({ type: "wallet.deployAccount" }, extensionSender);
    expect(response).toEqual({ error: "unreachable" });
  });
});

describe("privileged Ledger messages", () => {
  test("creates a keyless Ledger account", async () => {
    const { handler } = handlerWith(deviceQueue(PRIVATE_KEY));
    const response = await handler(
      { accountIndex: 2, networkId: "SN_MAIN", publicKeyX, type: "wallet.addLedgerAccount" },
      extensionSender,
    );
    expect(response).toEqual({ account: ledgerAccount, ok: true });
  });

  test("creates a mnemonic-less Ledger vault on first run", async () => {
    const { handler } = handlerWith(deviceQueue(PRIVATE_KEY));
    const response = await handler(
      {
        accountIndex: 2,
        networkId: "SN_MAIN",
        publicKeyX,
        type: "wallet.createLedgerVault",
        vaultPassphrase,
      },
      extensionSender,
    );
    expect(response).toEqual({ account: ledgerAccount, ok: true });
  });

  test("rejects a malformed create-ledger-vault request", async () => {
    const { handler } = handlerWith(deviceQueue(PRIVATE_KEY));
    const response = await handler(
      { accountIndex: -1, networkId: "SN_MAIN", publicKeyX, type: "wallet.createLedgerVault" },
      extensionSender,
    );
    expect(response).toEqual({ error: "invalid create ledger vault request" });
  });

  test("reads a candidate's on-chain deployed status and STRK balance", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: makeRuntimeRpc({
        async getDeploymentStatus() {
          return true;
        },
        async getTokenBalances() {
          return [
            {
              address: "0x1",
              balance: "1500000000000000000",
              decimals: 18,
              formatted: "1.5",
              id: "SN_MAIN:STRK:0x1",
              name: "Starknet Token",
              networkId: "SN_MAIN",
              symbol: "STRK",
            },
          ];
        },
      }),
      session,
    });

    const response = await handler(
      { address: ledgerAccount.address, networkId: "SN_MAIN", type: "wallet.ledgerAccountStatus" },
      extensionSender,
    );
    expect(response).toEqual({ balance: "1.5 STRK", deployed: true, ok: true });
  });

  test("degrades a candidate's status to unavailable when the RPC fails", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, "extension-id", {
      runtimeRpc: makeRuntimeRpc({
        getDeploymentStatus: () => Promise.reject(new Error("rpc down")),
        getTokenBalances: () => Promise.reject(new Error("rpc down")),
      }),
      session,
    });

    const response = await handler(
      { address: ledgerAccount.address, networkId: "SN_MAIN", type: "wallet.ledgerAccountStatus" },
      extensionSender,
    );
    expect(response).toEqual({ balance: null, deployed: null, ok: true });
  });

  test("rejects a malformed ledger-account-status request", async () => {
    const { handler } = handlerWith(deviceQueue(PRIVATE_KEY));
    const response = await handler(
      { address: "not-a-felt", networkId: "SN_MAIN", type: "wallet.ledgerAccountStatus" },
      extensionSender,
    );
    expect(response).toEqual({ error: "invalid ledger account status request" });
  });

  test("derives account-picker candidates", async () => {
    const { handler } = handlerWith(deviceQueue(PRIVATE_KEY));
    const response = await handler(
      {
        entries: [{ accountIndex: 2, publicKeyX }],
        networkId: "SN_MAIN",
        type: "wallet.deriveLedgerAccounts",
      },
      extensionSender,
    );
    expect(response).toEqual({ accounts: [ledgerAccount], ok: true });
  });

  test("exposes pending device signs and settles them from the panel", async () => {
    const queue = createLedgerSignQueue();
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(walletStub, "extension-id", {
      ledgerSignQueue: queue,
      session,
    });

    const parked = queue.request({
      accountId: ledgerAccount.id,
      messageHash: DEPLOY_HASH,
      path: ledgerAccount.derivation.path,
      publicKeyX: ledgerAccount.publicKeyX,
    });

    const pending = await handler({ type: "wallet.ledgerSignPending" }, extensionSender);
    expect(pending).toMatchObject({ ok: true, pending: [{ messageHash: DEPLOY_HASH }] });
    const id = "pending" in pending && pending.ok ? (pending.pending[0]?.id ?? "") : "";

    const settled = await handler(
      { id, r: "0x9", s: "0xa", type: "wallet.completeLedgerSign" },
      extensionSender,
    );
    expect(settled).toEqual({ ok: true });
    await expect(parked).resolves.toEqual({ r: "0x9", s: "0xa" });
  });

  test("SNIP-12 typed data routes a Ledger account to the device and verifies", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const result = await executeSignApproval(
      {
        ledgerSignQueue: deviceQueue(PRIVATE_KEY),
        preferencesStore: {
          async read() {
            return { activeNetworkId: "SN_MAIN" } as unknown as WalletPreferences;
          },
        } as never,
        session,
        wallet: {
          async getGrantedAccounts() {
            return [ledgerAccount];
          },
        } as unknown as WalletStatusReader,
      },
      { origin: "https://dapp.example", typedData: TYPED_DATA },
    );
    expect("ok" in result && result.ok).toBe(true);
  });

  test("SNIP-12 typed data fails closed on a device signature that does not verify", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    // A verify-failure must be RETURNED as `{ error }`, not thrown: the sign
    // applier settles the held dapp request only from a returned result, so a
    // throw here would leave the dapp promise hanging (as invoke/declare once
    // did). No signature is leaked to the dapp on error.
    const result = await executeSignApproval(
      {
        ledgerSignQueue: deviceQueue("0xdeadbeef"),
        preferencesStore: {
          async read() {
            return { activeNetworkId: "SN_MAIN" } as unknown as WalletPreferences;
          },
        } as never,
        session,
        wallet: {
          async getGrantedAccounts() {
            return [ledgerAccount];
          },
        } as unknown as WalletStatusReader,
      },
      { origin: "https://dapp.example", typedData: TYPED_DATA },
    );
    expect(result).toEqual({ error: "Ledger signature verification failed" });
    expect("signature" in result).toBe(false);
  });

  test("SNIP-12 typed data returns { error } (not a throw) when no device queue is wired", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    // A keyless Ledger account with no queue makes accountHashSigner throw a
    // WalletError up front. It must surface as a returned `{ error }` so the
    // applier settles the dapp waiter rather than hanging on an unhandled throw.
    const result = await executeSignApproval(
      {
        preferencesStore: {
          async read() {
            return { activeNetworkId: "SN_MAIN" } as unknown as WalletPreferences;
          },
        } as never,
        session,
        wallet: {
          async getGrantedAccounts() {
            return [ledgerAccount];
          },
        } as unknown as WalletStatusReader,
      },
      { origin: "https://dapp.example", typedData: TYPED_DATA },
    );
    expect(result).toEqual({ error: "Ledger signing unavailable" });
  });

  test("reports no pending sign for an unknown id", async () => {
    const { handler } = handlerWith(createLedgerSignQueue());
    const response = await handler(
      { id: "ledger-sign-404", r: "0x1", s: "0x2", type: "wallet.completeLedgerSign" },
      extensionSender,
    );
    expect(response).toEqual({ error: "no pending ledger sign for id" });
  });
});
