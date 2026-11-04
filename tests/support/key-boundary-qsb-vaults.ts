/**
 * The key-boundary scan's QSB vault collaborators: a real vault service over
 * the stub vault's own salted QSB account (its phrase, its journal id, the
 * scan's vault password), the real Krusty adapter, the stand-in coordinator
 * and runtime, all fresh per harness.
 *
 * Real on purpose. The deposit entries only reach the code that holds the
 * owner's private key, the journal and the coordinator token if Krusty
 * really signs and the coordinator really answers, so every vault reply the
 * scan reads is one a leak would have reached. {@link SECRET_QSB_OWNER_KEY}
 * is that owner key, which no reply may carry.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { createQsbCoordinator } from "@bramble/qsb/client";
import { createQsbSessions } from "@bramble/qsb/sessions";
import { createMemoryStore } from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createQsbJournalStores } from "@bramble/vault/qsb-journal-stores";
import { emptyVault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import type { WalletVaultService } from "@bramble/vault/service-types";
import { createQsbAccountLocks } from "../../apps/extension/src/background/qsb/qsb-vault-locks";
import type { QsbVaultDeps } from "../../apps/extension/src/background/qsb/qsb-vault-session";
import {
  extensionSender,
  qsbAccount,
  SECRET_MNEMONIC,
  SECRET_PASSPHRASE,
  SECRET_QSB_MNEMONIC,
} from "./key-boundary-fixtures";
import {
  type FakeCoordinatorState,
  fakeCoordinatorState,
  fakeQsbFetch,
  fakeQsbRuntime,
  paymentToAddress,
} from "./qsb-coordinator-fake";

const krusty = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const owner = await krusty.deriveBitcoinP2wpkhKeypair(SECRET_QSB_MNEMONIC, 0, 0, 0);

/** The stub QSB account's owner private key: no reply may ever carry it. */
export const SECRET_QSB_OWNER_KEY = owner.privateKey;

/** The vault the deposit entries create, quote, fund and resend: the account's first. */
export const KEY_BOUNDARY_QSB_VAULT = 0;

const QSB_VAULT_MESSAGES: ReadonlySet<unknown> = new Set([
  "wallet.createQsbVault",
  "wallet.depositQsbVault",
  "wallet.qsbVaults",
  "wallet.quoteQsbDeposit",
  "wallet.resendQsbDeposit",
]);

/** Whether `message` is one of the five QSB vault requests. */
export const isQsbVaultMessage = (message: Record<string, unknown>): boolean =>
  QSB_VAULT_MESSAGES.has(message["type"]);

/** The amount the catalog's quote and deposit entries name, in satoshis. */
export const KEY_BOUNDARY_QSB_AMOUNT = 50_000;

/** The fee the coordinator quotes now for the catalog's deposit, through `handler`. */
export const qsbDepositFee = async (
  handler: (message: unknown, sender: typeof extensionSender) => Promise<unknown>,
): Promise<number> => {
  const reply = (await handler(
    {
      accountId: qsbAccount.id,
      amountSat: KEY_BOUNDARY_QSB_AMOUNT,
      type: "wallet.quoteQsbDeposit",
      v: KEY_BOUNDARY_QSB_VAULT,
    },
    extensionSender,
  )) as { readonly quote?: { readonly feeSat?: number } };
  const fee = reply.quote?.feeSat;
  if (typeof fee !== "number") throw new Error("the key-boundary QSB quote did not answer");
  return fee;
};

/** What a harness wires: the deps, the session method, and the coordinator's state. */
export type KeyBoundaryQsbVaults = {
  readonly deps: QsbVaultDeps;
  readonly state: FakeCoordinatorState;
  readonly withQsbVaultAccount: WalletVaultService["withQsbVaultAccount"];
};

/** Builds a fresh, funded QSB vault world over the stub account. */
export const keyBoundaryQsbVaults = async (): Promise<KeyBoundaryQsbVaults> => {
  const backend = createMemoryStore();
  await createEncryptedStore(backend, "bramble:vault").write(
    { ...emptyVault(), mnemonic: SECRET_MNEMONIC },
    SECRET_PASSPHRASE,
  );
  const service = createWalletVaultService({
    encryptedStore: createEncryptedStore(backend, "bramble:vault"),
    kms: { ...krusty, generateMnemonic: async () => SECRET_QSB_MNEMONIC },
    migrationStore: createEncryptedStore(backend, "bramble:vault-migration"),
    qsb: {
      drawJournalId: () => qsbAccount.journalId,
      journals: createQsbJournalStores((key) => createEncryptedStore(backend, key)),
    },
  });
  await service.createQsbAccount(SECRET_PASSPHRASE);
  const words = SECRET_QSB_MNEMONIC.split(" ");
  await service.confirmQsbBackup({
    accountId: qsbAccount.id,
    vaultPassphrase: SECRET_PASSPHRASE,
    words: [0, 11, 23].map((index) => ({ index, word: words[index] ?? "" })),
  });
  const state = fakeCoordinatorState(
    owner.address,
    paymentToAddress(owner.address, [500_000], "key boundary"),
  );
  const now = (): number => Date.now();
  return {
    deps: {
      coordinator: createQsbCoordinator({ fetch: fakeQsbFetch(state, now) }),
      drawVaultId: () => crypto.randomUUID(),
      locks: createQsbAccountLocks(),
      now,
      runtime: fakeQsbRuntime(),
      sessions: createQsbSessions({ now }),
    },
    state,
    withQsbVaultAccount: (input, task) => service.withQsbVaultAccount(input, task),
  };
};
