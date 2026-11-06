/**
 * Unlocked scope for one multisig STRK20 action. The shared scalar stays in
 * this module: callers receive a signer callback and records, never the scalar.
 */

import { WalletError } from "@bramble/core/errors";
import type { Strk20NetworkConfig } from "@bramble/privacy/config";
import {
  type MultisigStrk20ActionRequest,
  type MultisigStrk20Authorization,
  type MultisigStrk20RedactedCall,
  multisigStrk20CallSetAggregate,
  multisigStrk20CallSetHash,
  withMultisigStrk20Fragment,
} from "@bramble/privacy/multisig-strk20";
import { redactStrk20Calldata } from "@bramble/privacy/multisig-strk20-redaction";
import {
  multisigStrk20Summary,
  reviewMultisigStrk20Calls,
} from "@bramble/privacy/multisig-strk20-review";
import type { MultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import type { Strk20AccountContext } from "@bramble/privacy/service";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { withRpcFallback } from "@bramble/starknet/provider";
import { readMultisigStrk20KeyPackage } from "@bramble/vault/multisig-strk20-key";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import { signerForContext } from "../accounts/wallet-ops";
import { activeAccountContext } from "../runtime/runtime-state";
import { captureSessionAuthorization } from "../runtime/session";
import { type ArgentMultisigContext, contextFor } from "./multisig-context";
import type { MultisigOpsDeps } from "./multisig-deps";
import { currentConfigFor } from "./multisig-ops";
import { multisigStrk20ReviewScope } from "./multisig-strk20-scope";

/** Thrown when co-owners still have to authorize the pool CallSet. */
export const MULTISIG_STRK20_WAITING = "Waiting for co-owners to authorize this private action.";

/**
 * Refusal to register or deposit while this wallet holds the only copy of the
 * viewing key. Losing that copy would lock the private balance for everyone.
 */
export const MULTISIG_STRK20_SHARE_FIRST = "Share the key with a co-owner first.";

/** Refusal when this multisig already has as many open private rounds as it can keep. */
export const MULTISIG_STRK20_FULL = "Argent multisig has a pending or unresolved operation";

/** Thrown when the pool would reject the stored proof. */
export const MULTISIG_STRK20_PROOF_EXPIRED = "This private transaction expired. Refresh it.";

/**
 * Everything a prove or refresh needs, with the scalar closed over.
 */
export type MultisigStrk20Session = {
  readonly chainId: string;
  readonly config: Awaited<ReturnType<typeof currentConfigFor>>;
  readonly context: ArgentMultisigContext;
  readonly isAuthorized: () => boolean;
  readonly poolAddress: string;
  /** Records which action the next CallSet authorization belongs to. */
  readonly prepareRequest: (request: MultisigStrk20ActionRequest) => void;
  readonly privacyConfig: Strk20NetworkConfig;
  /**
   * Account context for a private-balance read. The scalar stays inside this
   * session; callers must not persist or return it.
   */
  readonly readContext: () => Strk20AccountContext;
  /** Shared scalar for the privacy service. Callers must not persist or return it. */
  readonly readScalar: () => Promise<string>;
  readonly signCallSet: (messageHash: string, calls: readonly Call[]) => Promise<string[]>;
  readonly store: MultisigStrk20Store;
  readonly strk20: NonNullable<MultisigOpsDeps["runtimeRpc"]["strk20"]>;
  readonly waitingId: () => string | null;
  /** Account view the privacy service reads. It is not a vault account. */
  readonly privacyAccount: Strk20AccountContext["account"];
};

const requireStoredAuthorization = (stored: string): void => {
  if (stored === "stored") return;
  throw new WalletError(
    stored === "unauthorized"
      ? "wallet locked"
      : stored === "full"
        ? MULTISIG_STRK20_FULL
        : "Invalid Argent multisig private proof",
  );
};

const redactedCalls = (
  calls: readonly Call[],
  scalar: string,
): readonly MultisigStrk20RedactedCall[] | null => {
  const redacted = calls.map((call) => {
    const contractAddress = canonicalFelt(String(call.contractAddress));
    const source = Array.isArray(call.calldata) ? call.calldata : [];
    const calldata = redactStrk20Calldata(
      source.map((felt) => String(felt)),
      scalar,
    );
    return contractAddress && calldata
      ? { calldata, contractAddress, entrypoint: call.entrypoint }
      : null;
  });
  return redacted.every((call) => call !== null) ? redacted : null;
};

/**
 * Opens a session for `multisigId` on the active network. Fails closed when
 * the wallet is locked, the pool is unset, or this wallet has no scalar.
 */
export const openMultisigStrk20Session = async (
  deps: MultisigOpsDeps,
  multisigId: string,
): Promise<{ readonly error: string } | MultisigStrk20Session> => {
  const store = deps.strk20MultisigStore;
  const strk20 = deps.runtimeRpc.strk20;
  if (!store || !strk20?.prepare || !strk20.poolFee) {
    return { error: "Private balances are not configured for this network" };
  }
  const authorized = captureSessionAuthorization(deps.session);
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  const resolved = await contextFor(deps, active, multisigId);
  if ("error" in resolved) return resolved;
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const preferences = await deps.preferencesStore.read();
  const privacyConfig = preferences.strk20Networks?.[resolved.record.networkId];
  const poolAddress = privacyConfig ? canonicalFelt(privacyConfig.poolAddress) : null;
  if (!privacyConfig || !poolAddress) {
    return { error: "Private balances are not configured for this network" };
  }
  const pack = deps.wallet.packageMultisigStrk20Key;
  if (!pack) return { error: "Secure co-signer coordination is unavailable for this wallet" };
  const packed = await pack({
    chainId: STARKNET_NETWORKS[resolved.record.networkId].chainId,
    multisigId,
    poolAddress,
    vaultPassphrase: resolved.active.vaultPassphrase,
  });
  const scalar = packed ? readMultisigStrk20KeyPackage(packed)?.key : undefined;
  if (!scalar) return { error: "Create a key before sharing it." };
  const config = await currentConfigFor(deps, resolved);
  let pending: string | null = null;
  let request: MultisigStrk20ActionRequest = { kind: "register" };
  const chainId = STARKNET_NETWORKS[resolved.record.networkId].chainId;
  const reviewScope = multisigStrk20ReviewScope(resolved.record, poolAddress, preferences.tokens);
  const signCallSet = async (messageHash: string, calls: readonly Call[]): Promise<string[]> => {
    const callsForHash = redactedCalls(calls, scalar);
    const digest = callsForHash
      ? multisigStrk20CallSetHash(resolved.record.address, callsForHash, chainId, scalar)
      : null;
    const hash = digest ? canonicalFelt(digest) : null;
    // The same decoded review a co-owner sees must pass before this key signs.
    if (
      !callsForHash ||
      !hash ||
      !sameFelt(hash, messageHash) ||
      !reviewMultisigStrk20Calls(callsForHash, scalar, reviewScope)
    ) {
      throw new WalletError("Invalid Argent multisig private proof");
    }
    const id = `${resolved.record.id}:${hash}`;
    const existing = await store.getAuthorization(id, scalar);
    if (existing?.state === "ready") {
      return [
        ...multisigStrk20CallSetAggregate(existing.fragments, {
          signerPublicKeys: config.signerPublicKeys,
          threshold: config.threshold,
        }),
      ];
    }
    return collectFragment(deps, resolved, config, store, scalar, {
      calls: callsForHash,
      hash,
      id,
      existing,
    });
  };
  return {
    chainId,
    config,
    context: resolved,
    isAuthorized: authorized.isCurrent,
    poolAddress,
    privacyAccount: {
      address: resolved.record.address,
      id: resolved.record.id,
      networkId: resolved.record.networkId,
    } as Strk20AccountContext["account"],
    privacyConfig,
    readContext: (): Strk20AccountContext => ({
      account: {
        address: resolved.record.address,
        id: resolved.record.id,
        networkId: resolved.record.networkId,
      } as Strk20AccountContext["account"],
      config: privacyConfig,
      isAuthorized: authorized.isCurrent,
      rpcUrls: resolved.rpcUrls,
      signHash: () => Promise.reject(new WalletError("Invalid Argent multisig private proof")),
      viewingKey: async () => scalar,
    }),
    prepareRequest: (next: MultisigStrk20ActionRequest): void => {
      request = next;
    },
    readScalar: async () => scalar,
    signCallSet,
    store,
    strk20,
    waitingId: () => pending,
  };

  async function collectFragment(
    innerDeps: MultisigOpsDeps,
    scope: ArgentMultisigContext,
    authority: Awaited<ReturnType<typeof currentConfigFor>>,
    records: MultisigStrk20Store,
    key: string,
    draft: {
      readonly calls: readonly MultisigStrk20RedactedCall[];
      readonly existing: MultisigStrk20Authorization | null;
      readonly hash: string;
      readonly id: string;
    },
  ): Promise<string[]> {
    const base: MultisigStrk20Authorization = draft.existing ?? {
      accountAddress: scope.record.address,
      accountId: scope.record.id,
      calls: draft.calls,
      chainId,
      fragments: [],
      hash: draft.hash,
      id: draft.id,
      request,
      signerPublicKeys: authority.signerPublicKeys,
      state: "collecting",
      summary: multisigStrk20Summary(request.kind),
      threshold: authority.threshold,
    };
    const member = authority.signerPublicKeys.find((publicKey) =>
      sameFelt(publicKey, scope.active.account.publicKeyX),
    );
    const already = base.fragments.some((fragment) => sameFelt(fragment.publicKey, member ?? ""));
    let next = base;
    if (member && !already && argentSignerGuid(member)) {
      const signed = await signerForContext(innerDeps, {
        account: scope.active.account,
        vaultPassphrase: scope.active.vaultPassphrase,
      })(draft.hash);
      const added = withMultisigStrk20Fragment(base, { ...signed, publicKey: member });
      if (added) next = added;
    }
    const stored = await records.upsertAuthorization(next, key, authorized.isCurrent);
    requireStoredAuthorization(stored);
    if (next.state !== "ready") {
      pending = next.id;
      throw new WalletError(MULTISIG_STRK20_WAITING);
    }
    return [
      ...multisigStrk20CallSetAggregate(next.fragments, {
        signerPublicKeys: authority.signerPublicKeys,
        threshold: authority.threshold,
      }),
    ];
  }
};

/**
 * Current block and the pool's proof-validity span. A malformed answer fails closed.
 */
export const readMultisigStrk20Window = async (
  rpcUrls: readonly string[],
  poolAddress: string,
): Promise<{ readonly currentBlock: bigint; readonly validityBlocks: bigint }> =>
  withRpcFallback(rpcUrls, async (provider) => {
    const current = await provider.getBlockNumber();
    const answered = await provider.callContract(
      { calldata: [], contractAddress: poolAddress, entrypoint: "get_proof_validity_blocks" },
      "latest",
    );
    const raw = Array.isArray(answered) ? answered[0] : answered;
    const validity = typeof raw === "string" ? canonicalFelt(raw) : null;
    if (!Number.isSafeInteger(current) || validity === null) {
      throw new WalletError("Invalid Argent multisig private proof");
    }
    return { currentBlock: BigInt(current), validityBlocks: BigInt(validity) };
  });
