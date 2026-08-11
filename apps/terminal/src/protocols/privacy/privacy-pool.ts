import { RpcProvider } from "starknet";
import { PRIVACY_POOL_ADDRESS } from "../../../shared/privacy";
import { STARKNET_NETWORKS } from "../support/networks";

const FELT = /^0x[0-9a-fA-F]{1,64}$/;

export type PrivacyPoolSnapshot = {
  readonly address: string;
  readonly feeAmount: bigint;
  readonly feeCollector: string;
  readonly proofValidityBlocks: number;
  readonly version: string;
};
type PoolCall = (entrypoint: string) => Promise<unknown>;

const readSingleFelt = (value: unknown): string => {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    typeof value[0] !== "string" ||
    !FELT.test(value[0])
  ) {
    throw new Error("Privacy pool returned an invalid view result.");
  }
  return value[0];
};

/**
 * Reads the minimal audited view surface needed by the Terminal. The provider
 * never accepts a caller-supplied contract address, preventing UI state from
 * silently retargeting the production pool.
 */
export const readPrivacyPool = async (
  call: PoolCall = async (entrypoint) => {
    const provider = new RpcProvider({
      nodeUrl: STARKNET_NETWORKS.SN_MAIN.rpcUrls[0],
    });
    return provider.callContract({
      calldata: [],
      contractAddress: PRIVACY_POOL_ADDRESS,
      entrypoint,
    });
  },
): Promise<PrivacyPoolSnapshot> => {
  const [version, feeAmount, feeCollector, proofValidityBlocks] = await Promise.all([
    call("get_version").then(readSingleFelt),
    call("get_fee_amount").then(readSingleFelt),
    call("get_fee_collector").then(readSingleFelt),
    call("get_proof_validity_blocks").then(readSingleFelt),
  ]);
  const validity = BigInt(proofValidityBlocks);
  if (BigInt(feeCollector) === 0n || validity > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Privacy pool returned unsafe configuration.");
  }
  return {
    address: PRIVACY_POOL_ADDRESS,
    feeAmount: BigInt(feeAmount),
    feeCollector,
    proofValidityBlocks: Number(validity),
    version,
  };
};
