/**
 * Vesu lending primitives: the resolved pool-config shape, the Vesu API
 * response parser, the signed-amount (`i257`) helper, and the pure starknet-js
 * calldata builders for the earn (ERC-4626 vToken) and borrow (singleton
 * `modify_position`) flows. Kept separate from vesu.ts so the public protocol
 * surface stays within the module size budget. Nothing here touches the
 * network — the HTTP pool fetch and the on-chain `singleton()` read live in
 * vesu.ts; these are pure serializers, integer math, and JSON parsing.
 *
 * ⚠️ Contract shapes (entrypoint names, `ModifyPositionParams` field order, the
 * `Amount { amount_type, denomination, value }` enum layout, and the `i257
 * { abs, is_negative }` struct) are transcribed from the Vesu recon and must be
 * re-verified against docs.vesu.xyz / the deployed singleton ABI before any
 * mainnet transaction is signed. starknet-js compiles plain objects depth-first
 * in property order, so the field order below IS the Cairo ABI order.
 */
import { CairoCustomEnum, type Call, CallData, cairo } from "starknet";
import { WalletError } from "../../shared/errors";
import { isRecord } from "../../shared/json";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "../networks";
import { buildErc20ApproveCall } from "../rpc-assets";

/**
 * Basis-points denominator (100% = 10_000 bps).
 */
export const BPS_DENOMINATOR = 10_000n;

/**
 * Per-asset config resolved from a Vesu pool: the ERC20 underlying, its
 * ERC-4626 vToken vault, and the current supply/borrow rates (bps, or null when
 * the API omits or malforms them).
 */
export type VesuAssetConfig = {
  readonly address: string;
  readonly vTokenAddress: string;
  readonly supplyApyBps: number | null;
  readonly borrowApyBps: number | null;
};

/**
 * A Vesu pool's resolved on-chain anchors: the extension contract (the
 * `singleton()` provider) and the per-collateral-asset vToken/rate table.
 */
export type VesuPoolConfig = {
  readonly extensionAddress: string;
  readonly assets: readonly VesuAssetConfig[];
};

/**
 * Parses a raw smallest-unit integer amount string, rejecting floats and zero.
 */
export const parseVesuAmount = (amount: string): bigint => {
  const trimmed = amount.trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(trimmed)) {
    throw new WalletError("Invalid Vesu amount");
  }
  const raw = BigInt(trimmed);
  if (raw <= 0n) {
    throw new WalletError("Vesu amount must be greater than zero");
  }
  return raw;
};

// Reads a felt-shaped address string off an untrusted record field, returning
// null when absent or malformed.
const readAddress = (value: unknown): string | null =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) ? value : null;

// Parses a Vesu fixed-point rate (`{ value, decimals }`, value in smallest
// units of a fraction) into integer basis points, or null when malformed. e.g.
// 5% arrives as value=5e16, decimals=18 -> 500 bps.
const parseApyBps = (value: unknown): number | null => {
  if (!isRecord(value)) {
    return null;
  }
  const rawValue = value.value;
  const decimals = value.decimals;
  if (typeof rawValue !== "string" || !/^[0-9]+$/.test(rawValue)) {
    return null;
  }
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) {
    return null;
  }
  const bps = (BigInt(rawValue) * BPS_DENOMINATOR) / 10n ** BigInt(decimals);
  return Number(bps);
};

// Extracts the vToken/rate config for one entry of the pool's `assets` array.
const parseAssetConfig = (entry: unknown): VesuAssetConfig | null => {
  if (!isRecord(entry)) {
    return null;
  }
  const address = readAddress(entry.address);
  const vToken = isRecord(entry.vToken) ? readAddress(entry.vToken.address) : null;
  if (address === null || vToken === null) {
    return null;
  }
  const stats = isRecord(entry.stats) ? entry.stats : {};
  return {
    address,
    borrowApyBps: parseApyBps(stats.borrowApr),
    supplyApyBps: parseApyBps(stats.supplyApy),
    vTokenAddress: vToken,
  };
};

/**
 * Parses a Vesu `GET /pools/{poolId}` response body into a {@link VesuPoolConfig}.
 * Tolerates the `{ data: pool }` envelope and resolves the extension address
 * from `extensionContractAddress` (v1) with fallbacks to `extension` / `id`
 * (v2). Returns null when the extension cannot be resolved.
 *
 * ⚠️ v1 vs v2 field names and the vToken/stats shape are transcribed from the
 * recon and must be confirmed against the production API response before funds.
 */
export const parseVesuPool = (body: unknown): VesuPoolConfig | null => {
  const envelope = isRecord(body) && isRecord(body.data) ? body.data : body;
  if (!isRecord(envelope)) {
    return null;
  }
  const extensionAddress =
    readAddress(envelope.extensionContractAddress) ??
    readAddress(envelope.extension) ??
    readAddress(envelope.id);
  if (extensionAddress === null) {
    return null;
  }
  const rawAssets = Array.isArray(envelope.assets) ? envelope.assets : [];
  const assets: VesuAssetConfig[] = [];
  for (const entry of rawAssets) {
    const parsed = parseAssetConfig(entry);
    if (parsed !== null) {
      assets.push(parsed);
    }
  }
  return { assets, extensionAddress };
};

/**
 * Parses a `singleton()` view response (a single felt address) into canonical
 * hex, or null when the response is empty or malformed.
 */
export const parseSingletonAddress = (response: readonly string[]): string | null => {
  const felt = response[0];
  if (typeof felt !== "string" || !isStarkFieldElement(felt) || BigInt(felt) === 0n) {
    return null;
  }
  return `0x${BigInt(felt).toString(16)}`;
};

