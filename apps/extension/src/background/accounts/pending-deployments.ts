/**
 * Accounts whose sponsored deployment may be in flight (issue 431), kept in
 * browser-local storage so the guard survives a service-worker restart.
 *
 * An entry is made before the relay hears anything and is never aged out. It
 * goes only on a definitive outcome: the chain shows the account deployed, the
 * deploy's recorded transaction was rejected or reverted, or the attempt sent
 * nothing (a determinate refusal). While it stands, every deploy route — the
 * sponsored one, the self-paid one and each automatic deploy-before-send —
 * refuses with {@link DEPLOYMENT_MAY_BE_ON_ITS_WAY}, so a lost or unconfirmed
 * deploy is never retried blind.
 *
 * Reservation is a synchronous check-and-set on the loaded map, so two
 * concurrent submissions in one worker cannot both pass it. Public data only:
 * a network, an address, a time and a transaction hash.
 */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import type { ActivityLog } from "@bramble/transactions/activity";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";

/** Browser-local key for the pending-deployment entries. */
export const PENDING_DEPLOYMENTS_KEY = "bramble:pending-deployments";

/**
 * Refusal while a deployment of the account may still land. Its ending is the
 * shared outcome-unknown sentence, so the panel shows it amber, never "failed".
 */
export const DEPLOYMENT_MAY_BE_ON_ITS_WAY =
  "A sponsored deployment of this account may already be on its way. Check activity before trying again.";

// More accounts than one wallet deploys at once; bounds what a corrupted or
// hostile local value can make the worker hold.
const MAX_ENTRIES = 64;

type Entry = {
  readonly address: string;
  readonly hash?: string;
  readonly networkId: StarknetNetworkId;
  readonly since: number;
};

/** The account a pending entry belongs to. */
export type PendingAccount = { readonly address: string; readonly networkId: StarknetNetworkId };

/**
 * Durable pending-deployment entries. `load` must resolve before `reserve` or
 * `pending` is read; both are synchronous on the loaded map.
 */
export type PendingDeployments = {
  readonly load: () => Promise<void>;
  /** Check-and-set: false when the account already has an entry. */
  readonly reserve: (account: PendingAccount, since: number) => boolean;
  readonly pending: (account: PendingAccount) => Entry | undefined;
  /** Writes the map; a rejection means the entry may not survive a restart. */
  readonly persist: () => Promise<void>;
  readonly recordHash: (account: PendingAccount, hash: string) => Promise<void>;
  readonly release: (account: PendingAccount) => Promise<void>;
};

const keyOf = ({ address, networkId }: PendingAccount): string =>
  `${networkId}:${canonicalFelt(address) ?? address}`;

const isEntry = (value: unknown): value is Entry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "hash", "networkId", "since"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  typeof value["since"] === "number" &&
  Number.isSafeInteger(value["since"]) &&
  value["since"] >= 0 &&
  (value["hash"] === undefined ||
    (typeof value["hash"] === "string" && isNonZeroStarkFieldElement(value["hash"])));

/**
 * Pending deployments over `store`. A stored value that does not validate is
 * dropped entry by entry; an unreadable store loads as empty, which is the
 * state before this guard existed.
 */
export const createPendingDeployments = (store: KeyValueStore): PendingDeployments => {
  const entries = new Map<string, Entry>();
  let loading: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    const snapshot = [...entries.values()];
    writes = writes.catch(() => undefined).then(() => store.set(PENDING_DEPLOYMENTS_KEY, snapshot));
    return writes;
  };
  return {
    load: () => {
      loading ??= store
        .get(PENDING_DEPLOYMENTS_KEY)
        .catch(() => undefined)
        .then((stored) => {
          const valid = Array.isArray(stored) ? stored.filter(isEntry) : [];
          for (const entry of valid.slice(-MAX_ENTRIES)) {
            if (!entries.has(keyOf(entry))) entries.set(keyOf(entry), entry);
          }
        });
      return loading;
    },
    reserve: (account, since) => {
      const key = keyOf(account);
      if (entries.has(key) || entries.size >= MAX_ENTRIES) return false;
      entries.set(key, {
        address: canonicalFelt(account.address) ?? account.address,
        networkId: account.networkId,
        since,
      });
      return true;
    },
    pending: (account) => entries.get(keyOf(account)),
    persist,
    recordHash: (account, hash) => {
      const entry = entries.get(keyOf(account));
      if (!entry) return Promise.resolve();
      entries.set(keyOf(account), { ...entry, hash });
      return persist();
    },
    release: (account) => {
      entries.delete(keyOf(account));
      return persist();
    },
  };
};

/** In-memory pending deployments for tests and storage-less contexts. */
export const memoryPendingDeployments = (): PendingDeployments =>
  createPendingDeployments(createMemoryStore());

/** What a pending entry resolves to against the chain and Activity. */
export type PendingResolution = "clear" | "deployed" | "held";

/**
 * Resolves the account's pending entry, if any. "deployed" when the chain
 * shows the account deployed, "clear" when there is no entry or the deploy's
 * recorded transaction was rejected or reverted (both release the entry), and
 * "held" otherwise — including when the chain cannot be read.
 */
export const resolvePendingDeployment = async (
  deps: {
    readonly activity?: Pick<ActivityLog, "list">;
    readonly pendingDeployments: PendingDeployments;
    readonly runtimeRpc: Pick<RuntimeRpc, "getDeploymentStatus">;
  },
  account: PendingAccount,
  rpcUrls: readonly string[],
): Promise<PendingResolution> => {
  await deps.pendingDeployments.load();
  const entry = deps.pendingDeployments.pending(account);
  if (!entry) return "clear";
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
    .catch(() => null);
  if (deployed === true) {
    await deps.pendingDeployments.release(account).catch(() => undefined);
    return "deployed";
  }
  const rows = entry.hash && deps.activity ? await deps.activity.list().catch(() => []) : [];
  const failed = rows.some(
    (row) =>
      entry.hash !== undefined &&
      sameFelt(row.hash, entry.hash) &&
      (row.status === "rejected" || row.status === "reverted"),
  );
  if (!failed) return "held";
  await deps.pendingDeployments.release(account).catch(() => undefined);
  return "clear";
};

/**
 * Wraps the four `RuntimeRpc` submissions that can deploy an account — the
 * explicit deploy and the deploy-before-invoke inside transfers, invokes and
 * declarations — so each refuses with {@link DEPLOYMENT_MAY_BE_ON_ITS_WAY}
 * while the account's pending entry stands. Everything else passes through.
 */
export const guardDeployments = (
  rpc: RuntimeRpc,
  deps: {
    readonly activity?: Pick<ActivityLog, "list">;
    readonly pendingDeployments: PendingDeployments;
  },
): RuntimeRpc => {
  const guarded =
    <I extends { readonly account: PendingAccount; readonly rpcUrls: readonly string[] }, R>(
      submit: (input: I) => Promise<R>,
    ) =>
    async (input: I): Promise<R> => {
      const state = await resolvePendingDeployment(
        { ...deps, runtimeRpc: rpc },
        input.account,
        input.rpcUrls,
      );
      if (state === "held") throw new WalletError(DEPLOYMENT_MAY_BE_ON_ITS_WAY);
      return submit(input);
    };
  return {
    ...rpc,
    submitAccountDeployment: guarded(rpc.submitAccountDeployment),
    submitDeclareTransaction: guarded(rpc.submitDeclareTransaction),
    submitErc20Transfer: guarded(rpc.submitErc20Transfer),
    submitInvokeTransaction: guarded(rpc.submitInvokeTransaction),
  };
};
