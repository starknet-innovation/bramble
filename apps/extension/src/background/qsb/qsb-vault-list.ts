/**
 * `wallet.qsbVaults`: the account's owner address, its confirmed funds and
 * every vault, matched to the coordinator's records by script hash. Like
 * every QSB flow it takes the vault's mutation queue only for its local
 * reads and writes, one short slot each, never across the network: it reads
 * the journal, the pending deposits and the owner, asks the coordinator
 * (signing in if it must), then records what the chain now confirms, each
 * record re-validated against the journal as it is then.
 *
 * A deposit is recorded as the vault's funding only once the coordinator's
 * `/funding` reports it confirmed, its transaction hashes to its txid and its
 * output 0 pays this vault's script exactly its amount; the pending bytes of
 * that txid are then dropped. If the user has not granted the coordinator's
 * origin (then it is not asked at all), it cannot be reached, or it answers
 * anything malformed, the reply is the address and the local vaults with
 * `funds` and every `registered` null, rather than a failure.
 */

import { isVaultFunding } from "@bramble/qsb/transactions";
import type { QsbFundingStatus, QsbPublicVault } from "@bramble/qsb/vault-responses";
import type { QsbPendingDeposit } from "@bramble/vault/qsb-deposit-store";
import type { QsbFunding, QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import type { QsbJournalState, QsbVaultAccess } from "@bramble/vault/service-types";
import {
  QSB_MAX_SAT,
  type QsbOwnerFunds,
  type QsbVaultView,
} from "@bramble/wallet-model/qsb-vaults";
import { failClosed, journalUnavailable } from "./qsb-vault-refusals";
import {
  type QsbCoordinatorSession,
  type QsbVaultDeps,
  qsbAccessSession,
  qsbOwnerOf,
} from "./qsb-vault-session";
import { qsbVaultView } from "./qsb-vault-view";

/** The `wallet.qsbVaults` reply, without `ok`. */
export type QsbVaultsListing = {
  readonly address: string;
  readonly funds: QsbOwnerFunds | null;
  readonly vaults: readonly QsbVaultView[];
};

type Local = {
  readonly journal: Extract<QsbJournalState, { readonly status: "bound" }>;
  readonly pending: readonly QsbPendingDeposit[];
};

type Confirmation = {
  readonly confirmations: number;
  readonly funding: QsbFunding;
  readonly v: number;
};

type Remote = {
  readonly confirmations: readonly Confirmation[];
  readonly funds: QsbOwnerFunds;
  readonly vaults: readonly QsbPublicVault[];
};

const readLocal = async (access: QsbVaultAccess): Promise<Local> => {
  const journal = await access.journal();
  if (journal.status !== "bound") throw journalUnavailable();
  return { journal, pending: (await access.pendingDeposits()) ?? [] };
};

// The deposit `/funding` proves confirmed for `record`, or null.
const confirmedFunding = (
  record: QsbVaultRecord,
  server: QsbPublicVault,
  status: QsbFundingStatus,
): Confirmation | null => {
  const funding = status.vault.funding;
  if (
    !status.confirmed ||
    status.vault.id !== server.id ||
    status.vault.scriptHash !== record.scriptHash ||
    !funding ||
    funding.vout !== 0 ||
    record.scriptPubKey === null ||
    !isVaultFunding({ ...funding, rawTxHex: status.previousTxHex, scriptHex: record.scriptPubKey })
  ) {
    return null;
  }
  return { confirmations: status.confirmations, funding, v: record.v };
};

// Each vault whose deposit is pending here or recorded by the coordinator,
// asked one at a time; a vault whose status cannot be read is skipped.
const readConfirmations = async (
  deps: QsbVaultDeps,
  session: QsbCoordinatorSession,
  local: Local,
  vaults: readonly QsbPublicVault[],
): Promise<readonly Confirmation[]> => {
  const confirmations: Confirmation[] = [];
  for (const record of local.journal.vaults) {
    const server = vaults.find((vault) => vault.scriptHash === record.scriptHash);
    const pending = local.pending.some((deposit) => deposit.v === record.v);
    if (record.funding !== null || !server || (!pending && server.funding === null)) continue;
    const status = await session
      .call((token) => deps.coordinator.funding(token, server.id))
      .catch(() => null);
    const confirmed = status ? confirmedFunding(record, server, status) : null;
    if (confirmed) confirmations.push(confirmed);
  }
  return confirmations;
};

const readRemote = async (
  deps: QsbVaultDeps,
  session: QsbCoordinatorSession,
  local: Local,
): Promise<Remote | null> => {
  const utxos = await session.call((token) => deps.coordinator.paymentUtxos(token));
  const totalSat = utxos.reduce((total, utxo) => total + utxo.valueSat, 0);
  if (!Number.isSafeInteger(totalSat) || totalSat > QSB_MAX_SAT) return null;
  const { vaults } = await session.call((token) => deps.coordinator.vaults(token));
  const confirmations = await readConfirmations(deps, session, local, vaults);
  return { confirmations, funds: { totalSat, utxoCount: utxos.length }, vaults };
};

// Records each confirmed deposit, then drops its pending bytes; a vault whose
// record is refused keeps what it had.
const recordConfirmations = async (
  access: QsbVaultAccess,
  confirmations: readonly Confirmation[],
): Promise<Local> => {
  for (const { funding, v } of confirmations) {
    const recorded = await access.commit({ funding, kind: "fund", v }).catch(() => null);
    if (recorded?.ok) {
      await access.releaseDeposit(v, funding.txid).catch(() => undefined);
    }
  }
  return readLocal(access);
};

const viewsOf = (local: Local, remote: Remote | null): readonly QsbVaultView[] =>
  local.journal.vaults.map((record) =>
    qsbVaultView(
      record,
      local.pending.find((deposit) => deposit.v === record.v),
      remote === null
        ? null
        : {
            confirmations:
              remote.confirmations.find((confirmed) => confirmed.v === record.v)?.confirmations ??
              null,
            vault: remote.vaults.find((vault) => vault.scriptHash === record.scriptHash),
          },
    ),
  );

/** Lists the account the session `access` is over. */
export const listQsbVaults = (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
): Promise<QsbVaultsListing> =>
  failClosed("coordinatorUnavailable", async () => {
    const local = await readLocal(access);
    const owner = await qsbOwnerOf(access);
    const session = qsbAccessSession(deps, access, owner);
    // Without the user's grant the coordinator is not asked at all.
    const remote = (await deps.coordinatorAccess())
      ? await readRemote(deps, session, local).catch(() => null)
      : null;
    const settled =
      remote && remote.confirmations.length > 0
        ? await recordConfirmations(access, remote.confirmations).catch(() => local)
        : local;
    return {
      address: owner.address,
      funds: remote?.funds ?? null,
      vaults: viewsOf(settled, remote),
    };
  });
