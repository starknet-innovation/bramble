/**
 * Vesu V2 lending primitives: the resolved pool-config shape, the Vesu API
 * response parser, the signed-amount (`i257`) helper, and the pure starknet-js
 * calldata builders for the earn (ERC-4626 vToken) and borrow/repay (V2 `Pool`
 * `modify_position`) flows. Kept separate from vesu.ts so the public protocol
 * surface stays within the module size budget. Nothing here touches the
 * network — the HTTP pool fetch lives in vesu.ts; these are pure serializers,
 * integer math, and JSON parsing.
 *
 * V2 model (docs.vesu.xyz, mirrored in vesuxyz/vesu-v2 src/pool.cairo &
 * src/data_model.cairo): there is NO Singleton and NO extension — each pool is
 * its own `Pool` contract, and borrow/repay call `modify_position(params:
 * ModifyPositionParams)` directly on that pool contract. The V2 structs are:
 *   ModifyPositionParams { collateral_asset, debt_asset, user, collateral, debt }
 *   Amount               { denomination: AmountDenomination, value: i257 }
 *   AmountDenomination   enum { Native = 0, Assets = 1 }
 *   i257 (alexandria)    { abs: u256, is_negative: bool }
 * Note V2's `Amount` has NO `amount_type`/Delta field (that was V1), and
 * `ModifyPositionParams` has NO leading `pool_id` and NO trailing `data`.
 * starknet-js compiles plain objects depth-first in property order, so the field
 * order below IS the Cairo ABI order.
 *
 * The shapes above have been cross-checked against the deployed V2 mainnet
 * class ABI. Every builder remains pure and returns reviewable calls only.
 */
import { CairoCustomEnum, type Call, CallData, cairo } from "starknet";
import { CAIRO_U256_MAX } from "../support/cairo-integers";
import { WalletError } from "../support/errors";
import { isRecord } from "../support/json";
import { isNonZeroStarkFieldElement } from "../support/networks";
import { buildErc20ApproveCall } from "../support/rpc-assets";

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
 * A Vesu V2 pool's contract address and per-asset vToken/rate table.
 */
export type VesuPoolConfig = {
  readonly poolAddress: string;
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
  if (raw <= 0n || raw > CAIRO_U256_MAX) {
    throw new WalletError("Vesu amount must be greater than zero");
  }
  return raw;
};

/**
 * Parses a smallest-unit collateral amount, rejecting floats and negatives but
 * ALLOWING zero — a V2 borrow may add no new collateral (borrowing against an
 * existing position) and a repay always supplies a zero collateral leg.
 */
export const parseVesuCollateralAmount = (amount: string): bigint => {
  const trimmed = amount.trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(trimmed)) {
    throw new WalletError("Invalid Vesu collateral amount");
  }
  const raw = BigInt(trimmed);
  if (raw > CAIRO_U256_MAX) {
    throw new WalletError("Invalid Vesu collateral amount");
  }
  return raw;
};

// Reads a felt-shaped address string off an untrusted record field, returning
// null when absent or malformed.
const readAddress = (value: unknown): string | null =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) ? value : null;

const assertPositiveU256 = (value: bigint, label: string): void => {
  if (value <= 0n || value > CAIRO_U256_MAX) {
    throw new WalletError(`${label} must be a positive u256`);
  }
};

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
 * Tolerates the `{ data: pool }` envelope and requires a V2 pool id. Returns
 * null for a V1 response, a missing pool address, or malformed asset anchors.
 */
