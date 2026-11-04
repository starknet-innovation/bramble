/**
 * The QSB account journey end to end: the background router over the real
 * wallet reader and vault service, with journals in their own encrypted keys
 * as the background root wires them. Create, list, reveal, confirm, and
 * import, including the refusals a page sees, and the reveal's wrong-password
 * diagnostic, which must be exactly the Starknet reveal's.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { FAKE_GENERATED_MNEMONIC_24, fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createQsbJournalStores } from "@bramble/vault/qsb-journal-stores";
import { emptyVault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { createWalletReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { extensionSender, testExtension } from "../../support/background-wallet-stub";

const PASSPHRASE = "correct horse battery staple";
// The wallet's founding Starknet phrase: 24 words, so it has a QSB shape too.
const STARKNET_PHRASE =
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless";
const IMPORTED_PHRASE = `${"abandon ".repeat(23)}art`;

const journalId = (label: string): string =>
  createHash("sha256").update(`qsb journey ${label}`).digest("hex");

const journey = async () => {
  const backend = createMemoryStore();
  await createEncryptedStore(backend, "bramble:vault").write(
    { ...emptyVault(), mnemonic: STARKNET_PHRASE },
    PASSPHRASE,
  );
  const ids = [journalId("created"), journalId("imported")];
  const service = createWalletVaultService({
    encryptedStore: createEncryptedStore(backend, "bramble:vault"),
    kms: fakeKms(),
    migrationStore: createEncryptedStore(backend, "bramble:vault-migration"),
    qsb: {
      drawJournalId: () => ids.shift() ?? journalId("spare"),
      journals: createQsbJournalStores((key) => createEncryptedStore(backend, key)),
    },
  });
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  const handler = createMessageHandler(
    createWalletReader(Promise.resolve(service)),
    testExtension,
    {
      preferencesStore: {
        ...unavailablePreferencesStore,
        read: async () => defaultWalletPreferences(),
      },
      session,
    },
  );
  return (message: Record<string, unknown>) => handler(message, extensionSender);
};

const generated = {
  backupConfirmed: false,
  id: "qsb-1",
  journal: "bound",
  provenance: "generated-here",
  writer: false,
} as const;

describe("the QSB account journey", () => {
  test("create, back up, confirm, and import, through the real vault service", async () => {
    const send = await journey();

    expect(await send({ type: "wallet.createQsbAccount" })).toEqual({
      account: generated,
      ok: true,
    });
    expect(await send({ type: "wallet.qsbAccounts" })).toEqual({ accounts: [generated], ok: true });

    const revealed = await send({
      accountId: "qsb-1",
      passphrase: PASSPHRASE,
      type: "wallet.revealQsbPhrase",
    });
    expect(revealed).toEqual({ mnemonic: FAKE_GENERATED_MNEMONIC_24, ok: true });
    const words = FAKE_GENERATED_MNEMONIC_24.split(" ");
    const retyped = [3, 8, 21].map((index) => ({ index, word: words[index] ?? "" }));

    expect(
      await send({
        accountId: "qsb-1",
        type: "wallet.confirmQsbBackup",
        words: retyped.map((entry) => ({ ...entry, word: "zoo" })),
      }),
    ).toEqual({ error: QSB_ACCOUNT_REFUSALS.backupMismatch });
    const writer = { ...generated, backupConfirmed: true, writer: true };
    expect(
      await send({ accountId: "qsb-1", type: "wallet.confirmQsbBackup", words: retyped }),
    ).toEqual({ account: writer, ok: true });

    expect(await send({ mnemonic: IMPORTED_PHRASE, type: "wallet.importQsbAccount" })).toEqual({
      account: {
        backupConfirmed: true,
        id: "qsb-2",
        journal: "bound",
        provenance: "imported",
        writer: false,
      },
      ok: true,
    });
    expect(await send({ type: "wallet.qsbAccounts" })).toEqual({
      accounts: [
        writer,
        {
          backupConfirmed: true,
          id: "qsb-2",
          journal: "bound",
          provenance: "imported",
          writer: false,
        },
      ],
      ok: true,
    });
  });

  test("refuses a duplicate, a Starknet phrase, an invalid phrase, and an unknown account", async () => {
    const send = await journey();
    await send({ mnemonic: IMPORTED_PHRASE, type: "wallet.importQsbAccount" });

    expect(
      await send({ mnemonic: IMPORTED_PHRASE.toUpperCase(), type: "wallet.importQsbAccount" }),
    ).toEqual({ error: QSB_ACCOUNT_REFUSALS.duplicatePhrase });
    expect(await send({ mnemonic: STARKNET_PHRASE, type: "wallet.importQsbAccount" })).toEqual({
      error: QSB_ACCOUNT_REFUSALS.notDedicated,
    });
    expect(
      await send({ mnemonic: IMPORTED_PHRASE.slice(0, -4), type: "wallet.importQsbAccount" }),
    ).toEqual({ error: QSB_ACCOUNT_REFUSALS.invalidPhrase });
    expect(
      await send({ accountId: "qsb-5", passphrase: PASSPHRASE, type: "wallet.revealQsbPhrase" }),
    ).toEqual({ error: QSB_ACCOUNT_REFUSALS.unknownAccount });
  });

  test("a wrong reveal password answers exactly as the Starknet reveal does", async () => {
    const send = await journey();
    await send({ type: "wallet.createQsbAccount" });
    const wrong = "not the wallet password";
    const starknet = await send({ type: "wallet.revealSecrets", vaultPassphrase: wrong });
    expect(starknet).toHaveProperty("error");
    expect(
      await send({ accountId: "qsb-1", passphrase: wrong, type: "wallet.revealQsbPhrase" }),
    ).toEqual(starknet);
  });
});
