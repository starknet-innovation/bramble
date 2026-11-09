import {
  canonicalAddress,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
} from "../../protocols/support/networks";
import type {
  VesuMarket,
  VesuMarketsData,
  VesuPair,
  VesuPosition,
  VesuRewards,
  VesuRedeem,
  VesuVault,
} from "./types";

type JsonRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const array = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const numeric = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const SECONDS_PER_YEAR = 31_536_000;
const MAX_RISK_URL_LENGTH = 2_048;

/**
 * The Vesu API's risk-report link, kept only as a plain `https:` URL with no
 * credentials and a bounded length. The value is rendered as a link `href`, so
 * a `javascript:`, `data:` or plain-HTTP string from the API, or one that hides
 * a user name before the host, becomes no link at all (Sherlock 206).
 */
export const vesuRiskUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > MAX_RISK_URL_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const address = (value: unknown): string | null => {
  const candidate = text(value);
  return isNonZeroStarkFieldElement(candidate) ? (canonicalAddress(candidate) ?? candidate) : null;
};

/** Converts a Vesu `{ value, decimals }` fixed-point value to a finite number. */
const vesuFixed = (value: unknown): number => {
  const fixed = record(value);
  if (fixed === null) return 0;
  const raw = text(fixed["value"]);
  const decimals = numeric(fixed["decimals"], -1);
  if (!/^-?[0-9]+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return 0;
  }
  const result = Number(raw) / 10 ** decimals;
  return Number.isFinite(result) ? result : 0;
};

const parseAsset = (pool: JsonRecord, value: unknown): VesuMarket | null => {
  const asset = record(value);
  const stats = record(asset?.["stats"]);
  const config = record(asset?.["config"]);
  const rate = record(asset?.["interestRateConfig"]);
  const oracle = record(asset?.["oracleConfig"]);
  const vToken = record(asset?.["vToken"]);
  const risk = record(asset?.["risk"]);
  const poolId = address(pool["id"]);
  const assetAddress = address(asset?.["address"]);
  const vTokenAddress = address(vToken?.["address"]);
  const oracleAddress = address(pool["oracleContractAddress"]);
  const owner = address(pool["owner"]);
  if (
    poolId === null ||
    assetAddress === null ||
    vTokenAddress === null ||
    oracleAddress === null ||
    owner === null
  ) {
    return null;
  }
  const supplied = vesuFixed(stats?.["totalSupplied"]);
  const debt = vesuFixed(stats?.["totalDebt"]);
  return {
    assetAddress,
    borrowApr: vesuFixed(stats?.["borrowApr"]) * 100,
    canBeBorrowed: stats?.["canBeBorrowed"] === true,
    debt,
    decimals: numeric(asset?.["decimals"]),
    feeRate: vesuFixed(config?.["feeRate"]) * 100,
    fullUtilizationApr: vesuFixed(config?.["lastFullUtilizationRate"]) * SECONDS_PER_YEAR * 100,
    isPaused: pool["isPaused"] === true,
    liquidity: Math.max(0, supplied - debt),
    maxUtilization: vesuFixed(config?.["maxUtilization"]) * 100,
    maxFullUtilizationApr: vesuFixed(rate?.["maxFullUtilizationRate"]) * SECONDS_PER_YEAR * 100,
    maxTargetUtilization: vesuFixed(rate?.["maxTargetUtilization"]) * 100,
    minFullUtilizationApr: vesuFixed(rate?.["minFullUtilizationRate"]) * SECONDS_PER_YEAR * 100,
    minTargetUtilization: vesuFixed(rate?.["minTargetUtilization"]) * 100,
    name: text(asset?.["name"], "Unknown asset"),
    oracleAddress,
    oracleAggregationMode: text(oracle?.["aggregationMode"], "unspecified"),
    oracleKey: text(oracle?.["pragmaKey"], "Unspecified"),
    oracleSources: numeric(oracle?.["numberOfSources"]),
    oracleTimeoutSeconds: numeric(oracle?.["timeout"]),
    oracleTimeWindowSeconds: numeric(oracle?.["timeWindow"]),
    poolId,
    poolName: text(pool["name"], "Unnamed pool").trim(),
    poolOwner: owner,
    priceUsd: vesuFixed(asset?.["usdPrice"]),
    riskUrl: vesuRiskUrl(risk?.["url"]),
    rateHalfLifeSeconds: numeric(rate?.["rateHalfLife"]),
    rateUpdatedAt: typeof config?.["lastUpdated"] === "string" ? config["lastUpdated"] : null,
    supplied,
    supplyApy: vesuFixed(stats?.["supplyApy"]) * 100,
    symbol: text(asset?.["symbol"], "?"),
    targetUtilization: vesuFixed(rate?.["targetUtilization"]) * 100,
    targetRatePercent: vesuFixed(rate?.["targetRatePercent"]) * 100,
    utilization: vesuFixed(stats?.["currentUtilization"]) * 100,
    vTokenAddress,
    zeroUtilizationApr: vesuFixed(rate?.["zeroUtilizationRate"]) * SECONDS_PER_YEAR * 100,
  };
};

