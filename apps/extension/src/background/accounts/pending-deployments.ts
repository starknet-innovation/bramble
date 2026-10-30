/**
 * Sponsored deployment attempts (issue 431), kept in browser-local storage so
 * a worker restart does not drop them.
 *
 * An entry is made before the relay hears anything and opens a bounded hold
 * ({@link SPONSORED_DEPLOY_HOLD_MS}). During the hold every deploy route — the
 * sponsored one, the self-paid one and each automatic deploy-before-send —
 * refuses with {@link DEPLOYMENT_IN_PROGRESS}. The hold ends early when
 * the chain shows the account deployed or the attempt's recorded transaction
 * was rejected or reverted while the chain still shows the account undeployed.
 * The relay's hash is its claim, never proof: "deployed" means the chain shows
 * the expected class at the stored address. After it, self-paid deploys go ahead: a duplicate
 * deploy never costs the user (a DEPLOY_ACCOUNT to a taken address is rejected
 * before it is charged; a sponsor deploy that loses the race reverts at the
 * sponsor's cost — verify on Sepolia before enabling). So the hold only stops
 * an immediate double press, and it can never lock an account.
 *
 * The entry outlives its hold as a marker: an account whose sponsored attempt
 * was accepted or lost is never offered sponsorship again. A marker is never
 * evicted; it is deleted only when the account is deployed. An attempt the
 * gateway refused for a reason with a known window (nothing sent) becomes a
 * refusal record instead: no hold, and no offer for that account until the
 * window ends ({@link refusalWindowEnd}); it is then deleted. Any other
 * attempt that sent nothing is deleted. An unreadable store (or one holding more than
 * {@link PENDING_DEPLOYMENTS_LIMIT} entries) loads as empty and marks itself
 * unreadable: no hold, so self-paid deploys and sends go ahead, but no
 * sponsorship either, since an attempt it lost could otherwise be sent again.
 *
 * Reservation is a synchronous check-and-set on the loaded map, so two
 * submissions in one worker cannot both pass it. Public data only: a network,
 * an address, two times and a transaction hash.
 */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { DEPLOYMENT_IN_PROGRESS } from "@bramble/privacy/sponsored-deploy";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { type ActivityLog, systemClock } from "@bramble/transactions/activity";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";

/** Browser-local key for the sponsored-attempt entries. */
export const PENDING_DEPLOYMENTS_KEY = "bramble:pending-deployments";

/** How long a sponsored attempt holds every deploy route of its account. */
export const SPONSORED_DEPLOY_HOLD_MS = 3 * 60_000;

/** What every deploy route answers during the hold; owned by the client. */
export { DEPLOYMENT_IN_PROGRESS };

const DAY_MS = 86_400_000;

/**
 * The first 00:00 UTC after `now` (epoch milliseconds), when the gateway's
 * daily sponsorship budget resets. Pure: the caller supplies the clock.
 */
export const nextUtcMidnight = (now: number): number => (Math.floor(now / DAY_MS) + 1) * DAY_MS;

/** The gateway's per-address window between sponsored attempts. */
export const SPONSORED_ATTEMPT_WINDOW_MS = 3_600_000;

/**
 * When to offer sponsorship again after the gateway refused with `reason` (its
 * JSON-RPC error message), or null for no record: the daily budget spent
 * waits for the next 00:00 UTC, an attempt already made this hour waits an
 * hour, and anything else (a rate limit, an unknown code) is not remembered.
 * Only how long offers stop depends on it, never whether anything was sent.
 */
export const refusalWindowEnd = (reason: string, now: number): number | null => {
  if (reason === "sponsorship_budget_exhausted") return nextUtcMidnight(now);
  if (reason === "sponsored_deploy_already_attempted") return now + SPONSORED_ATTEMPT_WINDOW_MS;
  return null;
};

/**
 * Most entries kept. Far more accounts than one wallet sponsors; a full store
 * refuses new sponsored attempts rather than evicting a marker.
 */
export const PENDING_DEPLOYMENTS_LIMIT = 256;

type Entry = {
  readonly address: string;
  readonly hash?: string;
  readonly holdUntil: number;
  readonly networkId: StarknetNetworkId;
  /** Set on a refusal record: no offer before this time (epoch ms). */
  readonly refusedUntil?: number;
  readonly since: number;
};

/** The account an entry belongs to. */
type PendingAccount = { readonly address: string; readonly networkId: StarknetNetworkId };

/** An entry's account with the class its deployment must put at the address. */
export type AttemptAccount = PendingAccount & { readonly classHash: string };

/**
 * Durable sponsored-attempt entries. `load` must resolve before `reserve` or
 * `entry` is read; both are synchronous on the loaded map.
 */
