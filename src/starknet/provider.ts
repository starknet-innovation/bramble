/**
 * Starknet provider plumbing shared by wallet RPC operations: the Krusty
 * signer adapter, endpoint failover, and RPC error classification.
 */
import { Account, RpcProvider, type RpcProviderOptions, type Signature, Signer } from "starknet";
import type { StarkSignature } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { isRecord } from "../shared/json";
import type { AccountRef } from "../storage/vault-schema";
import { isStarkFieldElement, STARKNET_RPC_SPEC_VERSION, sameFelt } from "./networks";

type RpcProviderFactory = (options: RpcProviderOptions) => RpcProvider;

const createStarknetProvider: RpcProviderFactory = (options) => new RpcProvider(options);

/**
 * Safe marker for a write whose transport failed after submission began. The
 * message is curated for display; no RPC error, request body, or proof material
 * is retained on the instance.
 */
export class IndeterminateRpcWriteError extends WalletError {
  public constructor(message: string) {
    super(message);
    this.name = "IndeterminateRpcWriteError";
  }
}

/**
 * Builds an RPC provider pinned to {@link STARKNET_RPC_SPEC_VERSION}.
 *
 * Every provider in the wallet is created here so the spec version is decided
 * in one place rather than inherited from starknet.js's mutable global default
 * — a dependency bump must not silently move the wire format the wallet signs
 * and broadcasts against. Note what this does and does not buy: pinning fixes
 * how the wallet *encodes* requests, and it makes starknet.js skip its lazy
 * `starknet_specVersion` probe, so a node serving a different spec is not
 * detected here. The pin's counterpart is the `v0_10` segment in the bundled
 * gateway URLs; both must move together. The optional factory is a test seam;
 * it always receives the same pinned configuration as the production constructor.
 */
export const createRpcProvider = (
  nodeUrl: string,
  options: Omit<RpcProviderOptions, "nodeUrl" | "specVersion"> = {},
  makeProvider: RpcProviderFactory = createStarknetProvider,
): RpcProvider => makeProvider({ ...options, nodeUrl, specVersion: STARKNET_RPC_SPEC_VERSION });

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
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError["code"] === 20;
};

/**
 * Checks whether an RPC failure means the node has no record of the queried
 * transaction hash (`TXN_HASH_NOT_FOUND`, JSON-RPC error 29).
 *
 * This is a semantic answer, not a transport failure: the node replied and said
 * it does not know the hash. Callers must still treat a single not-found as
 * noise — a hash can legitimately be unknown to one node moments after
 * broadcast, and a pre-confirmed transaction can disappear when its block
 * proposal fails to commit. Use {@link isTransportRpcError} to keep "we could
 * not ask" apart from "the node says it is gone".
 */
export const isTransactionNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/transaction hash not found/i.test(error.message)) {
    return true;
  }
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError["code"] === 29;
};

/**
 * Checks whether an RPC failure is transport-level (node unreachable or
 * malfunctioning) rather than a semantic contract or execution error.
 */
export const isTransportRpcError = (error: unknown): boolean => {
  if (error instanceof WalletError) {
    return false;
  }
  const baseError = (error as { readonly baseError?: unknown } | null | undefined)?.baseError;
  return !(isRecord(baseError) && typeof baseError["code"] === "number");
};

/**
 * Runs an operation against each configured RPC endpoint until one succeeds.
 * Only transport-level failures fail over; semantic RPC errors propagate so
 * contract state is never misread as node downtime.
 */
export const withRpcFallback = async <T>(
  rpcUrls: readonly string[],
  run: (provider: RpcProvider) => Promise<T>,
  makeProvider: (nodeUrl: string) => RpcProvider = createRpcProvider,
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
  makeProvider: (nodeUrl: string) => RpcProvider = createRpcProvider,
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
      throw new IndeterminateRpcWriteError(
        "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
      );
    }
    throw error;
  }
};
