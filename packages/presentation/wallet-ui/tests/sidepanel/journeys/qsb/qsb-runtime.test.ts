/**
 * The QSB client against stubbed background replies: each of
 * the five messages is sent with exactly the contract's fields, every reply is
 * validated strictly (keys, ids, enums, the writer rule, the 24-word phrase),
 * and a refusal or a lost reply rejects the way the panel can tell apart.
 */
import { describe, expect, test } from "bun:test";
import { QSB_ACCOUNT_REFUSALS, type QsbAccountView } from "@bramble/wallet-model/qsb";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import {
  createQsbRuntimeClient,
  isQsbAccountId,
  isQsbAccountView,
  readQsbAccounts,
  readQsbPhrase,
} from "../../../../src/sidepanel/journeys/qsb/qsb-runtime";
import { createSidepanelRuntime } from "../../../../src/sidepanel/runtime/runtime";
import { READ_ONLY_MESSAGES } from "../../../../src/sidepanel/runtime/runtime-errors";

// The all-zero-entropy BIP39 test vector: public, never a real phrase.
const PHRASE = `${"abandon ".repeat(23)}art`;

const generated: QsbAccountView = {
  backupConfirmed: false,
  id: "qsb-1",
  journal: "bound",
  provenance: "generated-here",
  writer: false,
};
const ready: QsbAccountView = { ...generated, backupConfirmed: true, id: "qsb-2", writer: true };
const imported: QsbAccountView = {
  backupConfirmed: true,
  id: "qsb-3",
  journal: "bound",
  provenance: "imported",
  writer: false,
};

const answering = (reply: unknown) => {
  const sent: unknown[] = [];
  const client = createQsbRuntimeClient(async (message) => {
    sent.push(message);
    return reply;
  });
  return { client, sent };
};

const rejection = async (run: () => Promise<unknown>): Promise<Error> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected a rejection");
};

describe("QSB account ids", () => {
  test("accepts qsb-1 to qsb-9999 only", () => {
    for (const id of ["qsb-1", "qsb-42", "qsb-9999"]) expect(isQsbAccountId(id)).toBe(true);
    for (const id of ["qsb-0", "qsb-01", "qsb-10000", "qsb-", "QSB-1", "qsb-1 ", "acct-1", 1]) {
      expect(isQsbAccountId(id)).toBe(false);
    }
  });
});

describe("QSB account views", () => {
  test("accepts the three shapes the contract allows", () => {
    expect(isQsbAccountView(generated)).toBe(true);
    expect(isQsbAccountView(ready)).toBe(true);
    expect(isQsbAccountView(imported)).toBe(true);
    expect(isQsbAccountView({ ...ready, journal: "unavailable", writer: false })).toBe(true);
    expect(isQsbAccountView({ ...imported, journal: "unavailable" })).toBe(true);
  });

  test("refuses unknown or missing keys, wrong types, and unknown enums", () => {
    expect(isQsbAccountView({ ...generated, phrase: PHRASE })).toBe(false);
    expect(isQsbAccountView({ ...generated, journalId: "j" })).toBe(false);
    const { writer: _writer, ...missing } = generated;
    expect(isQsbAccountView(missing)).toBe(false);
    expect(isQsbAccountView({ ...generated, backupConfirmed: "false" })).toBe(false);
    expect(isQsbAccountView({ ...generated, journal: "missing" })).toBe(false);
    expect(isQsbAccountView({ ...generated, provenance: "restored" })).toBe(false);
    expect(isQsbAccountView({ ...generated, id: "qsb-0" })).toBe(false);
    expect(isQsbAccountView([generated])).toBe(false);
    expect(isQsbAccountView(null)).toBe(false);
  });

  test("refuses a view that breaks the writer rule", () => {
    // Writer only when generated here, backed up, and bound.
    expect(isQsbAccountView({ ...generated, writer: true })).toBe(false);
    expect(isQsbAccountView({ ...ready, journal: "unavailable" })).toBe(false);
    expect(isQsbAccountView({ ...ready, writer: false })).toBe(false);
    expect(isQsbAccountView({ ...imported, writer: true })).toBe(false);
    // An imported phrase is backed up by definition.
    expect(isQsbAccountView({ ...imported, backupConfirmed: false })).toBe(false);
  });

  test("a list is read whole or not at all, with distinct ids", () => {
    expect(readQsbAccounts({ accounts: [generated, ready], ok: true })).toEqual([generated, ready]);
    expect(readQsbAccounts({ accounts: [], ok: true })).toEqual([]);
    expect(readQsbAccounts({ accounts: [generated, { ...ready, writer: false }], ok: true })).toBe(
      null,
    );
    expect(readQsbAccounts({ accounts: [generated, generated], ok: true })).toBe(null);
    expect(readQsbAccounts({ accounts: [generated], extra: 1, ok: true })).toBe(null);
    expect(readQsbAccounts({ accounts: [generated] })).toBe(null);
    expect(readQsbAccounts({ accounts: {}, ok: true })).toBe(null);
  });
});

