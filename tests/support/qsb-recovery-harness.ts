/**
 * The QSB recovery harness: the install that created a QSB vault
 * (./qsb-withdrawal-harness) funded deposit 0, started its withdrawal and saw
 * the search finish, then was lost; a fresh install imported the same phrase.
 * Both share one stand-in coordinator, so the fresh install's coordinator
 * holds the lost writer's vault and job. Real Krusty and real vault services
 * on both sides; every value is public test data.
 */
import { createHash } from "node:crypto";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type { QsbWithdrawalQuote } from "@bramble/wallet-model/qsb-withdrawals";
import { QSB_HARNESS_PASSPHRASE, type QsbVaultHarness, qsbVaultHarness } from "./qsb-vault-harness";
import type { FakeJob } from "./qsb-withdrawal-fake";
import { type QsbWithdrawalHarness, qsbWithdrawalHarness } from "./qsb-withdrawal-harness";

/** The lost writer, the fresh read-only install, and the fresh install's calls. */
export type QsbRecoveryHarness = {
  /** The lost writer's harness (its coordinator world is shared). */
  readonly writer: QsbWithdrawalHarness;
  /** The fresh install, `qsb-1` imported from the same phrase. */
  readonly restored: QsbVaultHarness;
  readonly quote: QsbWithdrawalQuote;
  /** `wallet.recoverQsbVaults` on the fresh install. */
  readonly recover: () => Promise<Record<string, unknown>>;
  /** The fresh install's vault list. */
  readonly vaults: () => Promise<readonly QsbVaultView[]>;
  readonly review: () => Promise<Record<string, unknown>>;
  readonly release: (digest: string, emergency: boolean) => Promise<Record<string, unknown>>;
  /** Replaces fields of the lost writer's job, re-hashing its manifest unless `rehash` is false. */
  readonly editJob: (
    edit: (job: FakeJob) => Partial<FakeJob>,
    options?: { readonly rehash?: boolean },
  ) => void;
};

// The canonical hash the coordinator gives a schema-ordered manifest.
const fakeManifestHash = (manifest: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

/**
 * Builds the harness. With `solved` false the writer's search is still
 * running when it is lost.
 */
export const qsbRecoveryHarness = async (
  options: { readonly solved?: boolean } = {},
): Promise<QsbRecoveryHarness> => {
  const writer = await qsbWithdrawalHarness();
  const quote = await writer.quote();
  await writer.start(quote.feeSat);
  if (options.solved !== false) writer.solve();
  const restored = await qsbVaultHarness({ imported: true, state: writer.state });
  const send = async (message: Record<string, unknown>) =>
    (await restored.send({ accountId: "qsb-1", ...message })) as Record<string, unknown>;
  return {
    editJob: (edit, { rehash = true } = {}) => {
      const job = writer.state.jobs.get(writer.jobId());
      if (!job) throw new Error("no withdrawal job");
      const next = { ...job, ...edit(job) };
      writer.state.jobs.set(job.id, {
        ...next,
        manifestHash: rehash ? fakeManifestHash(next.manifest) : next.manifestHash,
      });
    },
    quote,
    recover: () => send({ type: "wallet.recoverQsbVaults" }),
    release: (digest, emergency) =>
      send({
        digest,
        emergency,
        passphrase: QSB_HARNESS_PASSPHRASE,
        type: "wallet.releaseQsbWithdrawal",
        v: 0,
      }),
    restored,
    review: () => send({ type: "wallet.reviewQsbWithdrawal", v: 0 }),
    vaults: async () =>
      ((await send({ type: "wallet.qsbVaults" })) as { readonly vaults: readonly QsbVaultView[] })
        .vaults,
    writer,
  };
};
