/**
 * Bounded watch-asset admission plus validated token assembly. On-chain
 * metadata is authoritative; dapp-provided options are used only as a fallback.
 */
import { WalletError } from "@bramble/core/errors";
import {
  isSafeDecimals,
  isTokenName,
  isTokenSymbol,
  normalizeTokenSymbol,
} from "@bramble/core/json";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import {
  canonicalAddress,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import type { ProviderWatchAsset } from "@bramble/wallet-protocol/watch-asset";
import {
  MAX_PENDING_APPROVALS,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue, PendingApproval, WatchAssetToken } from "../approvals/approvals";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";

/**
 * Capability for one deduplicated watch-asset metadata lookup admitted ahead
 * of its RPC. Inputs are background-validated; cap failures reject without
 * starting the supplied operation.
 */
export type WatchAssetAdmission = {
  /**
   * Throws the queue's refusal when `origin` could not queue one more
   * watch-asset request for `address`, unless one for the same address is
   * already queued or in flight (that request is shared, not added). It reads
   * only the queue, never wallet state, so a site at its cap gets the same
   * refusal whatever the wallet tracks (audit M1).
   */
  readonly precheck: (input: {
    readonly address: string;
    readonly origin: string;
    readonly queued: readonly PendingApproval[];
  }) => void;
  readonly run: (
    input: {
      readonly key: string;
      readonly origin: string;
      readonly queued: readonly { readonly origin: string }[];
    },
    operation: () => Promise<PendingApproval | null>,
  ) => Promise<PendingApproval | null>;
};

/**
 * Creates the worker-local preflight gate for watch-asset metadata. Queue and
 * preflight counts share the approval caps, while identical work shares one
 * promise. The slot is released on both success and failure.
 */
export const createWatchAssetAdmission = (): WatchAssetAdmission => {
  const pending = new Map<
    string,
    { readonly origin: string; readonly result: Promise<PendingApproval | null> }
  >();
  const requireCapacity = (
    origin: string,
    queued: readonly { readonly origin: string }[],
  ): void => {
    const queuedForOrigin = queued.filter((approval) => approval.origin === origin).length;
    const pendingForOrigin = [...pending.values()].filter(
      (entry) => entry.origin === origin,
    ).length;
    if (queuedForOrigin + pendingForOrigin >= MAX_PENDING_APPROVALS_PER_ORIGIN) {
      throw new WalletError("Too many pending approvals for this site");
    }
    if (queued.length + pending.size >= MAX_PENDING_APPROVALS) {
      throw new WalletError("Too many pending approvals");
    }
  };
  return {
    precheck({ address, origin, queued }) {
      const shared =
        queued.some(
          (approval) =>
            approval.kind === "watch-asset" &&
            approval.origin === origin &&
            approval.token?.address === address,
        ) ||
        [...pending.entries()].some(
          ([key, entry]) => entry.origin === origin && key.endsWith(`\n${address}`),
        );
      if (!shared) requireCapacity(origin, queued);
    },
    run(input, operation) {
      const existing = pending.get(input.key);
      if (existing) {
        return existing.result;
      }
      requireCapacity(input.origin, input.queued);
      const result = Promise.resolve().then(operation);
      pending.set(input.key, { origin: input.origin, result });
      const release = (): void => {
        if (pending.get(input.key)?.result === result) {
          pending.delete(input.key);
        }
      };
      void result.then(release, release);
      return result;
    },
  };
};

/**
 * Deduplicates and admits one watch-asset lookup before doing its RPC work.
 * It returns null for unusable metadata and throws on admission failure; it
 * never exposes metadata or approval state outside the background worker.
 */
const requestWatchAssetApproval = async (input: {
  readonly admission: WatchAssetAdmission;
  readonly approvals: Pick<ApprovalQueue, "list" | "requestWatchAsset">;
  readonly asset: ProviderWatchAsset;
  readonly getMetadata: () => Promise<WatchAssetMetadata | null>;
  readonly isTracked: () => boolean;
  readonly networkId: StarknetNetworkId;
  readonly normalizedAddress: string;
  readonly origin: string;
}): Promise<PendingApproval | null> => {
  const queued = input.approvals.list();
  const existing = queued.find(
    (approval) =>
      approval.kind === "watch-asset" &&
      approval.origin === input.origin &&
      approval.token?.address === input.normalizedAddress &&
      approval.token.networkId === input.networkId,
  );
  if (existing) return existing;
  return input.admission.run(
    {
      key: `${input.origin}\n${input.networkId}\n${input.normalizedAddress}`,
      origin: input.origin,
      queued,
    },
    async () => {
      const token = watchAssetToken(
        input.asset,
        await input.getMetadata().catch(() => null),
        input.networkId,
      );
      if (!token) return null;
      // A token the wallet already tracks still waits for the user, on a
      // close-only notice queued exactly where its card would be (audit M1).
      const pending = input.approvals.requestWatchAsset({
        ...(input.isTracked() ? { alreadyTracked: true } : {}),
        origin: input.origin,
        token,
      });
      notifyApprovalsChanged();
      return pending;
    },
  );
};

/**
 * Resolves and admits one validated dapp watch-asset request. Null means the
 * address or its on-chain metadata is unusable; a returned approval still
 * requires the caller to park its response behind the user.
 *
 * No answer depends on what the wallet tracks before the user acts (audit M1):
 * the per-origin cap is checked before preferences are read, the metadata
 * lookup runs for tracked and untracked tokens alike, and an already-tracked
 * token is held on a close-only notice whose Close answers `watched: true`.
 * Only the notice/card choice reads the tracked list, and only the user sees it.
 */
export const trackWatchAsset = async (
  deps: {
    readonly admission: WatchAssetAdmission;
    readonly approvals: ApprovalQueue;
    readonly preferencesStore: WalletPreferencesStore;
    readonly runtimeRpc: RuntimeRpc;
  },
  input: { readonly asset: ProviderWatchAsset; readonly origin: string },
): Promise<PendingApproval | null> => {
  const normalizedAddress = canonicalAddress(input.asset.address);
  if (!normalizedAddress) return null;
  deps.admission.precheck({
    address: normalizedAddress,
    origin: input.origin,
    queued: deps.approvals.list(),
  });
  const preferences = await deps.preferencesStore.read();
  const networkId = preferences.activeNetworkId;
  return requestWatchAssetApproval({
    admission: deps.admission,
    approvals: deps.approvals,
    asset: input.asset,
    getMetadata: () =>
      deps.runtimeRpc.getTokenMetadata({
        address: input.asset.address,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], preferences),
      }),
    isTracked: () =>
      preferences.tokens.some(
        (token) =>
          token.networkId === networkId && canonicalAddress(token.address) === normalizedAddress,
      ),
    networkId,
    normalizedAddress,
    origin: input.origin,
  });
};

