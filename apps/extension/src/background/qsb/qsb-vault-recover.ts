/**
 * `wallet.recoverQsbVaults`: the emergency recovery of a read-only QSB
 * account's deposits (BIP "QSB Wallet Secret Management", "Backup,
 * restoration, and multiple devices"). When the install that created a QSB
 * vault is gone, its journal is gone with it, and importing the phrase starts
 * an empty journal. This finds, on the coordinator, the vaults this phrase
 * built and records each as `unknown` — never `allocated`, so the account
 * never becomes a writer and no record claims its keys are unused — then
 * adopts a withdrawal still waiting for its release.
 *
 * Runs under the account's QSB lock, over one vault session whose every local
 * step takes its own short slot of the vault's queue; the coordinator and the
 * runtime are called between slots, never inside one. In order, each refusing
 * before anything is written: the user's grant of the coordinator's origin
 * (`accessNeeded`); a bound journal (`journalUnavailable`) of an account that
 * is not the writer (`recoveryNotNeeded`); sign-in as the owner; the owner's
 * vaults and jobs. Then, for `v` from 0 up to `MAX_QSB_VAULTS_PER_ACCOUNT`,
 * stopping once every listed vault is matched: Krusty's commitments for `v`
 * and the script the pinned pipeline builds from them, exactly as a create
 * does. A listed vault matches when its script hash is the SHA-256 of that
 * script and its script is that script; a listed vault no index matches is
 * not this phrase's and is ignored. The coordinator's vault ids are never
 * kept.
 *
 * Each match becomes an `unknown` record with its root, script and hash, and
 * its funding only when `/funding` proves it exactly as the listing does
 * (`qsbConfirmedFunding`). The records are merged by the journal's own merge
 * (`nextV` the highest match plus one, nothing weakened) and the merge is
 * durable before anything else. A job is adopted only when it is the one
 * job of a matched, funded vault, still searching or awaiting authorization
 * with no transaction, its manifest canonical with the job's hash, naming
 * that vault and that exact funding, paying a destination Bramble can pay its
 * own script for, with a positive fee and helper and a payout above dust that
 * is exactly the deposit plus the helper less the fee. Any mismatch leaves
 * the vault `unknown` with no withdrawal. Running it again changes nothing
 * already recovered. Answers as `wallet.qsbVaults` does.
 */

import type { QsbPublicVault } from "@bramble/qsb/vault-responses";
import { qsbDestination } from "@bramble/qsb/withdrawal-destination";
import {
  type QsbWithdrawalManifest,
  qsbManifestHash,
  qsbManifestJson,
  readQsbManifest,
} from "@bramble/qsb/withdrawal-manifest";
import type { QsbJob, QsbJobStatus } from "@bramble/qsb/withdrawal-responses";
import {
  MAX_QSB_VAULTS_PER_ACCOUNT,
  type QsbFunding,
  type QsbVaultRecord,
} from "@bramble/vault/qsb-vault-record";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import { QSB_MAX_SAT } from "@bramble/wallet-model/qsb-vaults";
import { requireCoordinatorAccess } from "./qsb-vault-gates";
import { listQsbVaults, type QsbVaultsListing, qsbConfirmedFunding } from "./qsb-vault-list";
import { failClosed, journalRefusal, journalUnavailable, qsbRefusal } from "./qsb-vault-refusals";
import { buildQsbVault } from "./qsb-vault-script";
import {
  type QsbCoordinatorSession,
  type QsbVaultDeps,
  qsbAccessSession,
  qsbOwnerOf,
} from "./qsb-vault-session";
import { qsbScriptHash } from "./qsb-vault-setup";

// A listed vault and the index whose script it holds.
type Match = { readonly record: QsbVaultRecord; readonly server: QsbPublicVault };

// The job states a withdrawal is adopted from: nothing broadcast, nothing final.
const ADOPTABLE: ReadonlySet<QsbJobStatus> = new Set<QsbJobStatus>([
  "awaiting_authorization",
  "paused",
  "queued",
  "searching",
]);

// Each listed vault this phrase built, found by deriving index after index.
const matchVaults = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  listed: readonly QsbPublicVault[],
): Promise<readonly Match[]> => {
  const unmatched = new Map(listed.map((server) => [server.scriptHash, server]));
  const matches: Match[] = [];
  for (let v = 0; v < MAX_QSB_VAULTS_PER_ACCOUNT && unmatched.size > 0; v += 1) {
    const derived = await access.commitments(v);
    const { script } = await buildQsbVault(deps, derived);
    const hash = await qsbScriptHash(script.scriptHex);
    const server = hash === null ? undefined : unmatched.get(hash);
    if (!server || server.scriptHex !== script.scriptHex) continue;
    unmatched.delete(server.scriptHash);
    matches.push({
      record: {
        disclosure: null,
        funding: null,
        root: derived.root,
        scriptHash: server.scriptHash,
        scriptPubKey: script.scriptHex,
        state: "unknown",
        v,
      },
      server,
    });
  }
  return matches;
};

