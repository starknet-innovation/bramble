/**
 * The five QSB account messages at the background router: extension pages
 * only (a content script reaches none of them); strict input parsing that
 * refuses a malformed request before the wallet is touched; the session's
 * password for listing (peeked, never renewed), creating, importing and
 * confirming (renewed); the message's own password for the reveal, locked or
 * not; and the wallet's QSB refusals passed through as their diagnostics.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import type { QsbAccountService } from "@bramble/vault/service-types";
import { QSB_ACCOUNT_REFUSALS, type QsbAccountView } from "@bramble/wallet-model/qsb";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import {
  DAPP_MESSAGES,
  isPrivilegedMessage,
} from "../../../apps/extension/src/background/routing/senders";
import {
  createUnlockSession,
  type UnlockSession,
} from "../../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const QSB_PHRASE = `${"abandon ".repeat(23)}art`;
const REVEAL_PASSPHRASE = "the password typed into the reveal";
const view: QsbAccountView = {
  backupConfirmed: false,
  id: "qsb-1",
  journal: "bound",
  provenance: "generated-here",
  writer: false,
};
const WORDS = [
  { index: 0, word: "abandon" },
  { index: 11, word: "abandon" },
  { index: 23, word: "art" },
];

/** One well-formed request per QSB message type. */
const REQUESTS = {
  confirm: { accountId: "qsb-1", type: "wallet.confirmQsbBackup", words: WORDS },
  create: { type: "wallet.createQsbAccount" },
  import: { mnemonic: QSB_PHRASE, type: "wallet.importQsbAccount" },
  list: { type: "wallet.qsbAccounts" },
  reveal: { accountId: "qsb-1", passphrase: REVEAL_PASSPHRASE, type: "wallet.revealQsbPhrase" },
} as const;

type Call = { readonly input: unknown; readonly method: keyof QsbAccountService };

// The stub wallet plus QSB methods that record every call by method name.
const qsbWallet = (overrides: Partial<QsbAccountService> = {}) => {
  const calls: Call[] = [];
  const record = (method: Call["method"], input: unknown): void => {
    calls.push({ input, method });
  };
  const qsb: QsbAccountService = {
    async confirmQsbBackup(input) {
      record("confirmQsbBackup", input);
      return { ...view, backupConfirmed: true, writer: true };
    },
    async createQsbAccount(input) {
      record("createQsbAccount", input);
      return view;
    },
    async importQsbAccount(input) {
      record("importQsbAccount", input);
      return { ...view, backupConfirmed: true, provenance: "imported" };
    },
    async qsbAccounts(input) {
      record("qsbAccounts", input);
      return [view];
    },
    async revealQsbPhrase(input) {
      record("revealQsbPhrase", input);
      return QSB_PHRASE;
    },
    ...overrides,
  };
  return { calls, wallet: { ...createWallet(), ...qsb } };
};

// A session that counts renewing reads, so a suite can tell peek from renew.
const countingSession = (unlocked: boolean) => {
  const session = createUnlockSession();
  if (unlocked) session.unlock(vaultPassphrase);
  const renewals = { count: 0 };
  const counted: UnlockSession = {
    ...session,
    getPassphrase: () => {
      renewals.count += 1;
      return session.getPassphrase();
    },
  };
  return { renewals, session: counted };
};

const routed = (wallet: ReturnType<typeof qsbWallet>["wallet"], unlocked = true) => {
  const { renewals, session } = countingSession(unlocked);
  return { handler: createMessageHandler(wallet, testExtension, { session }), renewals, session };
};

