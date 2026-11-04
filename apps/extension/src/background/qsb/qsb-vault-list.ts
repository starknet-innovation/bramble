/**
 * `wallet.qsbVaults`: the account's owner address, its confirmed funds and
 * every vault, matched to the coordinator's records by script hash. The
 * panel polls it, so it holds the vault's mutation queue only for its local
 * reads and writes, never across the network: one session reads the journal,
 * the pending deposits and the owner; the coordinator is asked outside any
 * session (signing in through a short one of its own if it must); and a last
 * session records what the chain now confirms.
 *
 * A deposit is recorded as the vault's funding only once the coordinator's
 * `/funding` reports it confirmed, its transaction hashes to its txid and its
 * output 0 pays this vault's script exactly its amount; the pending bytes of
 * that txid are then dropped. If the coordinator cannot be reached, or
 * answers anything malformed, the reply is the address and the local vaults
 * with `funds` and every `registered` null, rather than a failure.
 */

import { isVaultFunding } from "@bramble/qsb/transactions";
import type { QsbFundingStatus, QsbPublicVault } from "@bramble/qsb/vault-responses";
import type { QsbPendingDeposit } from "@bramble/vault/qsb-deposit-store";
import type { QsbFunding, QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import type { QsbJournalState, QsbOwner, QsbVaultAccess } from "@bramble/vault/service-types";
import {
  QSB_MAX_SAT,
  type QsbOwnerFunds,
  type QsbVaultView,
} from "@bramble/wallet-model/qsb-vaults";
import { failClosed, journalUnavailable } from "./qsb-vault-refusals";
import {
  type QsbCoordinatorSession,
  type QsbVaultDeps,
  qsbCoordinatorSession,
  qsbOwnerOf,
} from "./qsb-vault-session";
import { qsbVaultView } from "./qsb-vault-view";

/** Opens one short vault session over the account being listed. */
export type QsbVaultOpener = <T>(task: (access: QsbVaultAccess) => Promise<T>) => Promise<T>;

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

// Signs in through a short session of its own, outside the listing's reads.
const signerOf = (owner: QsbOwner, open: QsbVaultOpener) => ({
  address: owner.address,
  signSignIn: (message: string) => open((access) => access.signSignIn(message)),
});

/** Lists the account `open` opens sessions over. */
export const listQsbVaults = (
  deps: QsbVaultDeps,
  open: QsbVaultOpener,
): Promise<QsbVaultsListing> =>
  failClosed("coordinatorUnavailable", async () => {
    const { accountId, local, owner } = await open(async (access) => ({
      accountId: access.accountId,
      local: await readLocal(access),
      owner: await qsbOwnerOf(access),
    }));
    const session = qsbCoordinatorSession(deps, accountId, signerOf(owner, open));
    const remote = await readRemote(deps, session, local).catch(() => null);
    const settled =
      remote && remote.confirmations.length > 0
        ? await open((access) => recordConfirmations(access, remote.confirmations)).catch(
            () => local,
          )
        : local;
    return {
      address: owner.address,
      funds: remote?.funds ?? null,
      vaults: viewsOf(settled, remote),
    };
  });
