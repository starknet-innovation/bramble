/**
 * Native Starknet staking (delegation pools) per network: the staking
 * contract the wallet trusts, whether the feature is switched on, and the
 * gateway route that serves the validator directory.
 *
 * Trust boundary: the staking contract below is the ONLY one the wallet will
 * build calls for. A validator (staker address) may come from the directory or
 * be pasted by the user; either way it is untrusted until the staking contract
 * lists a pool for it on chain and that pool's own parameters agree (see
 * ./staking-decode `verifyStakingPool`). A pool address is never taken from
 * the directory, the UI, or an API. Nothing here is read from storage.
 *
 * Off by default on every network. Turning a network on is a product decision
 * (issue 750); until then the feature has no entry point and the background
 * refuses every staking message.
 */
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";

/**
 * Per-network staking configuration.
 */
export type StakingNetwork = {
  /** Whether the staking screen and messages are available on this network. */
  readonly enabled: boolean;
  /**
   * The network's staking contract. Mainnet and Sepolia were checked against
   * docs.starknet.io chain-info and a live `contract_parameters_v1` read
   * (exit window 604800 s on Mainnet, 300 s on Sepolia) on 2026-11-04.
   */
  readonly stakingContract: string;
};

/**
 * Staking configuration for every network; null where there is no staking.
 */
export type StakingNetworkTable = Readonly<Record<StarknetNetworkId, StakingNetwork | null>>;

/**
 * Staking configuration by network. Devnet has no staking contract.
 */
export const STAKING_NETWORKS: StakingNetworkTable = {
  SN_DEVNET: null,
  SN_MAIN: {
    enabled: false,
    stakingContract: "0x00ca1702e64c81d9a07b86bd2c540188d92a2c73cf5cc0e508d949015e7e84a7",
  },
  SN_SEPOLIA: {
    enabled: false,
    stakingContract: "0x03745ab04a431fc02871a139be6b93d9260b0ff3e779ad9c8b377183b23109f1",
  },
};

/**
 * The SNF gateway route that serves Starkscan's validator directory for each
 * network, or null where there is none. The Starkscan API key lives only in
 * the gateway; the extension never holds it. Null everywhere until the route
 * exists: the screen then offers only a pasted validator address. Starkscan
 * does not serve Sepolia (it answers 404), so Sepolia stays null.
 */
export const STAKING_DIRECTORY_URLS: Readonly<Record<StarknetNetworkId, string | null>> = {
  SN_DEVNET: null,
  SN_MAIN: null,
  SN_SEPOLIA: null,
};

/**
 * Returns the network's staking configuration when staking is switched on,
 * otherwise null. Callers treat null as "staking is unavailable here" and
 * build nothing.
 */
export const stakingNetwork = (
  networkId: StarknetNetworkId,
  networks: StakingNetworkTable = STAKING_NETWORKS,
): StakingNetwork | null => {
  const network = networks[networkId];
  return network?.enabled === true ? network : null;
};

/**
 * A validator's staker address in canonical form, or null when `value` is not
 * a non-zero felt. Pure. A well-formed address is only a candidate: the
 * staking contract decides on chain whether it is a validator at all.
 */
export const stakerAddress = (value: unknown): string | null =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) ? canonicalFelt(value) : null;