const parsePair = (poolId: string, value: unknown): VesuPair | null => {
  const pair = record(value);
  const collateralAddress = address(pair?.["collateralAssetAddress"]);
  const debtAddress = address(pair?.["debtAssetAddress"]);
  if (collateralAddress === null || debtAddress === null) return null;
  return {
    collateralAddress,
    debtAddress,
    debtCap: vesuFixed(pair?.["debtCap"]),
    liquidationFactor: vesuFixed(pair?.["liquidationFactor"]) * 100,
    maxLtv: vesuFixed(pair?.["maxLTV"]) * 100,
    poolId,
  };
};

/** Parses only verified, enabled, non-deprecated Vesu V2 pools from the public API. */
export const parseVesuMarkets = (body: unknown, syncedAt: string): VesuMarketsData => {
  const root = record(body);
  const pools = array(root?.["data"]).filter((value) => {
    const pool = record(value);
    return (
      pool?.["protocolVersion"] === "v2" &&
      pool["isVerified"] === true &&
      pool["isDeprecated"] !== true
    );
  });
  const markets: VesuMarket[] = [];
  const pairs: VesuPair[] = [];
  for (const value of pools) {
    const pool = record(value);
    if (pool === null) continue;
    for (const rawAsset of array(pool["assets"])) {
      const parsed = parseAsset(pool, rawAsset);
      if (parsed !== null) markets.push(parsed);
    }
    const poolId = address(pool["id"]);
    if (poolId !== null) {
      for (const rawPair of array(pool["pairs"])) {
        const parsed = parsePair(poolId, rawPair);
        if (parsed !== null) pairs.push(parsed);
      }
    }
  }
  return { markets, pairs, poolCount: pools.length, syncedAt };
};

const tokenValue = (
  value: unknown,
): { address: string; symbol: string; decimals: number; raw: string; amount: number } | null => {
  const token = record(value);
  const tokenAddress = address(token?.["address"]);
  const raw = text(token?.["value"]);
  const decimals = numeric(token?.["decimals"], -1);
  if (tokenAddress === null || !/^[0-9]+$/.test(raw) || decimals < 0) return null;
  return {
    address: tokenAddress,
    amount: Number(raw) / 10 ** decimals,
    decimals,
    raw,
    symbol: text(token?.["symbol"], "?"),
  };
};

/** Parses connected-wallet V2 and vault positions; malformed entries fail closed. */
export const parseVesuPositions = (body: unknown): readonly VesuPosition[] => {
  const rows: VesuPosition[] = [];
  for (const value of array(record(body)?.["data"])) {
    const item = record(value);
    const type = item?.["type"];
    if (type !== "earn" && type !== "borrow" && type !== "multiply" && type !== "vault") {
      continue;
    }
    if (type !== "vault" && item?.["protocolVersion"] !== "v2") continue;
    const collateral = tokenValue(item?.["collateral"] ?? item?.["assets"]);
    const shares = tokenValue(item?.["shares"]);
    const pool = record(item?.["pool"]);
    const poolId = address(
      pool?.["id"] ?? shares?.address ?? item?.["vaultAddress"] ?? item?.["address"],
    );
    if (collateral === null || poolId === null) continue;
    const debt = tokenValue(item?.["debt"]);
    const ltv = record(item?.["ltv"]);
    rows.push({
      collateralAddress: collateral.address,
      collateralAmount: collateral.amount,
      collateralDecimals: collateral.decimals,
      collateralRaw: collateral.raw,
      collateralSymbol: collateral.symbol,
      currentLtv: ltv === null ? null : vesuFixed(ltv["current"]) * 100,
      debtAddress: debt?.address ?? null,
      debtAmount: debt?.amount ?? 0,
      debtDecimals: debt?.decimals ?? null,
      debtRaw: debt?.raw ?? null,
      debtSymbol: debt?.symbol ?? null,
      healthFactor: item?.["healthFactor"] === undefined ? null : vesuFixed(item["healthFactor"]),
      id: text(item?.["id"], `${poolId}:${collateral.address}:${type}`),
      maxLtv: ltv === null ? null : vesuFixed(ltv["max"]) * 100,
      poolId,
      poolName: text(
        pool?.["name"] ??
          (type === "vault" ? record(item?.["shares"])?.["name"] : undefined) ??
          item?.["vaultName"],
        "Vesu",
      ),
      sharesAmount: shares?.amount ?? null,
      sharesDecimals: shares?.decimals ?? null,
      sharesRaw: shares?.raw ?? null,
      sharesSymbol: shares?.symbol ?? null,
      type,
    });
  }
  return rows;
};