export const parseVesuPool = (body: unknown): VesuPoolConfig | null => {
  const envelope = isRecord(body) && isRecord(body.data) ? body.data : body;
  if (!isRecord(envelope) || envelope.protocolVersion !== "v2") {
    return null;
  }
  const poolAddress = readAddress(envelope.id);
  if (poolAddress === null) {
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
  return { assets, poolAddress };
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

// Serializes a Vesu V2 `Amount { denomination: AmountDenomination, value: i257 }`
// in `Assets` denomination — the shape borrow/repay use to move a position's
// collateral/debt leg by a signed underlying-asset amount. Enum variant order
// fixes the on-chain index (Native=0, Assets=1), so listing `Native` first with
// `Assets` active serializes to index 1.
const assetsAmount = (value: bigint): Record<string, unknown> => ({
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
  assertPositiveU256(amountRaw, "Vesu supply amount");
  return [
    buildErc20ApproveCall(assetAddress, vTokenAddress, amountRaw),
    {
      calldata: CallData.compile([cairo.uint256(amountRaw), accountAddress]),
      contractAddress: vTokenAddress,
      entrypoint: "deposit",
    },
    buildErc20ApproveCall(assetAddress, vTokenAddress, 0n),
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
  assertPositiveU256(amountRaw, "Vesu withdraw amount");
  return [
    {
      calldata: CallData.compile([cairo.uint256(amountRaw), accountAddress, accountAddress]),
      contractAddress: vTokenAddress,
      entrypoint: "withdraw",
    },
  ];
};

// Builds the V2 `Pool.modify_position(ModifyPositionParams)` call, targeting the
// pool contract directly (no singleton). Field order matches the V2
// `ModifyPositionParams` struct (collateral_asset, debt_asset, user, collateral,
// debt); `collateralValue`/`debtValue` are signed `Amount`s in `Assets`
// denomination (positive = supply/borrow, negative = withdraw/repay).
//
const buildModifyPositionCall = (
  poolAddress: string,
  collateralAsset: string,
  debtAsset: string,
  user: string,
  collateralValue: bigint,
  debtValue: bigint,
): Call => ({
  calldata: CallData.compile({
    collateral_asset: collateralAsset,
    debt_asset: debtAsset,
    user,
    collateral: assetsAmount(collateralValue),
    debt: assetsAmount(debtValue),
  }),
  contractAddress: poolAddress,
  entrypoint: "modify_position",
});

/**
 * Builds the V2 borrow multicall against the pool contract: when
 * `collateralAmountRaw > 0`, first approve the pool to pull the collateral
 * asset, then a single `modify_position` that supplies `collateralAmountRaw`
 * collateral (positive) and borrows `debtAmountRaw` debt (positive i257). With
 * `collateralAmountRaw === 0` no approval is emitted and only the debt leg
 * moves (borrowing against an existing position). The position is keyed by the
 * real `collateralAsset` — no `0x0` placeholder.
 */
export const buildVesuBorrowCalls = (
  poolAddress: string,
  collateralAsset: string,
  collateralAmountRaw: bigint,
  debtAsset: string,
  debtAmountRaw: bigint,
  accountAddress: string,
): readonly Call[] => {
  if (
    !isNonZeroStarkFieldElement(poolAddress) ||
    !isNonZeroStarkFieldElement(collateralAsset) ||
    !isNonZeroStarkFieldElement(debtAsset) ||
    !isNonZeroStarkFieldElement(accountAddress)
  ) {
    throw new WalletError("Invalid Vesu borrow address");
  }
  if (collateralAmountRaw < 0n || collateralAmountRaw > CAIRO_U256_MAX) {
    throw new WalletError("Vesu collateral amount must be a u256");
  }
  assertPositiveU256(debtAmountRaw, "Vesu borrow amount");
  const calls: Call[] = [];
  if (collateralAmountRaw > 0n) {
    calls.push(buildErc20ApproveCall(collateralAsset, poolAddress, collateralAmountRaw));
  }
  calls.push(
    buildModifyPositionCall(
      poolAddress,
      collateralAsset,
      debtAsset,
      accountAddress,
      collateralAmountRaw,
      debtAmountRaw,
    ),
  );
  if (collateralAmountRaw > 0n) {
    calls.push(buildErc20ApproveCall(collateralAsset, poolAddress, 0n));
  }
  return calls;
};

/**
 * Builds the V2 repay multicall against the pool contract: approve the pool to
 * pull the debt asset, then a `modify_position` with a zero collateral leg and a
 * negative debt leg (`-debtAmountRaw`, i257) so only debt is repaid. The
 * position is keyed by the real `collateralAsset`.
 */
export const buildVesuRepayCalls = (
  poolAddress: string,
  collateralAsset: string,
  debtAsset: string,
  debtAmountRaw: bigint,
  accountAddress: string,
): readonly Call[] => {
  if (
    !isNonZeroStarkFieldElement(poolAddress) ||
    !isNonZeroStarkFieldElement(collateralAsset) ||
    !isNonZeroStarkFieldElement(debtAsset) ||
    !isNonZeroStarkFieldElement(accountAddress)
  ) {
    throw new WalletError("Invalid Vesu repay address");
  }
  assertPositiveU256(debtAmountRaw, "Vesu repay amount");
  return [
    buildErc20ApproveCall(debtAsset, poolAddress, debtAmountRaw),
    buildModifyPositionCall(
      poolAddress,
      collateralAsset,
      debtAsset,
      accountAddress,
      0n,
      -debtAmountRaw,
    ),
    buildErc20ApproveCall(debtAsset, poolAddress, 0n),
  ];
};
