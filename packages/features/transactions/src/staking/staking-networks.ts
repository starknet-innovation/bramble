/**
 * Native Starknet staking (delegation pools) per network: the staking
 * contract the wallet trusts, whether the feature is switched on, and the
 * curated validator list.
 *
 * Trust boundary: these constants are the ONLY source of a staking contract
 * or a validator the wallet will build calls for. A pool address is never
 * taken from this list, the UI, or an API: it is resolved on chain from the
 * staking contract below and checked against the pool's own parameters (see
 * ./staking-decode `verifyStakingPool`). Nothing here is read from storage.
 *
 * Off by default on every network. Turning a network on, and choosing its
 * validators, is a product decision (issue 750); until then the feature has
 * no entry point and the background refuses every staking message.
 */
import { type StarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";

/**
 * A validator the wallet offers for delegation. `staker` is the validator's
 * staker address on the staking contract; its pools are resolved on chain.
 */
export type StakingValidator = {
  /** Stable, lowercase id used in messages; never shown to the user. */
  readonly id: string;
  readonly name: string;
  readonly staker: string;
};

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
  readonly validators: readonly StakingValidator[];
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
    validators: [],
  },
  SN_SEPOLIA: {
    enabled: false,
    stakingContract: "0x03745ab04a431fc02871a139be6b93d9260b0ff3e779ad9c8b377183b23109f1",
    validators: [],
  },
};

/**
 * Returns the network's staking configuration when staking is switched on and
 * has at least one validator, otherwise null. Callers treat null as "staking is
 * unavailable here" and build nothing.
 */
export const stakingNetwork = (
  networkId: StarknetNetworkId,
  networks: StakingNetworkTable = STAKING_NETWORKS,
): StakingNetwork | null => {
  const network = networks[networkId];
  return network?.enabled === true && network.validators.length > 0 ? network : null;
};

/**
 * Finds a curated validator by id or staker address on an enabled network.
 * Anything not on the list is refused (null), whatever the caller claims.
 */
export const curatedValidator = (
  network: StakingNetwork,
  idOrStaker: string,
): StakingValidator | null =>
  network.validators.find(
    (validator) => validator.id === idOrStaker || sameFelt(validator.staker, idOrStaker),
  ) ?? null;