/**
 * Finds the pool asset config matching an ERC20 address (compared numerically
 * so zero-padding differences do not matter), or null when the pool does not
 * list the asset.
 */
export const findVesuAsset = (config: VesuPoolConfig, asset: string): VesuAssetConfig | null => {
  const target = BigInt(asset);
  return config.assets.find((entry) => BigInt(entry.address) === target) ?? null;
};

/**
 * Serializes a Vesu `i257 { abs: u256, is_negative: bool }` signed amount. A
 * negative value marks the withdraw/repay direction; positive marks
 * supply/borrow.
 */
export const toI257 = (value: bigint): Record<string, unknown> => ({
  abs: cairo.uint256(value < 0n ? -value : value),
  is_negative: value < 0n,
});

// Serializes a Vesu `Amount { amount_type: AmountType, denomination:
// AmountDenomination, value: i257 }` as a Delta in Assets denomination — the
// shape borrow/repay use to nudge a position's debt leg by a signed asset
// amount. Enum variant order fixes the on-chain index (Delta=0, Assets=1).
const deltaAssetsAmount = (value: bigint): Record<string, unknown> => ({
  amount_type: new CairoCustomEnum({ Delta: {}, Target: undefined }),
  denomination: new CairoCustomEnum({ Native: undefined, Assets: {} }),
  value: toI257(value),
});

/**
 * Builds the earn (supply) multicall: approve the vToken vault to pull the
 * underlying, then ERC-4626 `deposit(assets, receiver)` minting vToken shares to
 * the account. Returns starknet-js Calls; does not sign or broadcast.
 */
export const buildVesuSupplyCalls = (
  assetAddress: string,
  vTokenAddress: string,
  amountRaw: bigint,
  accountAddress: string,
): readonly Call[] => {
  if (!isNonZeroStarkFieldElement(vTokenAddress) || !isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid Vesu supply address");
  }
  return [
    buildErc20ApproveCall(assetAddress, vTokenAddress, amountRaw),
    {
      calldata: CallData.compile([cairo.uint256(amountRaw), accountAddress]),
      contractAddress: vTokenAddress,
      entrypoint: "deposit",
    },
  ];
};

/**
 * Builds the earn (withdraw) call: ERC-4626 `withdraw(assets, receiver, owner)`
 * burning the account's vToken shares back to the underlying. No approval is
 * needed since the account owns the shares being burned.
 */
export const buildVesuWithdrawCalls = (
  vTokenAddress: string,
  amountRaw: bigint,
  accountAddress: string,
): readonly Call[] => {
  if (!isNonZeroStarkFieldElement(vTokenAddress) || !isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid Vesu withdraw address");
  }
  return [
    {
      calldata: CallData.compile([cairo.uint256(amountRaw), accountAddress, accountAddress]),
      contractAddress: vTokenAddress,
      entrypoint: "withdraw",
    },
  ];
};

// Builds the singleton `modify_position(ModifyPositionParams)` call. The v1
// struct leads with `pool_id`; the collateral leg is left at a zero Delta so
// only the debt leg moves.
const buildModifyPositionCall = (
  singletonAddress: string,
  poolId: string,
  collateralAsset: string,
  debtAsset: string,
  user: string,
  debtValue: bigint,
): Call => ({
  calldata: CallData.compile({
    pool_id: poolId,
    collateral_asset: collateralAsset,
    debt_asset: debtAsset,
    user,
    collateral: deltaAssetsAmount(0n),
    debt: deltaAssetsAmount(debtValue),
    data: [],
  }),
  contractAddress: singletonAddress,
  entrypoint: "modify_position",
});

/**
 * Builds the borrow multicall: a single `modify_position` that increases the
 * position's debt leg by `amountRaw` (positive i257). No approval — the account
 * receives the borrowed asset.
 *
 * ⚠️ The shared single-asset `LendingQuote` cannot express the collateral asset
 * a Vesu position is keyed by, so `collateral_asset` is passed as `0x0`. This
 * calldata is structurally correct but incomplete — the collateral asset must
 * be threaded through before any mainnet borrow.
 */
export const buildVesuBorrowCalls = (
  singletonAddress: string,
  poolId: string,
  debtAsset: string,
  amountRaw: bigint,
  accountAddress: string,
): readonly Call[] => {
  if (
    !isNonZeroStarkFieldElement(singletonAddress) ||
    !isNonZeroStarkFieldElement(debtAsset) ||
    !isNonZeroStarkFieldElement(accountAddress)
  ) {
    throw new WalletError("Invalid Vesu borrow address");
  }
  return [
    buildModifyPositionCall(singletonAddress, poolId, "0x0", debtAsset, accountAddress, amountRaw),
  ];
};

/**
 * Builds the repay multicall: approve the singleton to pull the debt asset, then
 * a `modify_position` that decreases the debt leg by `amountRaw` (negative
 * i257).
 *
 * ⚠️ Same collateral-asset gap as {@link buildVesuBorrowCalls}: `collateral_asset`
 * is `0x0` and must be threaded through before any mainnet repay.
 */
export const buildVesuRepayCalls = (
  singletonAddress: string,
  poolId: string,
  debtAsset: string,
  amountRaw: bigint,
  accountAddress: string,
): readonly Call[] => {
  if (
    !isNonZeroStarkFieldElement(singletonAddress) ||
    !isNonZeroStarkFieldElement(accountAddress)
  ) {
    throw new WalletError("Invalid Vesu repay address");
  }
  return [
    buildErc20ApproveCall(debtAsset, singletonAddress, amountRaw),
    buildModifyPositionCall(singletonAddress, poolId, "0x0", debtAsset, accountAddress, -amountRaw),
  ];
};
