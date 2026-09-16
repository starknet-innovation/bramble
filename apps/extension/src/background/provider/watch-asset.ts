/**
 * Bounded watch-asset admission plus validated token assembly. On-chain
 * metadata is authoritative; dapp-provided options are used only as a fallback.
 */
import { WalletError } from "@bramble/core/errors";
import { isSafeDecimals, isTokenName, isTokenSymbol } from "@bramble/core/json";
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
  return {
    run(input, operation) {
      const existing = pending.get(input.key);
      if (existing) {
        return existing.result;
      }
      const queuedForOrigin = input.queued.filter(
        (approval) => approval.origin === input.origin,
      ).length;
      const pendingForOrigin = [...pending.values()].filter(
        (entry) => entry.origin === input.origin,
      ).length;
      if (queuedForOrigin + pendingForOrigin >= MAX_PENDING_APPROVALS_PER_ORIGIN) {
        throw new WalletError("Too many pending approvals for this site");
      }
      if (input.queued.length + pending.size >= MAX_PENDING_APPROVALS) {
        throw new WalletError("Too many pending approvals");
      }
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
      const pending = input.approvals.requestWatchAsset({ origin: input.origin, token });
      notifyApprovalsChanged();
      return pending;
    },
  );
};

/**
 * Resolves and admits one validated dapp watch-asset request. True means the
 * token was already tracked, null means metadata was unusable, and a returned
 * approval still requires the caller to park its response behind user consent.
 */
export const trackWatchAsset = async (
  deps: {
    readonly admission: WatchAssetAdmission;
    readonly approvals: ApprovalQueue;
    readonly preferencesStore: WalletPreferencesStore;
    readonly runtimeRpc: RuntimeRpc;
  },
  input: { readonly asset: ProviderWatchAsset; readonly origin: string },
): Promise<PendingApproval | true | null> => {
  const preferences = await deps.preferencesStore.read();
  const networkId = preferences.activeNetworkId;
  const normalizedAddress = canonicalAddress(input.asset.address);
  if (!normalizedAddress) return null;
  if (
    preferences.tokens.some(
      (token) =>
        token.networkId === networkId && canonicalAddress(token.address) === normalizedAddress,
    )
  ) {
    return true;
  }
  const approval = await requestWatchAssetApproval({
    admission: deps.admission,
    approvals: deps.approvals,
    asset: input.asset,
    getMetadata: () =>
      deps.runtimeRpc.getTokenMetadata({
        address: input.asset.address,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], preferences),
      }),
    networkId,
    normalizedAddress,
    origin: input.origin,
  });
  return approval;
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
  const rawSymbol = metadata?.symbol ?? request.symbol;
  const decimals = metadata?.decimals ?? request.decimals;
  if (typeof rawSymbol !== "string" || decimals === undefined) {
    return null;
  }
  const symbol = rawSymbol.trim().toUpperCase();
  const name = (metadata?.name ?? request.name ?? symbol).trim();
  if (!isTokenSymbol(symbol) || !isTokenName(name) || !isSafeDecimals(decimals)) {
    return null;
  }
  return { address, decimals, name, networkId, symbol };
};
