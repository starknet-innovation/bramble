/**
 * The vault service's QSB vault session: what the background's vault and
 * deposit flows may ask of one QSB account, implemented over the account's
 * journal store, its pending-deposit store and Krusty.
 *
 * Trust boundary: background-only. A session holds no queue slot of its own:
 * every call takes one short slot of the service's mutation queue, and only
 * for local work (a vault or store read, one durable write, a Krusty
 * derivation or signature), never across a network call or a runtime run,
 * which the caller makes between calls. Each slot re-reads what it depends on
 * — the account (still present, still bound to the journal id it was opened
 * over), the journal, the pending deposits — and re-validates it, so no slot
 * acts on state an earlier slot read: an allocation is refused unless `v` is
 * still `nextV` and the account still a writer, a script or funding unless the
 * vault is still in the state its transition needs, a kept deposit unless the
 * vault can still take one and no other bytes are kept for it.
 *
 * The account record, its phrase and the owner's private key never leave this
 * module: the BIP-84 owner key `m/84'/0'/0'/0/0` is derived through Krusty
 * inside the slot that uses it and dropped; only public values leave. The
 * journal crosses as its vault records only; journal changes are asked for by
 * name and applied here. Every write is validated and durable before its call
 * resolves, and a lost journal is never recreated. A session refuses every
 * call once its task has settled.
 */
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
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
import { isQsbWriter, type QsbJournalBinding } from "../qsb/qsb-journal-record";
import { writeQsbJournal } from "../qsb/qsb-journal-store";
import type { Vault } from "../schema/schema";
import type { QsbAccountWiring } from "./qsb-account-types";
import { currentQsbSlot, type QsbSlot, qsbSlotBinding, qsbSlotRefusal } from "./qsb-vault-slot";
import type {
  QsbJournalChange,
  QsbJournalChangeResult,
  QsbJournalState,
  QsbVaultAccess,
  QsbVaultAccessService,
} from "./qsb-vault-types";
import { qsbWithdrawalMethods } from "./qsb-vault-withdrawals";

type QsbVaultDeps = {
  readonly kms: Pick<
    KmsPort,
    | "deriveBitcoinP2wpkhKeypair"
    | "deriveQsbCommitments"
    | "qsbRevealDigest"
    | "revealQsbPreimages"
    | "signBip322SimpleUnprefixed"
    | "signBitcoinPsbtInputs"
  >;
  readonly readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>;
  /** The service's mutation queue: one slot per call. */
  readonly serialized: <T>(run: () => Promise<T>) => Promise<T>;
  readonly wiring: QsbAccountWiring | undefined;
};

type Slot = QsbSlot;

type BoundState = Extract<QsbJournalState, { readonly status: "bound" }>;

const refused = qsbSlotRefusal;
const currentSlot = currentQsbSlot;

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

const bindingOf = qsbSlotBinding;

// Re-validated by the journal's own transition against the journal as it is
// in this slot: `nextV`, the vault's state and writer status included.
const commitIn = async (slot: Slot, change: QsbJournalChange): Promise<QsbJournalChangeResult> => {
  const binding = await bindingOf(slot);
  const result = transition(binding, change);
  if (!result.ok) return result;
  const next = boundState({ account: slot.account, journal: result.journal, status: "bound" });
  if (binding.status === "bound" && result.journal === binding.journal) {
    return { journal: next, ok: true };
  }
  const written = await writeQsbJournal(
    slot.journal,
    slot.account,
    result.journal,
    slot.vaultPassphrase,
    "replace",
  );
  if (written.ok) return { journal: next, ok: true };
  return {
    ok: false,
    refusal: written.refusal === "journal-full" ? "journal-full" : "journal-unavailable",
  };
};

const heldIn = async (slot: Slot): Promise<readonly QsbPendingDeposit[]> => {
  const read = await readQsbPendingDeposits(slot.deposits, slot.account, slot.vaultPassphrase);
  if (read.status !== "bound") throw refused(QSB_ACCOUNT_REFUSALS.journalUnavailable);
  return read.deposits;
};

const writeHeld = async (slot: Slot, deposits: readonly QsbPendingDeposit[]): Promise<void> => {
  const record = qsbPendingRecord(slot.account, deposits);
  if (record === null) throw refused(QSB_VAULT_REFUSALS.depositPending);
  await slot.deposits.write(record, slot.vaultPassphrase);
};

