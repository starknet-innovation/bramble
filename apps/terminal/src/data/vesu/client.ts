import { fetchJson, HttpError } from "../core/client";
import { VESU_API_BASE } from "../../protocols/constants";
import {
  parseVesuMarkets,
  parseVesuPositions,
  parseVesuRedeems,
  parseVesuRewards,
  parseVesuVaults,
} from "./parse";
import type {
  VesuMarketsData,
  VesuPosition,
  VesuRewards,
  VesuRedeem,
  VesuVault,
} from "./types";

/** Fetches the verified Vesu V2 market universe. */
export const fetchVesuMarkets = async (signal?: AbortSignal): Promise<VesuMarketsData> => {
  const body = await fetchJson<unknown>(
    `${VESU_API_BASE}/pools?protocolVersion=v2&onlyVerified=true&onlyEnabledAssets=true`,
    { signal },
  );
  return parseVesuMarkets(body, new Date().toISOString());
};

/** Fetches open Vesu positions for a connected Starknet account. */
export const fetchVesuPositions = async (
  walletAddress: string,
  signal?: AbortSignal,
): Promise<readonly VesuPosition[]> =>
  parseVesuPositions(
    await fetchJson<unknown>(`${VESU_API_BASE}/users/${walletAddress}/positions`, { signal }),
  );

/** Fetches the asynchronous vault redemption queue for a connected account. */
export const fetchVesuRedeems = async (
  walletAddress: string,
  signal?: AbortSignal,
): Promise<readonly VesuRedeem[]> =>
  parseVesuRedeems(
    await fetchJson<unknown>(`${VESU_API_BASE}/users/${walletAddress}/redeems`, { signal }),
  );

/** Fetches curated Vesu vaults. */
export const fetchVesuVaults = async (signal?: AbortSignal): Promise<readonly VesuVault[]> =>
  parseVesuVaults(
    await fetchJson<unknown>(`${VESU_API_BASE}/vaults?onlyVerified=true`, { signal }),
  );

const optionalJson = async (url: string, signal?: AbortSignal): Promise<unknown> => {
  try {
    return await fetchJson<unknown>(url, { signal });
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 500)) {
      return { data: {} };
    }
    throw error;
  }
};

/** Fetches incentive totals and proof calldata; accounts without rewards return zero. */
export const fetchVesuRewards = async (
  walletAddress: string,
  signal?: AbortSignal,
): Promise<VesuRewards> => {
  const [summary, calldata] = await Promise.all([
    optionalJson(`${VESU_API_BASE}/users/${walletAddress}/rewards`, signal),
    optionalJson(`${VESU_API_BASE}/users/${walletAddress}/rewards/calldata`, signal),
  ]);
  return parseVesuRewards(summary, calldata);
};
