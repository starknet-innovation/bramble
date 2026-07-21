/**
 * dApp provider handler guards: permission and invoke requests reject a
 * malformed payload and an origin the sender cannot claim, an invoke while
 * locked fails safely, and executing a held invoke approval fails cleanly when
 * the payload has no calls, the wallet is locked, or the origin lost its grant.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../src/background/approvals";
import { LEDGER_DAPP_SIGNING_UNSUPPORTED } from "../src/background/ledger-signer";
import {
  executeInvokeApproval,
  handleProviderOps,
  type InvokeExecuteDeps,
  type ProviderOpsDeps,
} from "../src/background/provider-ops";
import type { RuntimeRpc } from "../src/background/runtime-rpc";
import { unavailablePreferencesStore } from "../src/background/runtime-state";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import { createSignatureWaiters } from "../src/background/signature-waiters";
import { memoryActivityLog } from "../src/storage/activity-store";
import { memoryAllowanceStore } from "../src/storage/allowance-store";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

const EXTENSION_ID = "extension-id";
const ORIGIN = "https://a.test";
const vaultPassphrase = "correct horse battery staple";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;

const contentSender: RuntimeSender = { id: EXTENSION_ID, url: `${ORIGIN}/app` };
const mismatchSender: RuntimeSender = { id: EXTENSION_ID, url: "https://evil.test/app" };

const wallet = {
  async getGrantedAccounts() {
    return [] as readonly AccountRef[];
  },
  async readVault() {
    return vault;
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
      ready: false,
    };
  },
} as unknown as ProviderOpsDeps["wallet"];

const providerDeps = (locked: boolean): ProviderOpsDeps => {
  const session = createUnlockSession();
  if (!locked) {
    session.unlock(vaultPassphrase);
  }
  return {
    approvals: createApprovalQueue(),
    extensionId: EXTENSION_ID,
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: {} as unknown as RuntimeRpc,
    session,
    waiters: createSignatureWaiters(),
    wallet,
  };
};

const invoke = { calls: [{ calldata: [], contractAddress: "0x1", entrypoint: "do_thing" }] };

describe("handleProviderOps guards", () => {
  test("rejects a malformed getPermissions request", async () => {
    await expect(
      handleProviderOps(
        providerDeps(false),
        "wallet.getPermissions",
        {
          type: "wallet.getPermissions",
        },
        contentSender,
      ),
    ).resolves.toEqual({ error: "invalid permissions request" });
  });

  test("rejects a getPermissions request whose origin the sender cannot claim", async () => {
    await expect(
      handleProviderOps(
        providerDeps(false),
        "wallet.getPermissions",
        { origin: ORIGIN, type: "wallet.getPermissions" },
        mismatchSender,
      ),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("rejects a malformed addInvokeTransaction request", async () => {
    await expect(
      handleProviderOps(
        providerDeps(false),
        "wallet.addInvokeTransaction",
        { type: "wallet.addInvokeTransaction" },
        contentSender,
      ),
    ).resolves.toEqual({ error: "invalid invoke request" });
  });

  test("rejects an addInvokeTransaction whose origin the sender cannot claim", async () => {
    await expect(
      handleProviderOps(
        providerDeps(false),
        "wallet.addInvokeTransaction",
        { ...invoke, origin: ORIGIN, type: "wallet.addInvokeTransaction" },
        mismatchSender,
      ),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("rejects an addInvokeTransaction while the wallet is locked", async () => {
    await expect(
      handleProviderOps(
        providerDeps(true),
        "wallet.addInvokeTransaction",
        { ...invoke, origin: ORIGIN, type: "wallet.addInvokeTransaction" },
        contentSender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
  });
});

describe("handleProviderOps dispatch", () => {
  test("returns null for a message type it does not handle", async () => {
    // The router is a keyed lookup over the provider handlers; an unrelated type
    // misses the table and yields null so the caller can try the next handler.
    await expect(
      handleProviderOps(
        providerDeps(false),
        "wallet.unrelated",
        { type: "wallet.unrelated" },
        contentSender,
      ),
    ).resolves.toBeNull();
  });
});

const executeDeps = (locked: boolean): InvokeExecuteDeps => {
  const session = createUnlockSession();
  if (!locked) {
    session.unlock(vaultPassphrase);
  }
  return {
    activity: memoryActivityLog(),
    allowanceStore: memoryAllowanceStore(),
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: {} as unknown as RuntimeRpc,
    session,
    wallet,
  };
};

const ledgerAccount: AccountRef = {
  address: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: "m/2645'/1195502025'/1470455285'/0'/0'/0",
  },
  id: "SN_MAIN:0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

// A wallet whose granted account for the origin is a keyless Ledger account, and
// whose signHash MUST NEVER be called on the dapp submit paths (they refuse a
// Ledger account up front). The preferences store pins the active network so the
// grant resolves.
const ledgerExecuteDeps = (): InvokeExecuteDeps => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return {
    activity: memoryActivityLog(),
    allowanceStore: memoryAllowanceStore(),
    preferencesStore: {
      async read() {
        return { activeNetworkId: "SN_MAIN" };
      },
    } as unknown as InvokeExecuteDeps["preferencesStore"],
    runtimeRpc: {
      submitInvokeTransaction() {
        throw new Error("must not submit for a Ledger account");
      },
    } as unknown as RuntimeRpc,
    session,
    wallet: {
      ...(wallet as object),
      async getGrantedAccounts() {
        return [ledgerAccount];
      },
    } as unknown as ProviderOpsDeps["wallet"],
  };
};

describe("executeInvokeApproval Ledger guard", () => {
  test("refuses a keyless Ledger account with a clear message, nothing submitted", async () => {
    const result = await executeInvokeApproval(ledgerExecuteDeps(), {
      origin: ORIGIN,
      payload: invoke,
    });
    expect(result).toEqual({ error: LEDGER_DAPP_SIGNING_UNSUPPORTED });
  });
});

describe("executeInvokeApproval failure branches", () => {
  test("reports approval-not-found when the held payload has no calls", async () => {
    await expect(
      executeInvokeApproval(executeDeps(false), { origin: ORIGIN, payload: {} }),
    ).resolves.toEqual({ error: "approval not found" });
  });

  test("reports the locked error when the wallet is locked", async () => {
    await expect(
      executeInvokeApproval(executeDeps(true), { origin: ORIGIN, payload: invoke }),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("reports origin-not-connected when the grant is gone", async () => {
    // The wallet returns no granted accounts for the origin, so no active
    // account resolves and the held invoke fails without submitting.
    await expect(
      executeInvokeApproval(executeDeps(false), { origin: ORIGIN, payload: invoke }),
    ).resolves.toEqual({ error: "origin not connected" });
  });
});