describe("the revealed phrase", () => {
  test("must be exactly 24 lowercase words joined by single spaces", () => {
    expect(readQsbPhrase({ mnemonic: PHRASE, ok: true })).toBe(PHRASE);
    const words = PHRASE.split(" ");
    for (const mnemonic of [
      words.slice(0, 23).join(" "),
      `${PHRASE} art`,
      words.slice(0, 12).join(" "),
      PHRASE.replace("art", "Art"),
      PHRASE.replace(" ", "  "),
      ` ${PHRASE}`,
      `${PHRASE}\n`,
      PHRASE.replace("art", "art1"),
      PHRASE.replaceAll(" ", "\t"),
    ]) {
      expect(readQsbPhrase({ mnemonic, ok: true })).toBe(null);
    }
    expect(readQsbPhrase({ mnemonic: PHRASE, ok: true, privateKey: "0x1" })).toBe(null);
    expect(readQsbPhrase({ mnemonic: PHRASE })).toBe(null);
    expect(readQsbPhrase({ mnemonic: words, ok: true })).toBe(null);
  });
});

describe("createQsbRuntimeClient", () => {
  test("sends each message with exactly its contract fields", async () => {
    const list = answering({ accounts: [generated], ok: true });
    expect(await list.client.loadQsbAccounts()).toEqual([generated]);
    expect(list.sent).toEqual([{ type: "wallet.qsbAccounts" }]);

    const created = answering({ account: generated, ok: true });
    expect(await created.client.createQsbAccount()).toEqual(generated);
    expect(created.sent).toEqual([{ type: "wallet.createQsbAccount" }]);

    const added = answering({ account: imported, ok: true });
    expect(await added.client.importQsbAccount(PHRASE)).toEqual(imported);
    expect(added.sent).toEqual([{ mnemonic: PHRASE, type: "wallet.importQsbAccount" }]);

    const revealed = answering({ mnemonic: PHRASE, ok: true });
    expect(await revealed.client.revealQsbPhrase("qsb-1", "correct horse")).toBe(PHRASE);
    expect(revealed.sent).toEqual([
      { accountId: "qsb-1", passphrase: "correct horse", type: "wallet.revealQsbPhrase" },
    ]);

    const confirmed = answering({ account: { ...generated, backupConfirmed: true, writer: true } });
    const words = [
      { index: 2, word: "abandon" },
      { index: 12, word: "abandon" },
      { index: 23, word: "art" },
    ];
    await rejection(() => confirmed.client.confirmQsbBackup("qsb-1", words));
    const backedUp = answering({
      account: { ...generated, backupConfirmed: true, writer: true },
      ok: true,
    });
    expect((await backedUp.client.confirmQsbBackup("qsb-1", words)).backupConfirmed).toBe(true);
    expect(backedUp.sent).toEqual([{ accountId: "qsb-1", type: "wallet.confirmQsbBackup", words }]);
  });

  test("each write's reply must be the account the write describes", async () => {
    // A create answers a new, unbacked, generated account.
    const createdReady = answering({ account: ready, ok: true });
    expect((await rejection(() => createdReady.client.createQsbAccount())).message).toBe(
      "wallet request failed",
    );
    const createdImport = answering({ account: imported, ok: true });
    await rejection(() => createdImport.client.createQsbAccount());
    // An import answers an imported account.
    const importedGenerated = answering({ account: generated, ok: true });
    await rejection(() => importedGenerated.client.importQsbAccount(PHRASE));
    // A confirmation answers the same account, now backed up.
    const otherAccount = answering({ account: ready, ok: true });
    await rejection(() => otherAccount.client.confirmQsbBackup("qsb-1", []));
    const stillUnbacked = answering({ account: generated, ok: true });
    await rejection(() => stillUnbacked.client.confirmQsbBackup("qsb-1", []));
  });

  test("a refusal rejects with the background's diagnostic", async () => {
    for (const [run, refusal] of [
      [
        (c: ReturnType<typeof createQsbRuntimeClient>) => c.createQsbAccount(),
        QSB_ACCOUNT_REFUSALS.accountLimit,
      ],
      [
        (c: ReturnType<typeof createQsbRuntimeClient>) => c.importQsbAccount(PHRASE),
        QSB_ACCOUNT_REFUSALS.notDedicated,
      ],
      [
        (c: ReturnType<typeof createQsbRuntimeClient>) => c.confirmQsbBackup("qsb-1", []),
        QSB_ACCOUNT_REFUSALS.backupMismatch,
      ],
      [
        (c: ReturnType<typeof createQsbRuntimeClient>) => c.revealQsbPhrase("qsb-9", "pass"),
        QSB_ACCOUNT_REFUSALS.unknownAccount,
      ],
      [
        (c: ReturnType<typeof createQsbRuntimeClient>) => c.loadQsbAccounts(),
        QSB_ACCOUNT_REFUSALS.journalUnavailable,
      ],
    ] as const) {
      const { client } = answering({ error: refusal });
      expect((await rejection(() => run(client))).message).toBe(refusal);
    }
  });

  test("an unrecognised reply falls back to a reviewed read or unknown-outcome code", async () => {
    const odd = answering({ ok: true, surprise: 1 });
    expect((await rejection(() => odd.client.loadQsbAccounts())).message).toBe(
      "wallet unavailable",
    );
    expect((await rejection(() => odd.client.revealQsbPhrase("qsb-1", "pass"))).message).toBe(
      "reveal failed",
    );
    expect((await rejection(() => odd.client.importQsbAccount(PHRASE))).message).toBe(
      "wallet request failed",
    );
  });
});

