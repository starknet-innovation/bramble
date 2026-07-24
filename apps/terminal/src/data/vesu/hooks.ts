import { useAsyncResource } from "../useAsyncResource";
import type { Resource } from "../types";
import {
  fetchVesuMarkets,
  fetchVesuPositions,
  fetchVesuRedeems,
  fetchVesuRewards,
  fetchVesuVaults,
} from "./client";
import type {
  VesuMarketsData,
  VesuPosition,
  VesuRewards,
  VesuRedeem,
  VesuVault,
} from "./types";

/** Polls verified Vesu V2 markets every minute. */
export const useVesuMarkets = (): Resource<VesuMarketsData> =>
  useAsyncResource((signal) => fetchVesuMarkets(signal), [], 60_000);

/** Loads positions for the connected account and refreshes every 30 seconds. */
export const useVesuPositions = (address: string | null): Resource<readonly VesuPosition[]> =>
  useAsyncResource(
    (signal) =>
      address === null ? Promise.resolve([]) : fetchVesuPositions(address, signal),
    [address],
    address === null ? 0 : 30_000,
  );

/** Loads pending, claimable, and claimed vault redemptions. */
export const useVesuRedeems = (address: string | null): Resource<readonly VesuRedeem[]> =>
  useAsyncResource(
    (signal) => (address === null ? Promise.resolve([]) : fetchVesuRedeems(address, signal)),
    [address],
    address === null ? 0 : 30_000,
  );

/** Polls curated Vesu vault analytics every two minutes. */
export const useVesuVaults = (): Resource<readonly VesuVault[]> =>
  useAsyncResource((signal) => fetchVesuVaults(signal), [], 120_000);

/** Loads claimable rewards for the connected account. */
export const useVesuRewards = (address: string | null): Resource<VesuRewards> =>
  useAsyncResource(
    (signal) =>
      address === null
        ? Promise.resolve({ amount: "0", claimableRaw: "0", decimals: 18, proof: [] })
        : fetchVesuRewards(address, signal),
    [address],
    address === null ? 0 : 60_000,
  );
