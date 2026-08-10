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

const PROVIDER_BROADCAST_METHODS = new Set([
  "declareContract",
  "deployAccountContract",
  "invokeFunction",
]);
const CHANNEL_BROADCAST_METHODS = new Set(["declare", "deployAccount", "invoke"]);
const PREPARATION_UNAVAILABLE =
  "Transaction could not be prepared. Check your connection or RPC endpoint.";

const runRpcBroadcast = async <T>(broadcast: () => Promise<T>): Promise<T> => {
  try {
    return await broadcast();
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw new IndeterminateRpcWriteError(
        "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
      );
    }
    throw error;
  }
};

const guardedMember = (
  target: object,
  property: string | symbol,
  broadcastMethods: ReadonlySet<string>,
): unknown => {
  const value: unknown = Reflect.get(target, property, target);
  if (typeof value !== "function") {
    return value;
  }
  const call = (...args: readonly unknown[]): unknown => Reflect.apply(value, target, args);
  return typeof property === "string" && broadcastMethods.has(property)
    ? (...args: readonly unknown[]) => runRpcBroadcast(() => Promise.resolve(call(...args)))
    : call;
};

// Account.execute/declare/deployAccount perform fee reads and signing before
// calling these provider/channel methods. Guarding the methods, rather than the
// whole Account operation, marks only the point at which a node can have
// accepted a transaction.
const guardRpcBroadcasts = (provider: RpcProvider): RpcProvider => {
  const rawChannel: unknown = Reflect.get(provider, "channel", provider);
  const channel =
    typeof rawChannel === "object" && rawChannel !== null
      ? new Proxy(rawChannel, {
          get: (target, property) => guardedMember(target, property, CHANNEL_BROADCAST_METHODS),
        })
      : null;
  return new Proxy(provider, {
    get: (target, property) =>
      property === "channel" && channel !== null
        ? channel
        : guardedMember(target, property, PROVIDER_BROADCAST_METHODS),
  });
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
 * state-changing operation exactly once. The provider's transaction-broadcast
 * methods preserve response-loss ambiguity without retaining the raw error;
 * earlier transport failures become a safe preparation error. Neither case is
 * retried against a fallback endpoint.
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
    return await run(guardRpcBroadcasts(selected));
  } catch (error) {
    if (error instanceof IndeterminateRpcWriteError) {
      throw error;
    }
    if (isTransportRpcError(error)) {
      throw new WalletError(PREPARATION_UNAVAILABLE);
    }
    throw error;
  }
};
