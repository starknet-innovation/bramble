/**
 * Preparing a QSB deposit: everything up to and excluding Krusty signing it,
 * shared by `wallet.quoteQsbDeposit` (which stops here) and
 * `wallet.depositQsbVault` (qsb-app `sdk/client.ts` `prepareDeposit`, and the
 * spec's client checks §6).
 *
 * In order, each refusing before anything is written or sent: the amount is
 * at least the minimum; the vault is this account's, `allocated`, unfunded
 * and has its script; no deposit is pending for it here; the deployment
 * takes deposits and submits to MARA; the script is rebuilt from fresh
 * commitments and must equal the journal's and the coordinator's, which
 * lists the vault unfunded, depositable, owned by this address, and no other
 * vault of this owner pushes one of its commitments; the fee rate is MARA's
 * floor; the owner's confirmed outputs are selected deterministically and
 * must cover amount and fee; each one's previous transaction is fetched and
 * must be the txid it claims and pay the owner exactly its value; and the
 * PSBT is built from them.
 */
import { selectQsbCoins } from "@bramble/qsb/coins";
import { qsbFormatFeeRate, qsbMinerFloorMsat, qsbWithdrawalFeeSat } from "@bramble/qsb/fees";
import { buildQsbDepositPsbt, type QsbDepositInput } from "@bramble/qsb/psbt";
import type { QsbOutpoint } from "@bramble/qsb/responses";
import { pushesAnyCommitment } from "@bramble/qsb/reuse";
import { isOwnerPayment, ownerP2wpkhScript } from "@bramble/qsb/transactions";
import type { QsbPublicVault, QsbVaultList } from "@bramble/qsb/vault-responses";
import type { QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import type { QsbOwner, QsbVaultAccess } from "@bramble/vault/service-types";
import {
  QSB_MAX_SAT,
  QSB_MIN_DEPOSIT_SAT,
  type QsbDepositQuote,
} from "@bramble/wallet-model/qsb-vaults";
import { requireDepositsOpen } from "./qsb-vault-gates";
import { journalUnavailable, qsbRefusal } from "./qsb-vault-refusals";
import { type QsbBuiltVault, rebuildQsbVault } from "./qsb-vault-script";
import type { QsbCoordinatorSession, QsbVaultDeps } from "./qsb-vault-session";

/** Everything a deposit flow runs with, for one account. */
export type QsbDepositContext = {
  readonly access: QsbVaultAccess;
  readonly deps: QsbVaultDeps;
  readonly owner: QsbOwner;
  readonly session: QsbCoordinatorSession;
};

/** A prepared deposit: its quote, the unsigned PSBT and what it was checked against. */
export type QsbPreparedDeposit = {
  readonly built: QsbBuiltVault;
  readonly psbt: NonNullable<ReturnType<typeof buildQsbDepositPsbt>>;
  readonly quote: QsbDepositQuote;
  readonly record: QsbVaultRecord;
  readonly server: QsbPublicVault;
};

/** A vault record that can take its one deposit, with its script known. */
export type QsbDepositableRecord = QsbVaultRecord & {
  readonly scriptHash: string;
  readonly scriptPubKey: string;
};

/** The journal record of vault `v`, refused unless it can take a deposit. */
export const depositableRecord = async (
  access: Pick<QsbVaultAccess, "journal">,
  v: number,
): Promise<QsbDepositableRecord> => {
  const journal = await access.journal();
  if (journal.status !== "bound") throw journalUnavailable();
  const record = journal.vaults.find((vault) => vault.v === v);
  if (!record) throw qsbRefusal("unknownVault");
  if (
    record.state !== "allocated" ||
    record.funding !== null ||
    record.scriptHash === null ||
    record.scriptPubKey === null
  ) {
    throw qsbRefusal("notDepositable");
  }
  return record as QsbDepositableRecord;
};

const requireNothingPending = async (access: QsbVaultAccess, v: number): Promise<void> => {
  const pending = await access.pendingDeposits();
  if (pending === null) throw journalUnavailable();
  if (pending.some((deposit) => deposit.v === v)) throw qsbRefusal("depositPending");
};

/**
 * The coordinator's record of this vault, refused unless it is this exact
 * vault (script, public state, owner), unfunded and depositable, and no
 * other vault of this owner shares one of its commitments.
 */
export const depositableServerVault = (
  listed: QsbVaultList,
  built: QsbBuiltVault,
  owner: QsbOwner,
): QsbPublicVault => {
  const server = listed.vaults.find((vault) => vault.scriptHash === built.script.scriptHash);
  if (
    !server ||
    listed.noDeposit.includes(server.id) ||
    server.status !== "unfunded" ||
    server.funding !== null ||
    server.scriptHex !== built.script.scriptHex ||
    server.publicStateJson !== built.script.publicStateJson ||
    server.paymentAddress !== owner.address
  ) {
    throw qsbRefusal("notDepositable");
  }
  const others = listed.vaults.filter((vault) => vault.id !== server.id);
  if (pushesAnyCommitment(others, built.commitments)) {
    throw qsbRefusal("scriptTaken");
  }
  return server;
};

/** MARA's floor in millisatoshis per vB, read now; any failure fails closed. */
export const minerFloorMsat = async (deps: QsbVaultDeps): Promise<bigint> => {
  const floor = await deps.coordinator.rates().then(qsbMinerFloorMsat, () => null);
  if (floor === null) throw qsbRefusal("minerRateUnavailable");
  return floor;
};

// Each selected output's previous transaction, in order, verified.
const fundingInputs = async (
  context: QsbDepositContext,
  coins: readonly QsbOutpoint[],
  ownerScript: Uint8Array,
): Promise<readonly QsbDepositInput[]> => {
  const inputs: QsbDepositInput[] = [];
  for (const coin of coins) {
    const { previousTxHex } = await context.session.call((token) =>
      context.deps.coordinator.paymentInput(token, coin),
    );
    if (!isOwnerPayment({ ...coin, ownerScript, previousTxHex })) {
      throw qsbRefusal("coordinatorUnavailable");
    }
    inputs.push({ ...coin, previousTxHex });
  }
  return inputs;
};

const rebuiltRecordScript = async (
  context: QsbDepositContext,
  record: QsbDepositableRecord,
): Promise<QsbBuiltVault> => {
  const built = await rebuildQsbVault(context.deps, context.access, record, "notDepositable");
  if (
    built.script.scriptHash !== record.scriptHash ||
    built.script.scriptHex !== record.scriptPubKey
  ) {
    throw qsbRefusal("notDepositable");
  }
  return built;
};

/**
 * Prepares a deposit of `amountSat` into vault `v`. Writes and sends
 * nothing; refuses with the contract's diagnostics.
 */
export const prepareQsbDeposit = async (
  context: QsbDepositContext,
  request: { readonly amountSat: number; readonly v: number },
): Promise<QsbPreparedDeposit> => {
  const { access, deps, owner, session } = context;
  if (request.amountSat < QSB_MIN_DEPOSIT_SAT) throw qsbRefusal("amountTooSmall");
  const record = await depositableRecord(access, request.v);
  await requireNothingPending(access, request.v);
  requireDepositsOpen(await deps.coordinator.config());
  const built = await rebuiltRecordScript(context, record);
  const listed = await session.call((token) => deps.coordinator.vaults(token));
  const server = depositableServerVault(listed, built, owner);
  const rateMsat = await minerFloorMsat(deps);
  const coins = await session.call((token) => deps.coordinator.paymentUtxos(token));
  const selection = selectQsbCoins({
    amountSat: request.amountSat,
    coins,
    rateMsat,
    scriptBytes: record.scriptPubKey.length / 2,
  });
  if (!selection) throw qsbRefusal("insufficientFunds");
  const spent = BigInt(request.amountSat) + selection.changeSat + selection.feeSat;
  const ownerScript = ownerP2wpkhScript(owner.address);
  if (spent > BigInt(QSB_MAX_SAT) || ownerScript === null)
    throw qsbRefusal("coordinatorUnavailable");
  const inputs = await fundingInputs(context, selection.coins, ownerScript);
  const psbt = buildQsbDepositPsbt({
    amountSat: request.amountSat,
    changeSat: Number(selection.changeSat),
    inputs,
    ownerAddress: owner.address,
    ownerScript,
    scriptHex: record.scriptPubKey,
  });
  if (psbt === null) throw qsbRefusal("runtimeUnavailable");
  const quote: QsbDepositQuote = {
    amountSat: request.amountSat,
    changeSat: Number(selection.changeSat),
    feeRate: qsbFormatFeeRate(rateMsat),
    feeSat: Number(selection.feeSat),
    inputCount: inputs.length,
    vsize: selection.vsize,
    withdrawalFeeSat: Number(qsbWithdrawalFeeSat(rateMsat)),
  };
  return { built, psbt, quote, record, server };
};