export type PendingDeployments = {
  readonly load: () => Promise<void>;
  /** Whether the last load read the store; false means no sponsorship. */
  readonly readable: () => boolean;
  /**
   * Check-and-set: "exists" when the account already has an entry, "full"
   * at {@link PENDING_DEPLOYMENTS_LIMIT} or when the store was unreadable.
   */
  readonly reserve: (account: PendingAccount, now: number) => "exists" | "full" | "reserved";
  readonly entry: (account: PendingAccount) => Entry | undefined;
  /** Writes the map; a rejection means the entry may not survive a restart. */
  readonly persist: () => Promise<void>;
  readonly recordHash: (account: PendingAccount, hash: string) => Promise<void>;
  /**
   * Turns the account's entry into a refusal record: the sponsor said no and
   * nothing was sent, so no hold, and no offer before `until`.
   */
  readonly recordRefusal: (account: PendingAccount, now: number, until: number) => Promise<void>;
  /** Ends the hold early but keeps the marker. */
  readonly endHold: (account: PendingAccount) => Promise<void>;
  /** Deletes the entry: the account is deployed, or the attempt sent nothing. */
  readonly forget: (account: PendingAccount) => Promise<void>;
};

const keyOf = ({ address, networkId }: PendingAccount): string =>
  `${networkId}:${canonicalFelt(address) ?? address}`;

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isEntry = (value: unknown): value is Entry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "hash", "holdUntil", "networkId", "refusedUntil", "since"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isTime(value["since"]) &&
  isTime(value["holdUntil"]) &&
  (value["refusedUntil"] === undefined || isTime(value["refusedUntil"])) &&
  (value["hash"] === undefined ||
    (typeof value["hash"] === "string" && isNonZeroStarkFieldElement(value["hash"])));

// The valid entries of a stored value, or null when it holds more than the
// limit: an oversized value is treated as unreadable rather than trimmed, since
// trimming would drop markers.
const storedEntries = (stored: unknown): readonly Entry[] | null => {
  const valid = Array.isArray(stored) ? stored.filter(isEntry) : [];
  return valid.length > PENDING_DEPLOYMENTS_LIMIT ? null : valid;
};

/**
 * Sponsored attempts over `store`. A stored value that does not validate is
 * dropped entry by entry; an unreadable store loads as empty.
 */
export const createPendingDeployments = (store: KeyValueStore): PendingDeployments => {
  const entries = new Map<string, Entry>();
  let readable = false;
  let loading: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    const snapshot = [...entries.values()];
    writes = writes.catch(() => undefined).then(() => store.set(PENDING_DEPLOYMENTS_KEY, snapshot));
    return writes;
  };
  const update = (account: PendingAccount, change: Partial<Entry>): Promise<void> => {
    const entry = entries.get(keyOf(account));
    if (!entry) return Promise.resolve();
    entries.set(keyOf(account), { ...entry, ...change });
    return persist();
  };
  return {
    load: () => {
      loading ??= store.get(PENDING_DEPLOYMENTS_KEY).then(
        (stored) => {
          const valid = storedEntries(stored);
          if (!valid) return;
          for (const entry of valid) {
            if (!entries.has(keyOf(entry))) entries.set(keyOf(entry), entry);
          }
          readable = true;
        },
        () => undefined,
      );
      return loading;
    },
    readable: () => readable,
    reserve: (account, now) => {
      const key = keyOf(account);
      if (entries.has(key)) return "exists";
      // Expired refusal records are the only entries a full store may shed.
      for (const [stored, entry] of entries) {
        if (entry.refusedUntil !== undefined && now >= entry.refusedUntil) entries.delete(stored);
      }
      if (!readable || entries.size >= PENDING_DEPLOYMENTS_LIMIT) return "full";
      entries.set(key, {
        address: canonicalFelt(account.address) ?? account.address,
        holdUntil: now + SPONSORED_DEPLOY_HOLD_MS,
        networkId: account.networkId,
        since: now,
      });
      return "reserved";
    },
    entry: (account) => entries.get(keyOf(account)),
    persist,
    recordHash: (account, hash) => update(account, { hash }),
    recordRefusal: (account, now, until) => {
      entries.set(keyOf(account), {
        address: canonicalFelt(account.address) ?? account.address,
        holdUntil: 0,
        networkId: account.networkId,
        refusedUntil: until,
        since: now,
      });
      return persist();
    },
    endHold: (account) => update(account, { holdUntil: 0 }),
    forget: (account) => {
      entries.delete(keyOf(account));
      return persist();
    },
  };
};