/** Parses the connected account's asynchronous vault redemption queue. */
export const parseVesuRedeems = (body: unknown): readonly VesuRedeem[] => {
  const rows: VesuRedeem[] = [];
  for (const value of array(record(body)?.["data"])) {
    const item = record(value);
    const shares = tokenValue(item?.["shares"]);
    const assets = tokenValue(item?.["assets"]);
    const redemptionId = text(item?.["redemptionId"]);
    const status = item?.["status"];
    if (
      shares === null ||
      assets === null ||
      !/^[0-9]+$/.test(redemptionId) ||
      (status !== "pending" && status !== "claimable" && status !== "claimed")
    ) {
      continue;
    }
    rows.push({
      assetsAmount: assets.amount,
      assetsSymbol: assets.symbol,
      redemptionId,
      sharesAddress: shares.address,
      sharesAmount: shares.amount,
      sharesDecimals: shares.decimals,
      sharesSymbol: shares.symbol,
      status,
      timestamp: text(item?.["timestamp"]),
    });
  }
  return rows;
};

/** Parses curated Vesu vault summaries. */
export const parseVesuVaults = (body: unknown): readonly VesuVault[] => {
  const rows: VesuVault[] = [];
  for (const value of array(record(body)?.["data"])) {
    const vault = record(value);
    const underlying = record(vault?.["underlyingAsset"]);
    const stats = record(vault?.["stats"]);
    const apr = record(stats?.["apr"]);
    const tvl = record(stats?.["tvl"]);
    const fees = record(vault?.["fees"]);
    const vaultAddress = address(vault?.["address"]);
    const assetAddress = address(underlying?.["address"]);
    const curatorAddress = address(vault?.["curatorAddress"]);
    if (vaultAddress === null || assetAddress === null || curatorAddress === null) continue;
    rows.push({
      address: vaultAddress,
      apr30d: vesuFixed(apr?.["thirtyDays"]) * 100,
      apr7d: vesuFixed(apr?.["sevenDays"]) * 100,
      assetAddress,
      assetDecimals: numeric(underlying?.["decimals"]),
      assetSymbol: text(underlying?.["symbol"], "?"),
      averageRedeemDelaySeconds: numeric(stats?.["averageRedeemDelay"]),
      curatorAddress,
      depositLimit: vesuFixed(vault?.["depositLimit"]),
      managementFee: vesuFixed(record(fees?.["management"]) ?? fees?.["management"]) * 100,
      name: text(vault?.["name"], "Vesu vault"),
      performanceFee: vesuFixed(record(fees?.["performance"]) ?? fees?.["performance"]) * 100,
      symbol: text(vault?.["symbol"], "vAsset"),
      tvlUsd: vesuFixed(tvl?.["usd"]),
    });
  }
  return rows;
};

/** Parses rewards plus Merkle claim calldata. Missing programs normalize to zero. */
export const parseVesuRewards = (summary: unknown, calldata: unknown): VesuRewards => {
  const btcFi = record(record(summary)?.["data"])?.["btcFi"];
  const reward = record(btcFi);
  const claim = record(record(record(calldata)?.["data"])?.["btcFi"]);
  const amount = text(reward?.["amount"]);
  const claimableRaw = text(claim?.["amount"]);
  const decimals = numeric(reward?.["decimals"], 18);
  return {
    amount: /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(amount) ? amount : "0",
    claimableRaw: /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(claimableRaw) ? claimableRaw : "0",
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18,
    proof: array(claim?.["proof"]).flatMap((value) => {
      if (typeof value !== "string") return [];
      const normalized = value.toLowerCase();
      return isStarkFieldElement(normalized) ? [normalized] : [];
    }),
  };
};
