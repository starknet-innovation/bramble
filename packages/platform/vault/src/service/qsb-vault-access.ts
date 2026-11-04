/**
 * The vault service's QSB vault session: what the background's vault and
 * deposit flows may ask of one QSB account, implemented over the account's
 * journal store, its pending-deposit store and Krusty.
 *
 * Trust boundary: background-only, inside the service's mutation queue (the
 * service wraps the one method in it). The account record, its phrase and the
 * owner's private key never leave this module: the BIP-84 owner key
 * `m/84'/0'/0'/0/0` is derived through Krusty for each use and dropped; the
 * journal crosses as its vault records only; journal changes are asked for by
 * name and applied here. Every journal and pending-deposit write is validated
 * and durable before its call resolves, and a lost journal is never
 * recreated. A session refuses every call once its task has settled, so a
 * leaked handle cannot act outside the queue.
 */
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import type { EncryptedStore } from "../encrypted-store";
import type { KmsPort } from "../kms-port";
import type { QsbAccountRecord } from "../qsb/qsb-account";
import {
  type QsbPendingDeposit,
  qsbPendingRecord,
  readQsbPendingDeposits,
} from "../qsb/qsb-deposit-store";
import {
  allocateQsbVault,
  associateQsbScript,
  markQsbVaultUnknown,
  type QsbJournalResult,
  recordQsbFunding,
} from "../qsb/qsb-journal";
import { bindQsbJournal, isQsbWriter, type QsbJournalBinding } from "../qsb/qsb-journal-record";
import { readQsbJournal, writeQsbJournal } from "../qsb/qsb-journal-store";
import type { Vault } from "../schema/schema";
import type { QsbAccountWiring } from "./qsb-account-types";
import type {
  QsbJournalChange,
  QsbJournalChangeResult,
  QsbJournalState,
  QsbVaultAccess,
  QsbVaultAccessService,
} from "./qsb-vault-types";

type QsbVaultDeps = {
  readonly kms: Pick<
    KmsPort,
    | "deriveBitcoinP2wpkhKeypair"
    | "deriveQsbCommitments"
    | "signBip322SimpleUnprefixed"
    | "signBitcoinPsbtInputs"
  >;
  readonly readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>;
  readonly wiring: QsbAccountWiring | undefined;
};

type AccountStores = {
  readonly deposits: EncryptedStore;
  readonly journal: EncryptedStore;
};

type BoundState = Extract<QsbJournalState, { readonly status: "bound" }>;

const refused = (message: string): RefusedBeforeWrite => new RefusedBeforeWrite(message);

const storesOf = (
  wiring: QsbAccountWiring | undefined,
  account: QsbAccountRecord,
): AccountStores => {
  const journal = wiring?.journals.forJournal(account.journalId);
  const deposits = wiring?.journals.forDeposits(account.journalId);
  if (!journal || !deposits) {
    throw refused(QSB_ACCOUNT_REFUSALS.journalUnavailable);
  }
  return { deposits, journal };
};

const transition = (binding: QsbJournalBinding, change: QsbJournalChange): QsbJournalResult => {
  switch (change.kind) {
    case "allocate":
      return allocateQsbVault(binding, change);
    case "associate":
      return associateQsbScript(binding, change);
    case "fund":
      return recordQsbFunding(binding, change);
    case "mark-unknown":
      return markQsbVaultUnknown(binding, change.v);
  }
};

const boundState = (
  binding: Extract<QsbJournalBinding, { readonly status: "bound" }>,
): BoundState => ({
  nextV: binding.journal.nextV,
  status: "bound",
  vaults: binding.journal.vaults,
  writer: isQsbWriter(binding),
});

// The session's view of a binding: no header, no account record.
const stateOf = (binding: QsbJournalBinding): QsbJournalState =>
  binding.status === "bound" ? boundState(binding) : { status: "unavailable" };

// The owner's BIP-84 key: account 0, receiving chain, index 0.
const ownerKey = (deps: QsbVaultDeps, account: QsbAccountRecord) =>
  deps.kms.deriveBitcoinP2wpkhKeypair(account.mnemonic, 0, 0, 0);