/** In-memory sponsored attempts for tests and storage-less contexts. */
export const memoryPendingDeployments = (): PendingDeployments =>
  createPendingDeployments(createMemoryStore());

/**
 * What the account's sponsored attempt means now: "none" (no attempt),
 * "deployed" (the chain shows the account deployed), "held" (inside the hold),
 * "may-land" (the hold is over and the account is not confirmed deployed), or
 * "refused" (the sponsor said no within its window; nothing was sent).
 */
export type SponsoredAttempt = "deployed" | "held" | "may-land" | "none" | "refused";

type AttemptDeps = {
  readonly activity?: Pick<ActivityLog, "list">;
  readonly pendingDeployments: PendingDeployments;
  readonly runtimeRpc: Pick<RuntimeRpc, "verifyAccountClassHash">;
};

/**
 * What the chain shows at the account's stored address: "deployed" only for
 * the expected class there, "undeployed" only for a confirmed empty address.
 * Another class, a failed read, or no class reader wired is "unknown".
 */
const accountOnChain = async (
  rpc: Pick<RuntimeRpc, "verifyAccountClassHash">,
  account: AttemptAccount,
  rpcUrls: readonly string[],
): Promise<"deployed" | "undeployed" | "unknown"> => {
  const verification = await rpc
    .verifyAccountClassHash?.({
      accountAddress: account.address,
      expectedClassHash: account.classHash,
      rpcUrls,
    })
    .catch(() => null);
  if (verification?.status === "verified") return "deployed";
  return verification?.status === "undeployed" ? "undeployed" : "unknown";
};

// Whether the attempt's own recorded transaction has failed on chain.
const attemptFailed = async (deps: AttemptDeps, hash: string | undefined): Promise<boolean> => {
  if (hash === undefined || !deps.activity) return false;
  const rows = await deps.activity.list().catch(() => []);
  return rows.some(
    (row) => sameFelt(row.hash, hash) && (row.status === "rejected" || row.status === "reverted"),
  );
};

/**
 * Resolves the account's sponsored attempt against the chain and Activity. The
 * expected class at the stored address deletes the entry ("deployed"). A failed
 * attempt transaction ends the hold early only while the chain confirms the
 * address empty: the relay's hash alone proves nothing about this account. An
 * unreadable chain is neither deployed nor undeployed.
 */
export const sponsoredAttemptState = async (
  deps: AttemptDeps,
  account: AttemptAccount,
  rpcUrls: readonly string[],
  now: number,
): Promise<SponsoredAttempt> => {
  await deps.pendingDeployments.load();
  const entry = deps.pendingDeployments.entry(account);
  if (!entry) return "none";
  // A refusal sent nothing, so there is nothing on chain to wait for.
  if (entry.refusedUntil !== undefined) {
    if (now < entry.refusedUntil) return "refused";
    await deps.pendingDeployments.forget(account).catch(() => undefined);
    return "none";
  }
  const chain = await accountOnChain(deps.runtimeRpc, account, rpcUrls);
  if (chain === "deployed") {
    await deps.pendingDeployments.forget(account).catch(() => undefined);
    return "deployed";
  }
  if (now >= entry.holdUntil) return "may-land";
  if (chain !== "undeployed" || !(await attemptFailed(deps, entry.hash))) return "held";
  await deps.pendingDeployments.endHold(account).catch(() => undefined);
  return "may-land";
};

/**
 * Wraps the four `RuntimeRpc` submissions that can deploy an account — the
 * explicit deploy and the deploy-before-invoke inside transfers, invokes and
 * declarations — so each refuses with {@link DEPLOYMENT_IN_PROGRESS}
 * during the account's hold. Outside a hold nothing is read and everything
 * passes through.
 */
export const guardDeployments = (
  rpc: RuntimeRpc,
  deps: {
    readonly activity?: Pick<ActivityLog, "list">;
    readonly now?: () => number;
    readonly pendingDeployments: PendingDeployments;
  },
): RuntimeRpc => {
  const now = deps.now ?? systemClock;
  const guarded =
    <I extends { readonly account: AttemptAccount; readonly rpcUrls: readonly string[] }, R>(
      submit: (input: I) => Promise<R>,
    ) =>
    async (input: I): Promise<R> => {
      await deps.pendingDeployments.load();
      const entry = deps.pendingDeployments.entry(input.account);
      const at = now();
      if (entry && at < entry.holdUntil) {
        const state = await sponsoredAttemptState(
          { ...deps, runtimeRpc: rpc },
          input.account,
          input.rpcUrls,
          at,
        );
        if (state === "held") throw new WalletError(DEPLOYMENT_IN_PROGRESS);
      }
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