// The match with its funding, when `/funding` proves it; unfunded otherwise.
const withFunding = async (
  deps: QsbVaultDeps,
  session: QsbCoordinatorSession,
  match: Match,
): Promise<Match> => {
  if (match.server.funding === null) return match;
  const status = await session
    .call((token) => deps.coordinator.funding(token, match.server.id))
    .catch(() => null);
  const confirmed = status ? qsbConfirmedFunding(match.record, match.server, status) : null;
  return confirmed ? { ...match, record: { ...match.record, funding: confirmed.funding } } : match;
};

const sats = (value: string): bigint => BigInt(value);

const sameFunding = (manifest: QsbWithdrawalManifest, funding: QsbFunding): boolean =>
  manifest.funding.txid === funding.txid &&
  manifest.funding.vout === funding.vout &&
  manifest.funding.value === String(funding.valueSat);

/**
 * The withdrawal `job` describes for the recovered `record` of coordinator
 * vault `server`, or null when anything about it does not check out.
 */
const adoptedQsbWithdrawal = (
  record: QsbVaultRecord,
  server: QsbPublicVault,
  job: QsbJob,
): QsbWithdrawalRecord | null => {
  if (record.funding === null || !ADOPTABLE.has(job.status) || job.txid !== null) return null;
  const manifestJson = qsbManifestJson(job.manifest);
  const manifest = manifestJson === null ? null : readQsbManifest(JSON.parse(manifestJson));
  if (
    manifestJson === null ||
    manifest === null ||
    qsbManifestHash(manifestJson) !== job.manifestHash ||
    job.vaultId !== server.id ||
    manifest.vaultId !== server.id ||
    manifest.idempotencyKey !== job.id ||
    !sameFunding(manifest, record.funding)
  ) {
    return null;
  }
  const destination = qsbDestination(manifest.destination);
  const [funding, helper, fee, output] = [
    sats(manifest.funding.value),
    sats(manifest.helper.value),
    sats(manifest.fee),
    sats(manifest.outputValue),
  ];
  if (
    destination === null ||
    destination.address !== manifest.destination ||
    destination.outputScript !== manifest.outputScript ||
    helper <= 0n ||
    fee <= 0n ||
    funding + helper > BigInt(QSB_MAX_SAT) ||
    output < BigInt(destination.dustSat) ||
    funding + helper - fee !== output
  ) {
    return null;
  }
  return {
    destination: manifest.destination,
    feeSat: Number(fee),
    helper: { txid: manifest.helper.txid, valueSat: Number(helper), vout: manifest.helper.vout },
    jobCreated: true,
    jobId: job.id,
    manifestHash: job.manifestHash,
    manifestJson,
    outcome: null,
    outputSat: Number(output),
    signed: null,
    v: record.v,
  };
};

// Merges the matches durably; answers the journal's records as they now stand.
const recordMatches = async (
  access: QsbVaultAccess,
  matches: readonly Match[],
): Promise<readonly QsbVaultRecord[]> => {
  const nextV = Math.max(...matches.map(({ record }) => record.v)) + 1;
  const result = await access.commit({
    journal: { nextV, vaults: matches.map(({ record }) => record) },
    kind: "recover",
  });
  if (!result.ok) throw journalRefusal(result.refusal);
  return result.journal.vaults;
};

// Adopts each matched vault's one job; a job that does not check out, or that
// the record refuses, is left alone.
const adoptJobs = async (
  access: QsbVaultAccess,
  matches: readonly Match[],
  recorded: readonly QsbVaultRecord[],
  jobs: readonly QsbJob[],
): Promise<void> => {
  const held = await access.withdrawals();
  if (held === null) throw journalUnavailable();
  for (const { server, record } of matches) {
    const current = recorded.find((vault) => vault.v === record.v);
    const forVault = jobs.filter((job) => job.vaultId === server.id);
    const [job] = forVault;
    if (!current || !job || forVault.length !== 1 || held.some((entry) => entry.v === record.v)) {
      continue;
    }
    const adopted = adoptedQsbWithdrawal(current, server, job);
    if (adopted) await access.adoptWithdrawal(adopted).catch(() => undefined);
  }
};

/** Recovers the deposits of the read-only account `access` is over. */
export const recoverQsbVaults = (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
): Promise<QsbVaultsListing> =>
  failClosed("runtimeUnavailable", async () => {
    await requireCoordinatorAccess(deps);
    const journal = await access.journal();
    if (journal.status !== "bound") throw journalUnavailable();
    if (journal.writer) throw qsbRefusal("recoveryNotNeeded");
    const owner = await qsbOwnerOf(access);
    const session = qsbAccessSession(deps, access, owner);
    const { vaults } = await session.call((token) => deps.coordinator.vaults(token));
    const jobs = await session.call((token) => deps.coordinator.jobs(token));
    const found = await matchVaults(deps, access, vaults);
    const matches: Match[] = [];
    for (const match of found) matches.push(await withFunding(deps, session, match));
    if (matches.length > 0) {
      const recorded = await recordMatches(access, matches);
      await adoptJobs(access, matches, recorded, jobs);
    }
    return listQsbVaults(deps, access);
  });