describe("QSB account messages", () => {
  test("are extension-page only: a content script reaches none of them", async () => {
    const { calls, wallet } = qsbWallet();
    const { handler } = routed(wallet);
    for (const request of Object.values(REQUESTS)) {
      expect(DAPP_MESSAGES.has(request.type)).toBe(false);
      expect(isPrivilegedMessage(request.type)).toBe(true);
      expect(await handler(request, contentSender)).toEqual({
        error: "privileged sender required",
      });
      expect(await handler(request, { id: "another-extension" })).toEqual({
        error: "untrusted sender",
      });
    }
    expect(calls).toEqual([]);
  });

  test("route each message to the wallet by key, under the right password", async () => {
    const { calls, wallet } = qsbWallet();
    const { handler, renewals } = routed(wallet);

    expect(await handler(REQUESTS.list, extensionSender)).toEqual({ accounts: [view], ok: true });
    // Listing peeks at the session; it never extends the unlock.
    expect(renewals.count).toBe(0);
    expect(await handler(REQUESTS.create, extensionSender)).toEqual({ account: view, ok: true });
    expect(await handler(REQUESTS.import, extensionSender)).toEqual({
      account: { ...view, backupConfirmed: true, provenance: "imported" },
      ok: true,
    });
    expect(await handler(REQUESTS.confirm, extensionSender)).toEqual({
      account: { ...view, backupConfirmed: true, writer: true },
      ok: true,
    });
    expect(renewals.count).toBe(3);
    expect(await handler(REQUESTS.reveal, extensionSender)).toEqual({
      mnemonic: QSB_PHRASE,
      ok: true,
    });
    expect(renewals.count).toBe(3);
    expect(calls).toEqual([
      { input: vaultPassphrase, method: "qsbAccounts" },
      { input: vaultPassphrase, method: "createQsbAccount" },
      { input: { mnemonic: QSB_PHRASE, vaultPassphrase }, method: "importQsbAccount" },
      { input: { accountId: "qsb-1", vaultPassphrase, words: WORDS }, method: "confirmQsbBackup" },
      // The reveal's password is the one in the message, not the session's.
      {
        input: { accountId: "qsb-1", vaultPassphrase: REVEAL_PASSPHRASE },
        method: "revealQsbPhrase",
      },
    ]);
  });

  test("locked, only the reveal answers, and it needs no unlock", async () => {
    const { calls, wallet } = qsbWallet();
    const { handler } = routed(wallet, false);
    for (const request of [REQUESTS.list, REQUESTS.create, REQUESTS.import, REQUESTS.confirm]) {
      expect(await handler(request, extensionSender)).toEqual({ error: "wallet locked" });
    }
    expect(calls).toEqual([]);
    expect(await handler(REQUESTS.reveal, extensionSender)).toEqual({
      mnemonic: QSB_PHRASE,
      ok: true,
    });
  });

  test("a lock that lands during the listing answers as a locked wallet", async () => {
    let session: UnlockSession | null = null;
    const { wallet } = qsbWallet({
      async qsbAccounts() {
        session?.lock();
        return [view];
      },
    });
    const wired = routed(wallet);
    session = wired.session;
    expect(await wired.handler(REQUESTS.list, extensionSender)).toEqual({
      error: "wallet locked",
    });
  });

  test("a wallet surface without the QSB methods answers unavailable", async () => {
    const { handler } = routed({ ...createWallet() } as ReturnType<typeof qsbWallet>["wallet"]);
    for (const request of Object.values(REQUESTS)) {
      expect(await handler(request, extensionSender)).toEqual({ error: "wallet unavailable" });
    }
  });

  test("the wallet's QSB refusals reach the page as their shared diagnostics", async () => {
    const refusing = (refusal: string) => async (): Promise<never> => {
      throw new WalletError(refusal);
    };
    const { wallet } = qsbWallet({
      confirmQsbBackup: refusing(QSB_ACCOUNT_REFUSALS.backupMismatch),
      createQsbAccount: refusing(QSB_ACCOUNT_REFUSALS.accountLimit),
      importQsbAccount: refusing(QSB_ACCOUNT_REFUSALS.notDedicated),
      revealQsbPhrase: refusing(QSB_ACCOUNT_REFUSALS.unknownAccount),
    });
    const { handler } = routed(wallet);
    expect(await handler(REQUESTS.create, extensionSender)).toEqual({
      error: QSB_ACCOUNT_REFUSALS.accountLimit,
    });
    expect(await handler(REQUESTS.import, extensionSender)).toEqual({
      error: QSB_ACCOUNT_REFUSALS.notDedicated,
    });
    expect(await handler(REQUESTS.confirm, extensionSender)).toEqual({
      error: QSB_ACCOUNT_REFUSALS.backupMismatch,
    });
    expect(await handler(REQUESTS.reveal, extensionSender)).toEqual({
      error: QSB_ACCOUNT_REFUSALS.unknownAccount,
    });
  });
});

