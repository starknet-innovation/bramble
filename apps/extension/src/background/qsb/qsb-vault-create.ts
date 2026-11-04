/**
 * `wallet.createQsbVault`: allocate a QSB account's next vault, build its
 * script from Krusty's commitments, and register it with the coordinator.
 * Runs whole inside one vault session, so inside the vault's mutation queue.
 *
 * The order is the safety (BIP "QSB Wallet Secret Management", Allocation):
 * only a writer may create; `v = nextV` is allocated durably with Krusty's
 * root before any commitment or script leaves the background; the script is
 * rebuilt and associated durably next; then, on a fresh vault list, the reuse
 * scan; then the registration. A registration that failed for a retryable
 * reason leaves the vault allocated and unregistered, and the next create
 * finishes that same vault (found by script hash in the list) rather than
 * allocating another index. A script another vault holds, something already
 * paid, or a vault of this owner pushing one of its commitments is
 * `scriptTaken`: the vault stays unregistered and its history is marked
 * unknown, so no later create retries it and no disclosure is ever made from
 * it. The coordinator's vault id is a fresh random uuid each attempt and is
 * never kept: vaults are matched by script hash.
 */

import { RefusedBeforeWrite } from "@bramble/core/errors";
import { isoInstant } from "@bramble/qsb/instant";
import { qsbVaultRegistration } from "@bramble/qsb/registration";
import { pushesAnyCommitment } from "@bramble/qsb/reuse";
import type { QsbPublicVault, QsbVaultList } from "@bramble/qsb/vault-responses";
import type { QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import type { QsbJournalState, QsbVaultAccess } from "@bramble/vault/service-types";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import { requireOwnerAllowed } from "./qsb-vault-gates";
import {
  coordinatorRefusal,
  failClosed,
  isRegistrationRefused,
  isScriptTaken,
  journalRefusal,
  qsbRefusal,
} from "./qsb-vault-refusals";
import { type QsbBuiltVault, rebuildQsbVault } from "./qsb-vault-script";
import {
  type QsbCoordinatorSession,
  type QsbVaultDeps,
  qsbAccessSession,
  qsbOwnerOf,
} from "./qsb-vault-session";
import { qsbVaultView } from "./qsb-vault-view";

type BoundJournal = Extract<QsbJournalState, { readonly status: "bound" }>;

const writerJournal = async (access: QsbVaultAccess): Promise<BoundJournal> => {
  const journal = await access.journal();
  if (journal.status !== "bound") {
    throw new RefusedBeforeWrite(QSB_ACCOUNT_REFUSALS.journalUnavailable);
  }
  if (!journal.writer) {
    throw qsbRefusal("notWriter");
  }
  return journal;
};

// The oldest allocated, unfunded vault the coordinator does not hold: one a
// failed registration left behind, to be finished before any new index.
const unfinished = (journal: BoundJournal, listed: QsbVaultList): QsbVaultRecord | undefined =>
  journal.vaults.find(
    (vault) =>
      vault.state === "allocated" &&
      vault.funding === null &&
      !listed.vaults.some((server) => server.scriptHash === vault.scriptHash),
  );

const allocate = async (access: QsbVaultAccess, journal: BoundJournal): Promise<QsbVaultRecord> => {
  const v = journal.nextV;
  const { root } = await access.commitments(v);
  const result = await access.commit({ kind: "allocate", root, v });
  if (!result.ok) {
    throw journalRefusal(result.refusal);
  }
  const record = result.journal.vaults.find((vault) => vault.v === v);
  if (!record) throw qsbRefusal("runtimeUnavailable");
  return record;
};

// Records the rebuilt script, durably, before it is ever sent; a record that
// already holds a different script is refused.
const associate = async (
  access: QsbVaultAccess,
  record: QsbVaultRecord,
  built: QsbBuiltVault,
): Promise<QsbVaultRecord> => {
  const result = await access.commit({
    kind: "associate",
    scriptHash: built.script.scriptHash,
    scriptPubKey: built.script.scriptHex,
    v: record.v,
  });
  const associated = result.ok
    ? result.journal.vaults.find((vault) => vault.v === record.v)
    : undefined;
  if (!associated || associated.scriptHash !== built.script.scriptHash) {
    throw qsbRefusal("runtimeUnavailable");
  }
  return associated;
};

const markTaken = async (access: QsbVaultAccess, v: number): Promise<never> => {
  await access.commit({ kind: "mark-unknown", v }).catch(() => undefined);
  throw qsbRefusal("scriptTaken");
};

const register = async (
  deps: QsbVaultDeps,
  session: QsbCoordinatorSession,
  owner: string,
  built: QsbBuiltVault,
): Promise<QsbPublicVault> => {
  const body = qsbVaultRegistration({
    createdAt: isoInstant(deps.now()),
    id: deps.drawVaultId(),
    owner,
    script: built.script,
  });
  if (body === null) throw qsbRefusal("runtimeUnavailable");
  const vault = await session.call((token) => deps.coordinator.register(token, body));
  // Bound to this vault: the coordinator must answer with the very script and owner.
  if (vault.scriptHash !== built.script.scriptHash || vault.paymentAddress !== owner) {
    throw qsbRefusal("coordinatorUnavailable");
  }
  return vault;
};

const finish = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  session: QsbCoordinatorSession,
  owner: string,
  record: QsbVaultRecord,
): Promise<QsbVaultView> => {
  const built = await rebuildQsbVault(deps, access, record, "runtimeUnavailable");
  const associated = await associate(access, record, built);
  const listed = await session.call((token) => deps.coordinator.vaults(token));
  const own = listed.vaults.find((vault) => vault.scriptHash === built.script.scriptHash);
  if (own) {
    return qsbVaultView(associated, undefined, { confirmations: null, vault: own });
  }
  if (pushesAnyCommitment(listed.vaults, built.commitments)) {
    return markTaken(access, record.v);
  }
  try {
    const vault = await register(deps, session, owner, built);
    return qsbVaultView(associated, undefined, { confirmations: null, vault });
  } catch (error) {
    if (isScriptTaken(error)) return markTaken(access, record.v);
    // The vault Bramble built was refused as built (`vault_invalid`,
    // `invalid_request`): its own failure, final for this attempt.
    if (isRegistrationRefused(error)) throw qsbRefusal("runtimeUnavailable");
    throw error instanceof RefusedBeforeWrite ? error : coordinatorRefusal(error);
  }
};

/**
 * Creates (or finishes) one vault for the account `access` is over and
 * answers with its view: `allocated`, registered, no deposit. Refuses with
 * the contract's diagnostics only.
 */
export const createQsbVault = (deps: QsbVaultDeps, access: QsbVaultAccess): Promise<QsbVaultView> =>
  failClosed("runtimeUnavailable", async () => {
    const journal = await writerJournal(access);
    const owner = await qsbOwnerOf(access);
    const session = qsbAccessSession(deps, access, owner);
    requireOwnerAllowed(await deps.coordinator.config());
    const listed = await session.call((token) => deps.coordinator.vaults(token));
    const record = unfinished(journal, listed) ?? (await allocate(access, journal));
    return finish(deps, access, session, owner.address, record);
  });