// Keeps a deposit only while its vault can still take one and no other bytes
// are kept for it; the same bytes again change nothing.
const holdIn = async (slot: Slot, deposit: QsbPendingDeposit): Promise<void> => {
  const binding = await bindingOf(slot);
  const record =
    binding.status === "bound"
      ? binding.journal.vaults.find((vault) => vault.v === deposit.v)
      : undefined;
  if (record?.state !== "allocated" || record.funding !== null || record.scriptPubKey === null) {
    throw refused(QSB_VAULT_REFUSALS.notDepositable);
  }
  const held = await heldIn(slot);
  const kept = held.find((entry) => entry.v === deposit.v);
  if (kept) {
    if (kept.rawTxHex !== deposit.rawTxHex) throw refused(QSB_VAULT_REFUSALS.depositPending);
    return;
  }
  await writeHeld(slot, [...held, deposit]);
};

const releaseIn = async (slot: Slot, v: number, txid: string): Promise<void> => {
  const held = await heldIn(slot);
  if (held.some((entry) => entry.v === v && entry.txid === txid)) {
    await writeHeld(
      slot,
      held.filter((entry) => entry.v !== v),
    );
  }
};

// The owner's BIP-84 key: account 0, receiving chain, index 0.
const ownerKey = (deps: QsbVaultDeps, account: QsbAccountRecord) =>
  deps.kms.deriveBitcoinP2wpkhKeypair(account.mnemonic, 0, 0, 0);

const sessionOver = (
  deps: QsbVaultDeps,
  opened: Pick<QsbAccountRecord, "id" | "journalId">,
  vaultPassphrase: string,
  isOpen: () => boolean,
): QsbVaultAccess => {
  // One short slot per call, over the account as stored at that moment.
  const inSlot = <T>(run: (slot: Slot) => Promise<T>): Promise<T> => {
    if (!isOpen()) return Promise.reject(refused(QSB_VAULT_REFUSALS.runtimeUnavailable));
    return deps.serialized(async () => run(await currentSlot(deps, opened, vaultPassphrase)));
  };
  return {
    accountId: opened.id,
    commit: (change) => inSlot((slot) => commitIn(slot, change)),
    commitments: (v) => inSlot((slot) => deps.kms.deriveQsbCommitments(slot.account.mnemonic, v)),
    holdDeposit: (deposit) => inSlot((slot) => holdIn(slot, deposit)),
    journal: () =>
      inSlot(async (slot) => {
        const binding = await bindingOf(slot);
        return binding.status === "bound" ? boundState(binding) : { status: "unavailable" };
      }),
    owner: () =>
      inSlot(async (slot) => {
        const { address, publicKey } = await ownerKey(deps, slot.account);
        return { address, publicKey };
      }),
    pendingDeposits: () =>
      inSlot(async (slot) => {
        const read = await readQsbPendingDeposits(slot.deposits, slot.account, vaultPassphrase);
        return read.status === "bound" ? read.deposits : null;
      }),
    releaseDeposit: (v, txid) => inSlot((slot) => releaseIn(slot, v, txid)),
    signDeposit: (psbt, inputCount) =>
      inSlot(async (slot) => {
        const key = await ownerKey(deps, slot.account);
        const indices = Array.from({ length: inputCount }, (_, index) => index);
        return deps.kms.signBitcoinPsbtInputs(key.privateKey, psbt, indices);
      }),
    signSignIn: (message) =>
      inSlot(async (slot) => {
        const key = await ownerKey(deps, slot.account);
        return deps.kms.signBip322SimpleUnprefixed(key.privateKey, key.address, message);
      }),
    ...qsbWithdrawalMethods(deps.kms, inSlot, isOpen),
  };
};

/**
 * Builds the session method over the vault's snapshot read and the service's
 * mutation queue. Opening takes one slot, to find the account (refused as
 * unknown, or without wiring as unavailable, before `task` runs); `task` then
 * runs outside the queue, and each of its calls takes a slot of its own.
 */
export const qsbVaultAccessMethods = (deps: QsbVaultDeps): QsbVaultAccessService => ({
  async withQsbVaultAccount(input, task) {
    const opened = await deps.serialized(async () => {
      const vault = await deps.readVaultSnapshot(input.vaultPassphrase);
      const account = vault.qsbAccounts.find((held) => held.id === input.accountId);
      if (!account) throw refused(QSB_ACCOUNT_REFUSALS.unknownAccount);
      const { id, journalId } = (await currentSlot(deps, account, input.vaultPassphrase)).account;
      return { id, journalId };
    });
    let open = true;
    try {
      return await task(sessionOver(deps, opened, input.vaultPassphrase, () => open));
    } finally {
      open = false;
    }
  },
});