// A request whose `key` is an accessor: never read by a validator.
const withAccessor = (request: Record<string, unknown>, key: string): Record<string, unknown> => {
  const copy = { ...request };
  delete copy[key];
  Object.defineProperty(copy, key, { enumerable: true, get: () => request[key] });
  return copy;
};

const holeyWords = (): unknown[] => {
  const words = new Array<unknown>(3);
  words[0] = WORDS[0];
  words[2] = WORDS[2];
  return words;
};

const MALFORMED: readonly (readonly [string, Record<string, unknown>])[] = [
  ["invalid qsb accounts request", { ...REQUESTS.list, extra: true }],
  ["invalid create qsb account request", { ...REQUESTS.create, mnemonic: QSB_PHRASE }],
  ["invalid import qsb account request", { type: "wallet.importQsbAccount" }],
  ["invalid import qsb account request", { ...REQUESTS.import, mnemonic: 24 }],
  ["invalid import qsb account request", { ...REQUESTS.import, mnemonic: "a ".repeat(257) }],
  ["invalid import qsb account request", { ...REQUESTS.import, vaultPassphrase }],
  ["invalid import qsb account request", withAccessor(REQUESTS.import, "mnemonic")],
  ["invalid reveal qsb phrase request", { ...REQUESTS.reveal, passphrase: "short" }],
  ["invalid reveal qsb phrase request", { ...REQUESTS.reveal, accountId: "SN_MAIN:0x1" }],
  ["invalid reveal qsb phrase request", { ...REQUESTS.reveal, accountId: "qsb-0" }],
  ["invalid reveal qsb phrase request", { accountId: "qsb-1", type: "wallet.revealQsbPhrase" }],
  ["invalid reveal qsb phrase request", { ...REQUESTS.reveal, vaultPassphrase }],
  ["invalid reveal qsb phrase request", withAccessor(REQUESTS.reveal, "passphrase")],
  ["invalid confirm qsb backup request", { ...REQUESTS.confirm, words: WORDS.slice(0, 2) }],
  ["invalid confirm qsb backup request", { ...REQUESTS.confirm, words: [...WORDS, WORDS[0]] }],
  [
    "invalid confirm qsb backup request",
    { ...REQUESTS.confirm, words: [WORDS[0], WORDS[0], WORDS[2]] },
  ],
  [
    "invalid confirm qsb backup request",
    { ...REQUESTS.confirm, words: [WORDS[0], WORDS[1], { index: 24, word: "art" }] },
  ],
  [
    "invalid confirm qsb backup request",
    { ...REQUESTS.confirm, words: [WORDS[0], WORDS[1], { index: 2.5, word: "art" }] },
  ],
  [
    "invalid confirm qsb backup request",
    { ...REQUESTS.confirm, words: [WORDS[0], WORDS[1], { index: 23, word: "x".repeat(33) }] },
  ],
  [
    "invalid confirm qsb backup request",
    { ...REQUESTS.confirm, words: [WORDS[0], WORDS[1], { ...WORDS[2], extra: 1 }] },
  ],
  ["invalid confirm qsb backup request", { ...REQUESTS.confirm, words: holeyWords() }],
  ["invalid confirm qsb backup request", { ...REQUESTS.confirm, accountId: "qsb-01" }],
  ["invalid confirm qsb backup request", { ...REQUESTS.confirm, vaultPassphrase }],
];

describe("QSB account message parsing", () => {
  test("refuses every malformed request before the wallet is touched", async () => {
    const { calls, wallet } = qsbWallet();
    const { handler } = routed(wallet);
    for (const [error, request] of MALFORMED) {
      expect(await handler(request, extensionSender)).toEqual({ error });
    }
    expect(calls).toEqual([]);
  });

  test("passes a phrase through unjudged, for the vault service to check", async () => {
    const { calls, wallet } = qsbWallet();
    const { handler } = routed(wallet);
    const typed = `  ${QSB_PHRASE.toUpperCase()}  `;
    await handler({ mnemonic: typed, type: "wallet.importQsbAccount" }, extensionSender);
    expect(calls).toEqual([
      { input: { mnemonic: typed, vaultPassphrase }, method: "importQsbAccount" },
    ]);
  });
});