const journalMethods = (
  account: QsbAccountRecord,
  store: EncryptedStore,
  vaultPassphrase: string,
): Pick<QsbVaultAccess, "commit" | "journal"> => {
  const read = async (): Promise<QsbJournalBinding> =>
    bindQsbJournal(account, await readQsbJournal(store, vaultPassphrase));
  return {
    async commit(change): Promise<QsbJournalChangeResult> {
      const binding = await read();
      const result = transition(binding, change);
      if (!result.ok) return result;
      const next = boundState({ account, journal: result.journal, status: "bound" });
      if (binding.status === "bound" && result.journal === binding.journal) {
        return { journal: next, ok: true };
      }
      const written = await writeQsbJournal(
        store,
        account,
        result.journal,
        vaultPassphrase,
        "replace",
      );
      if (written.ok) return { journal: next, ok: true };
      return {
        ok: false,
        refusal: written.refusal === "journal-full" ? "journal-full" : "journal-unavailable",
      };
    },
    journal: async () => stateOf(await read()),
  };
};

const depositMethods = (
  account: QsbAccountRecord,
  store: EncryptedStore,
  vaultPassphrase: string,
): Pick<QsbVaultAccess, "holdDeposit" | "pendingDeposits" | "releaseDeposit"> => {
  const held = async (): Promise<readonly QsbPendingDeposit[]> => {
    const read = await readQsbPendingDeposits(store, account, vaultPassphrase);
    if (read.status !== "bound") {
      throw refused(QSB_ACCOUNT_REFUSALS.journalUnavailable);
    }
    return read.deposits;
  };
  const write = async (deposits: readonly QsbPendingDeposit[]): Promise<void> => {
    const record = qsbPendingRecord(account, deposits);
    if (record === null) {
      throw refused(QSB_VAULT_REFUSALS.depositPending);
    }
    await store.write(record, vaultPassphrase);
  };
  return {
    async holdDeposit(deposit) {
      await write([...(await held()).filter((entry) => entry.v !== deposit.v), deposit]);
    },
    async pendingDeposits() {
      const read = await readQsbPendingDeposits(store, account, vaultPassphrase);
      return read.status === "bound" ? read.deposits : null;
    },
    async releaseDeposit(v, txid) {
      const deposits = await held();
      if (deposits.some((entry) => entry.v === v && entry.txid === txid)) {
        await write(deposits.filter((entry) => entry.v !== v));
      }
    },
  };
};

const keyMethods = (
  deps: QsbVaultDeps,
  account: QsbAccountRecord,
): Pick<QsbVaultAccess, "commitments" | "owner" | "signDeposit" | "signSignIn"> => ({
  commitments: (v) => deps.kms.deriveQsbCommitments(account.mnemonic, v),
  async owner() {
    const { address, publicKey } = await ownerKey(deps, account);
    return { address, publicKey };
  },
  async signDeposit(psbt, inputCount) {
    const key = await ownerKey(deps, account);
    const indices = Array.from({ length: inputCount }, (_, index) => index);
    return deps.kms.signBitcoinPsbtInputs(key.privateKey, psbt, indices);
  },
  async signSignIn(message) {
    const key = await ownerKey(deps, account);
    return deps.kms.signBip322SimpleUnprefixed(key.privateKey, key.address, message);
  },
});

// Every method, refusing once the session's task has settled.
const guarded = (methods: Omit<QsbVaultAccess, "accountId">, isOpen: () => boolean) =>
  Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      async (...args: unknown[]) => {
        if (!isOpen()) {
          throw refused(QSB_VAULT_REFUSALS.runtimeUnavailable);
        }
        return (method as (...values: unknown[]) => Promise<unknown>)(...args);
      },
    ]),
  ) as Omit<QsbVaultAccess, "accountId">;

/**
 * Builds the session method over the vault's snapshot read. The caller (the
 * vault service) runs each call inside its mutation queue.
 */
export const qsbVaultAccessMethods = (deps: QsbVaultDeps): QsbVaultAccessService => ({
  async withQsbVaultAccount(input, task) {
    const vault = await deps.readVaultSnapshot(input.vaultPassphrase);
    const account = vault.qsbAccounts.find((held) => held.id === input.accountId);
    if (!account) {
      throw refused(QSB_ACCOUNT_REFUSALS.unknownAccount);
    }
    const stores = storesOf(deps.wiring, account);
    let open = true;
    const methods = {
      ...depositMethods(account, stores.deposits, input.vaultPassphrase),
      ...journalMethods(account, stores.journal, input.vaultPassphrase),
      ...keyMethods(deps, account),
    };
    try {
      return await task({ accountId: account.id, ...guarded(methods, () => open) });
    } finally {
      open = false;
    }
  },
});