/**
 * On-chain ERC20 metadata resolved before queueing, when available.
 */
export type WatchAssetMetadata = {
  readonly decimals: number;
  readonly name: string;
  readonly symbol: string;
};

/**
 * Builds a validated watch-asset token from on-chain metadata and dapp options,
 * or returns null when the token cannot satisfy the wallet token contract.
 * Without on-chain metadata there is no token, because the site's options
 * cannot be trusted for the decimals.
 *
 * The address is canonicalized through the shared {@link canonicalAddress} so a
 * dapp cannot register a second record for a token the wallet already tracks by
 * spelling it differently.
 */
export const watchAssetToken = (
  request: ProviderWatchAsset,
  metadata: WatchAssetMetadata | null,
  networkId: StarknetNetworkId,
): WatchAssetToken | null => {
  const address = canonicalAddress(request.address);
  if (address === null) {
    return null;
  }
  // Decimals set the scale of every amount later shown for this token, so they
  // come from the chain or not at all: a site's own `decimals` could make a
  // large transfer read as a negligible one (Sherlock 125). With no on-chain
  // read there is no token.
  if (metadata === null) {
    return null;
  }
  const { decimals } = metadata;
  const symbol = normalizeTokenSymbol(metadata.symbol);
  // The on-chain name wins when it is usable, cut to 64 characters as
  // `wallet.addToken` stores it. An empty or over-long one no longer refuses a
  // token `wallet.addToken` would accept: it falls back to the site's name, then
  // the symbol (Sherlock 252). A name the site sends is still refused when it
  // is not a valid token name.
  const onChainName = metadata.name?.trim().slice(0, 64);
  const name = isTokenName(onChainName) ? onChainName : (request.name?.trim() ?? symbol);
  if (!isTokenSymbol(symbol) || !isTokenName(name) || !isSafeDecimals(decimals)) {
    return null;
  }
  return { address, decimals, name, networkId, symbol };
};
