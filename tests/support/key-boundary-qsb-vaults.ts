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
 * is that owner key, which no reply may carry. The withdrawal entries run
 * after the deposit's, over the same vault: its deposit is confirmed, a
 * helper output appears, the job is solved with the stand-in solution, and
 * the release really has Krusty reveal {@link SECRET_QSB_PREIMAGES}.
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
import { FAKE_SOLUTION, solveFakeJob } from "./qsb-withdrawal-fake";

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
  "wallet.quoteQsbWithdrawal",
  "wallet.recoverQsbVaults",
  "wallet.releaseQsbWithdrawal",
  "wallet.resendQsbDeposit",
  "wallet.resendQsbWithdrawal",
  "wallet.reviewQsbWithdrawal",
  "wallet.startQsbWithdrawal",
]);

/**
 * The 15 preimages the catalog's release discloses: the stand-in solution's
 * sorted prefixes of vault 0, as real Krusty reveals them. No reply may ever
 * carry one; the fake `finish` receiving them proves the release ran.
 */
export const SECRET_QSB_PREIMAGES: readonly string[] = await krusty.revealQsbPreimages(
  SECRET_QSB_MNEMONIC,
  0,
  [...FAKE_SOLUTION.round1].sort((a, b) => a - b).slice(0, 8),
  [...FAKE_SOLUTION.round2].sort((a, b) => a - b).slice(0, 7),
);

/** The destination the catalog's withdrawal pays: BIP-84's published vector. */
export const KEY_BOUNDARY_QSB_DESTINATION = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

/** Whether `message` is one of the eleven QSB vault and withdrawal requests. */
export const isQsbVaultMessage = (message: Record<string, unknown>): boolean =>
  QSB_VAULT_MESSAGES.has(message["type"]);

/** The amount the catalog's quote and deposit entries name, in satoshis. */
export const KEY_BOUNDARY_QSB_AMOUNT = 50_000;

/** The fee the coordinator quotes now for the catalog's deposit, through `handler`. */
const qsbDepositFee = async (
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

type Handler = (message: unknown, sender: typeof extensionSender) => Promise<unknown>;

/**
 * Makes the catalog's deposit withdrawable: the chain confirms every deposit
 * the coordinator holds, a listing records it, and a helper output appears.
 */
const qsbConfirmDeposit = async (handler: Handler, state: FakeCoordinatorState): Promise<void> => {
  for (const { vault } of state.vaults.values()) {
    const funding = vault["funding"] as { readonly txid?: string } | undefined;
    if (funding?.txid) state.confirmed.add(funding.txid);
  }
  await handler({ accountId: qsbAccount.id, type: "wallet.qsbVaults" }, extensionSender);
  state.utxos.push(...paymentToAddress(state.owner, [3_000], "key boundary helper"));
};

/** The fee the coordinator quotes now for the catalog's withdrawal. */
const qsbWithdrawalFee = async (handler: Handler): Promise<number> => {
  const reply = (await handler(
    {
      accountId: qsbAccount.id,
      destination: KEY_BOUNDARY_QSB_DESTINATION,
      type: "wallet.quoteQsbWithdrawal",
      v: KEY_BOUNDARY_QSB_VAULT,
    },
    extensionSender,
  )) as { readonly quote?: { readonly feeSat?: number } };
  const fee = reply.quote?.feeSat;
  if (typeof fee !== "number")
    throw new Error("the key-boundary QSB withdrawal quote did not answer");
  return fee;
};

/** Solves the catalog's withdrawal job with the stand-in solution. */
const qsbSolveWithdrawal = (state: FakeCoordinatorState): void => {
  const [jobId] = state.jobs.keys();
  if (!jobId) throw new Error("the key-boundary QSB withdrawal has no job");
  solveFakeJob(state, jobId, { ...FAKE_SOLUTION });
};

/** The digest the catalog's withdrawal review reports now. */
const qsbWithdrawalDigest = async (handler: Handler): Promise<string> => {
  const reply = (await handler(
    { accountId: qsbAccount.id, type: "wallet.reviewQsbWithdrawal", v: KEY_BOUNDARY_QSB_VAULT },
    extensionSender,
  )) as { readonly review?: { readonly digest?: string } };
  const digest = reply.review?.digest;
  if (typeof digest !== "string") throw new Error("the key-boundary QSB review did not answer");
  return digest;
};

/** The scan's QSB live identifiers over `handler` and the coordinator's state. */
export const qsbLiveIds = (handler: Handler, state: FakeCoordinatorState) => ({
  qsbConfirmDeposit: () => qsbConfirmDeposit(handler, state),
  qsbDepositFee: () => qsbDepositFee(handler),
  qsbSolveWithdrawal: () => qsbSolveWithdrawal(state),
  qsbWithdrawalDigest: () => qsbWithdrawalDigest(handler),
  qsbWithdrawalFee: () => qsbWithdrawalFee(handler),
});

/** What a harness wires: the deps, the session method, and the coordinator's state. */
export type KeyBoundaryQsbVaults = {
  readonly deps: QsbVaultDeps;
  /** Every preimage the stand-in `finish` was handed. */
  readonly finished: () => readonly string[];
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
  const runtime = fakeQsbRuntime();
  return {
    finished: () => [...runtime.finished],
    deps: {
      coordinator: createQsbCoordinator({ fetch: fakeQsbFetch(state, now) }),
      coordinatorAccess: async () => true,
      drawJobId: () => crypto.randomUUID(),
      drawVaultId: () => crypto.randomUUID(),
      locks: createQsbAccountLocks(),
      now,
      runtime,
      sessions: createQsbSessions({ now }),
    },
    state,
    withQsbVaultAccount: (input, task) => service.withQsbVaultAccount(input, task),
  };
};