describe("lost replies", () => {
  const lost = {
    sendMessage: () => Promise.reject(new Error("The message port closed before a response.")),
  };

  test("the list and the reveal are reads: a lost reply passes through", async () => {
    expect(READ_ONLY_MESSAGES.has("wallet.qsbAccounts")).toBe(true);
    expect(READ_ONLY_MESSAGES.has("wallet.revealQsbPhrase")).toBe(true);
    const wallet = createSidepanelRuntime(lost);
    expect(await rejection(() => wallet.loadQsbAccounts())).not.toBeInstanceOf(
      SubmissionUnknownError,
    );
    expect(await rejection(() => wallet.revealQsbPhrase("qsb-1", "pass"))).not.toBeInstanceOf(
      SubmissionUnknownError,
    );
  });

  test("create, import, and confirm are writes: a lost reply is outcome-unknown", async () => {
    for (const type of [
      "wallet.createQsbAccount",
      "wallet.importQsbAccount",
      "wallet.confirmQsbBackup",
    ]) {
      expect(READ_ONLY_MESSAGES.has(type)).toBe(false);
    }
    const wallet = createSidepanelRuntime(lost);
    expect(await rejection(() => wallet.createQsbAccount())).toBeInstanceOf(SubmissionUnknownError);
    expect(await rejection(() => wallet.importQsbAccount(PHRASE))).toBeInstanceOf(
      SubmissionUnknownError,
    );
    expect(await rejection(() => wallet.confirmQsbBackup("qsb-1", []))).toBeInstanceOf(
      SubmissionUnknownError,
    );
  });
});
