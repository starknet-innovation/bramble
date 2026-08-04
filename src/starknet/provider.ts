/**
 * Starknet provider plumbing shared by wallet RPC operations: the Krusty
 * signer adapter, endpoint failover, and RPC error classification.
 */
import { Account, RpcProvider, type Signature, Signer } from "starknet";
import type { StarkSignature } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { isRecord } from "../shared/json";
import { rpcFailureError } from "../shared/rpc-failure";
import type { AccountRef } from "../storage/vault-schema";
import { isStarkFieldElement, sameFelt } from "./networks";

/**
 * Function that signs a Stark transaction hash through the vault service.
 */
export type StarkHashSigner = (messageHash: string) => Promise<StarkSignature>;

class KrustyStarknetSigner extends Signer {
  public constructor(
    private readonly publicKey: string,
    private readonly starkSignHash: StarkHashSigner,
  ) {
    super("0x1");
  }

  public override async getPubKey(): Promise<string> {
    return this.publicKey;
  }

  protected override async signRaw(messageHash: string): Promise<Signature> {
    const hash = messageHash.startsWith("0x")
      ? messageHash
      : `0x${BigInt(messageHash).toString(16)}`;
    if (!isStarkFieldElement(hash)) {
      throw new WalletError("Invalid transaction hash");
    }
    const signed = await this.starkSignHash(hash);
    return [signed.r, signed.s];
  }
}

/**
 * Builds a starknet.js account backed by the Krusty signer.
 */
export const krustyAccount = (
  provider: RpcProvider,
  account: AccountRef,
  signHash: StarkHashSigner,
): Account =>
  new Account({
    address: account.address,
    cairoVersion: "1",
    provider,
    signer: new KrustyStarknetSigner(account.publicKeyX, signHash),
  });

// The structured payload starknet.js attaches to a rejected RPC request. Every
// classifier below reads the node's answer through here so "did the node answer
// at all" is decided in exactly one place. The sibling `Error.message` is never
// read: it embeds the full JSON request params (see ../shared/rpc-failure).
const rpcBaseError = (error: unknown): Record<string, unknown> | null => {
  const baseError = (error as { readonly baseError?: unknown } | null | undefined)?.baseError;
  return isRecord(baseError) ? baseError : null;
};

/**
 * Checks whether an RPC failure means the queried contract is not deployed.
 */
export const isContractNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/contract not found/i.test(error.message)) {
    return true;
  }
  return rpcBaseError(error)?.["code"] === 20;
};

/**
 * Checks whether an RPC failure is transport-level (node unreachable or
 * malfunctioning) rather than a semantic contract or execution error.
 */
export const isTransportRpcError = (error: unknown): boolean => {
  if (error instanceof WalletError) {
    return false;
  }
  return typeof rpcBaseError(error)?.["code"] !== "number";
};

/**
 * Runs one RPC operation and replaces a semantic node rejection with a
 * `WalletError` carrying the node's own, sanitized reason, so a revert reaches
 * the user as "…: Insufficient max L2Gas…" instead of a generic string.
 *
 * Trust boundary: only structured `baseError` fields are read — never the
 * starknet.js message, which embeds the request params. The resulting reason is
 * for the extension UI; the dapp boundary redacts it (see `RPC_FAILURE_PREFIX`).
 *
 * Failure behaviour: fail closed and unchanged. An already-curated
 * `WalletError` and every transport-level failure are rethrown as-is, so an
 * ambiguous submission stays ambiguous and `withRpcWrite` still reports
 * "submission status is unknown". Wrap the smallest span that can reject: the
 * caller keeps its own retry/failover semantics.
 */
export const withRpcFailureDetail = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WalletError || isTransportRpcError(error)) {
      throw error;
    }
    throw rpcFailureError(rpcBaseError(error)) ?? error;
  }
};

/**
 * Runs an operation against each configured RPC endpoint until one succeeds.
 * Only transport-level failures fail over; semantic RPC errors propagate so
 * contract state is never misread as node downtime.
 */
export const withRpcFallback = async <T>(
  rpcUrls: readonly string[],
  run: (provider: RpcProvider) => Promise<T>,
  makeProvider: (nodeUrl: string) => RpcProvider = (nodeUrl) => new RpcProvider({ nodeUrl }),
): Promise<T> => {
  let lastError: unknown = new WalletError("No RPC endpoints configured");
  for (const nodeUrl of rpcUrls) {
    try {
      return await run(makeProvider(nodeUrl));
    } catch (error) {
      if (!isTransportRpcError(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
};

/**
 * Selects a chain-matching endpoint with read-only probes, then runs a
 * state-changing operation exactly once. After execution begins no transport
 * failure is retried: the node may already have accepted the transaction, so
 * replaying through a fallback could submit a second write.
 */
export const withRpcWrite = async <T>(
  rpcUrls: readonly string[],
  expectedChainId: string,
  run: (provider: RpcProvider) => Promise<T>,
  makeProvider: (nodeUrl: string) => RpcProvider = (nodeUrl) => new RpcProvider({ nodeUrl }),
): Promise<T> => {
  let selected: RpcProvider | null = null;
  let lastError: unknown = new WalletError("No RPC endpoints configured");
  for (const nodeUrl of rpcUrls) {
    try {
      const provider = makeProvider(nodeUrl);
      const chainId = await provider.getChainId();
      if (!sameFelt(chainId, expectedChainId)) {
        lastError = new WalletError("RPC endpoint returned the wrong Starknet chain");
        continue;
      }
      selected = provider;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!selected) {
    throw lastError;
  }
  try {
    return await run(selected);
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw new WalletError(
        "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
      );
    }
    throw error;
  }
};
