/**
 * The privileged viewing-key ceremony message end to end through the dispatcher.
 *
 * What matters here is not the crypto (covered in tests/wallet) but the wiring:
 * the scope comes from wallet state rather than the message, the device prompt is
 * labelled with the viewing-key intent rather than a transaction one, a dapp
 * origin cannot reach the message at all, and a non-Ledger active account is
 * refused. The device is a fake queue — no hardware or transport.
 */
import { describe, expect, test } from "bun:test";
import { ec } from "starknet";
import type { LedgerSignQueue } from "../../src/background/ledger-sign-queue";
import type { LedgerSignRequest } from "../../src/background/ledger-signer";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "../../src/starknet/networks";
import { STRK20_MAINNET_POOL } from "../../src/starknet/strk20/config";
import { defaultWalletPreferences } from "../../src/storage/preferences-store";
import type { AccountRef, LedgerAccountRef, Vault } from "../../src/storage/vault-schema";

const { starkCurve } = ec;
const vaultPassphrase = "correct horse battery staple";
// A real key, so the device's (r, s) actually verifies against the account's
// stored publicKeyX — the ceremony inherits that verify-before-use gate.
const DEVICE_KEY = "0x1234567890abcdef";
const publicKeyX = starkCurve.getStarkKey(DEVICE_KEY);

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

const softwareAccount = {
  address: "0xdef222222",
  classHash: "0x111111",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0xdef222222",
  networkId: "SN_MAIN",
  publicKeyX,
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
} as unknown as AccountRef;

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const dappSender: RuntimeSender = { id: "extension-id", url: "https://dapp.example/app" };

// Records every device request so the prompt's intent can be asserted, and signs
// the handed hash with `privateKey` so the verify gate can be exercised both ways.
const recordingQueue = (seen: LedgerSignRequest[], privateKey = DEVICE_KEY): LedgerSignQueue => ({
  pending: () => [],
  reject: () => false,
  rejectAll: () => 0,
  settle: () => false,
  async request(request) {
    seen.push(request as LedgerSignRequest);
    const sig = starkCurve.sign(request.messageHash, privateKey);
    return { r: `0x${sig.r.toString(16)}`, s: `0x${sig.s.toString(16)}` };
  },
});

type DeriveInput = {
  readonly accountId: string;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly sign: (messageHash: string) => Promise<{ r: string; s: string }>;
};

const harness = (options: { readonly account?: AccountRef; readonly deviceKey?: string } = {}) => {
  const account = options.account ?? ledgerAccount;
  const seen: LedgerSignRequest[] = [];
  const derived: DeriveInput[] = [];
  const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const preferences = { ...defaultWalletPreferences(), activeNetworkId: "SN_MAIN" as const };
  const walletStub = {
    // The real service folds and stores; here it records its input and drives the
    // injected signer so the device round-trip is observable.
    async deriveLedgerStrk20ViewingKey(input: DeriveInput) {
      derived.push(input);
      await input.sign("0x5aa");
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
  const handler = createMessageHandler(walletStub as never, "extension-id", {
    ledgerSignQueue: recordingQueue(seen, options.deviceKey ?? DEVICE_KEY),
    preferencesStore: {
      async read() {
        return preferences;
      },
      async write() {
        return preferences;
      },
    } as never,
    session,
  });
  return { derived, handler, seen };
};

describe("wallet.strk20DeriveLedgerViewingKey", () => {
  test("derives the scope from wallet state, not from the message", async () => {
    const { derived, handler } = harness();

    const response = await handler(
      { type: "wallet.strk20DeriveLedgerViewingKey" },
      extensionSender,
    );

    expect(response).toEqual({ ok: true });
    expect(derived).toHaveLength(1);
    expect(derived[0]?.accountId).toBe(ledgerAccount.id);
    expect(derived[0]?.chainId).toBe(STARKNET_NETWORKS.SN_MAIN.chainId);
    // The configured pool is stored in padded form; the ceremony must receive it
    // canonicalized, since a padded scope would hash to a different key.
    expect(sameFelt(derived[0]?.poolAddress ?? "", STRK20_MAINNET_POOL)).toBe(true);
    expect(derived[0]?.poolAddress).toBe(canonicalFelt(STRK20_MAINNET_POOL) ?? "");
  });

  test("ignores a caller-supplied scope rather than binding a key to it", async () => {
    const { derived, handler } = harness();

    // A message carrying its own pool must not steer the ceremony: a key bound to
    // the wrong pool cannot be changed once registered.
    const response = await handler(
      {
        chainId: "0x534e5f5345504f4c4941",
        poolAddress: "0xdeadbeef",
        type: "wallet.strk20DeriveLedgerViewingKey",
      },
      extensionSender,
    );

    // The strict type-only validator rejects the extra keys outright.
    expect(response).toEqual({ error: "invalid derive ledger viewing key request" });
    expect(derived).toHaveLength(0);
  });

  test("labels the device prompt with the viewing-key intent", async () => {
    const { handler, seen } = harness();

    await handler({ type: "wallet.strk20DeriveLedgerViewingKey" }, extensionSender);

    expect(seen).toHaveLength(1);
    // Blind signing shows only a hash, so this label is the user's sole statement
    // of purpose — it must not read as a transaction.
    expect(seen[0]?.intent).toBe("strk20-viewing-key");
    expect(seen[0]?.accountId).toBe(ledgerAccount.id);
    expect(seen[0]?.path).toBe(ledgerAccount.derivation.path);
  });

  test("refuses a dapp origin", async () => {
    const { derived, handler } = harness();

    const response = await handler({ type: "wallet.strk20DeriveLedgerViewingKey" }, dappSender);

    expect(response).not.toEqual({ ok: true });
    expect(derived).toHaveLength(0);
  });

  test("fails closed when the device signs with the wrong key", async () => {
    // The ceremony inherits the verify-against-publicKeyX gate, so an unverifiable
    // device signature never reaches the fold and nothing is retained.
    const { handler } = harness({ deviceKey: "0xdeadbeef" });

    const response = await handler(
      { type: "wallet.strk20DeriveLedgerViewingKey" },
      extensionSender,
    );

    expect(response).toEqual({ error: "Ledger signature verification failed" });
  });

  test("refuses a software active account", async () => {
    const { derived, handler } = harness({ account: softwareAccount });

    const response = await handler(
      { type: "wallet.strk20DeriveLedgerViewingKey" },
      extensionSender,
    );

    expect(response).toEqual({ error: "active account is not a Ledger account" });
    expect(derived).toHaveLength(0);
  });
});
