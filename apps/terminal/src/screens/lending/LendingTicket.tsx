import {
  ArrowRight,
  Calculator,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { avnuTokenArtwork } from "../../assets/avnu-token-assets";
import { TokenIcon } from "../../components/index";
import type { VesuMarket, VesuPair } from "../../data/index";
import {
  buildVesuMultiplyIncreaseCalls,
  quoteVesuMultiplyIncrease,
} from "../../protocols/index";
import { buildLendingCalls, quoteLending } from "../../protocols/vesu/vesu";
import { walletNetwork } from "../../wallet/connection/wallet-connection";
import { useWallet } from "../../wallet/connection/WalletProvider";
import { toSmallestUnit, usdValue } from "../swap/swap-panel-utils";
import {
  projectedLtv,
  resolveCollateralAddress,
  riskTone,
  type LendingActionMode,
} from "./lending-model";

type CollateralChoice = { readonly market: VesuMarket; readonly pair: VesuPair };
type Props = {
  readonly market: VesuMarket | null;
  readonly collateralPairs: readonly CollateralChoice[];
  readonly requestedAction?: LendingActionMode;
  readonly requestedActionRevision?: number;
  readonly requestedCollateralAddress?: string;
};

const ACTIONS: readonly { readonly value: LendingActionMode; readonly label: string }[] = [
  { value: "supply", label: "Earn" },
  { value: "borrow", label: "Borrow" },
  { value: "multiply", label: "Multiply" },
  { value: "withdraw", label: "Withdraw" },
  { value: "repay", label: "Repay" },
];

/** Reviews and routes Vesu market actions through the terminal wallet gate. */
export const LendingTicket = ({
  market,
  collateralPairs,
  requestedAction = "supply",
  requestedActionRevision = 0,
  requestedCollateralAddress = "",
}: Props): ReactNode => {
  const {
    address,
    chainId,
    isConnected,
    isConnecting,
    connect,
    requestTransaction,
    watchAsset,
  } = useWallet();
  const [action, setAction] = useState<LendingActionMode>("supply");
  const [amount, setAmount] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [collateralAddress, setCollateralAddress] = useState("");
  const [multiplier, setMultiplier] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  useEffect(() => {
    setAction(requestedAction);
  }, [requestedAction, requestedActionRevision]);

  useEffect(() => {
    setCollateralAddress((current) =>
      resolveCollateralAddress(
        collateralPairs,
        current,
        requestedCollateralAddress,
      ),
    );
  }, [collateralPairs, requestedActionRevision, requestedCollateralAddress]);

  const collateralChoice = useMemo(
    () =>
      collateralPairs.find((choice) => choice.market.assetAddress === collateralAddress) ??
      collateralPairs[0] ??
      null,
    [collateralAddress, collateralPairs],
  );

  const ticketAsset = action === "multiply" ? collateralChoice?.market ?? null : market;
  const amountRaw = ticketAsset === null ? null : toSmallestUnit(amount, ticketAsset.decimals);
  const collateralRaw =
    collateralChoice === null
      ? null
      : toSmallestUnit(collateralAmount, collateralChoice.market.decimals);
  const ltv =
    market === null || collateralChoice === null
      ? 0
      : projectedLtv(
          Number(collateralAmount),
          collateralChoice.market.priceUsd,
          Number(amount),
          market.priceUsd,
        );
  const ltvTone =
    collateralChoice === null
      ? "safe"
      : riskTone(ltv, collateralChoice.pair.maxLtv * 0.75, collateralChoice.pair.maxLtv * 0.92);
  const mainnet = walletNetwork(chainId)?.id === "SN_MAIN";
  const needsCollateral = action === "borrow" || action === "repay" || action === "multiply";
  const multiplyNetApr =
    market === null || collateralChoice === null
      ? 0
      : collateralChoice.market.supplyApy * multiplier - market.borrowApr * (multiplier - 1);
  const multiplyLtv = ((multiplier - 1) / multiplier) * 100;
  const multiplyCollateralOutputRaw =
    collateralChoice === null || Number(amount) <= 0
      ? null
      : toSmallestUnit(
          (Number(amount) * (multiplier - 1)).toFixed(
            Math.min(collateralChoice.market.decimals, 12),
          ),
          collateralChoice.market.decimals,
        );

  const submit = async (): Promise<void> => {
    if (!isConnected) {
      await connect();
      return;
    }
    if (!mainnet || market === null || address === null || amountRaw === null) return;
    if (needsCollateral && collateralChoice === null) return;
    if (action === "borrow" && collateralRaw === null) return;
    setIsPreparing(true);
    setMessage("Resolving current pool state…");
    try {
      if (action === "multiply") {
        if (collateralChoice === null || multiplyCollateralOutputRaw === null) {
          throw new Error("Enter a valid Multiply margin.");
        }
        setMessage("Quoting the debt-to-collateral route on Ekubo…");
        const route = await quoteVesuMultiplyIncrease(
          collateralChoice.market.assetAddress,
          market.assetAddress,
          BigInt(multiplyCollateralOutputRaw),
        );
        const calls = buildVesuMultiplyIncreaseCalls(
          market.poolId,
          collateralChoice.market.assetAddress,
          market.assetAddress,
          address,
          BigInt(amountRaw),
          route,
        );
        await requestTransaction({
          calls,
          description:
            "Open or increase this Vesu Multiply position using the reviewed Ekubo route. Delegation and allowance are revoked in the same transaction.",
          details: [
            { label: "Initial margin", value: `${amount} ${collateralChoice.market.symbol}` },
            { label: "Borrow asset", value: market.symbol },
            { label: "Target multiplier", value: `${multiplier.toFixed(1)}×` },
            { label: "Projected LTV", value: `${multiplyLtv.toFixed(2)}%` },
            { label: "Projected net APR", value: `${multiplyNetApr.toFixed(2)}%` },
            { label: "Max route slippage", value: "1.00%" },
            { label: "Delegation", value: "Revoked after execution" },
          ],
          title: `Multiply ${collateralChoice.market.symbol} with ${market.symbol}`,
          warning:
            "Multiply amplifies price exposure and liquidation risk. Confirm the margin, route, LTV, and fee.",
        });
        setMessage("Multiply transaction submitted.");
        setAmount("");
        return;
      }
      const quote = await quoteLending({
        accountAddress: address,
        action,
        amount: amountRaw,
        asset: market.assetAddress,
        collateralAmount: action === "borrow" ? (collateralRaw ?? "0") : "0",
        collateralAsset: needsCollateral ? collateralChoice?.market.assetAddress : undefined,
        poolId: market.poolId,
      });
      const calls = buildLendingCalls({ accountAddress: address, quote });
      const collateralDetail =
        needsCollateral && collateralChoice !== null
          ? [{ label: "Position collateral", value: collateralChoice.market.symbol }]
          : [];
      await requestTransaction({
        calls,
        description:
          "Submit the reviewed Vesu V2 position update. Your wallet will show every contract call and network fee.",
        details: [
          { label: "Action", value: action[0]!.toUpperCase() + action.slice(1) },
          { label: "Amount", value: `${amount} ${market.symbol}` },
          { label: "Pool", value: market.poolName },
          { label: "Current rate", value: `${(action === "supply" || action === "withdraw" ? market.supplyApy : market.borrowApr).toFixed(2)}%` },
          ...collateralDetail,
          { label: "Allowance", value: calls.length > 1 ? "Revoked after execution" : "Not required" },
        ],
        title: `${action[0]!.toUpperCase() + action.slice(1)} ${market.symbol} on Vesu`,
        warning:
          action === "borrow"
            ? `Liquidation risk begins above ${collateralChoice?.pair.maxLtv.toFixed(2) ?? "—"}% LTV. Verify prices and amounts.`
            : "Rates are variable and can change when pool utilization changes.",
      });
      if (action === "supply") {
        setMessage("Supply broadcast. Add the Vesu receipt token in your wallet…");
        try {
          await watchAsset({ address: market.vTokenAddress });
          setMessage(`Supply broadcast. ${market.symbol} receipt token added to your wallet.`);
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : "token request stopped";
          setMessage(`Supply broadcast. Receipt token was not added: ${detail}`);
        }
      } else {
        setMessage("Transaction submitted. Position data will refresh shortly.");
      }
      setAmount("");
      if (action === "borrow") setCollateralAmount("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Vesu request failed.");
    } finally {
      setIsPreparing(false);
    }
  };

  const disabled =
    isConnecting ||
    isPreparing ||
    (isConnected &&
      (!mainnet ||
        market === null ||
        amountRaw === null ||
        (action === "borrow" && collateralRaw === null) ||
        (action === "multiply" &&
          (multiplyCollateralOutputRaw === null ||
            collateralChoice === null ||
            multiplyLtv >= collateralChoice.pair.maxLtv * 0.95)) ||
        (needsCollateral && collateralChoice === null)));

  const cta = !isConnected
    ? "Connect wallet"
    : !mainnet
      ? "Switch wallet to Mainnet"
      : market === null
        ? "Select a market"
        : amountRaw === null
          ? "Enter an amount"
          : isPreparing
            ? "Preparing review…"
            : action === "multiply"
              ? "Review Multiply"
              : `Review ${action}`;

  return (
    <aside className="lending-ticket">
      <div className="lending-action-tabs" aria-label="Position action" role="group">
        {ACTIONS.map((item) => (
          <button
            className={action === item.value ? "active" : ""}
            key={item.value}
            onClick={() => {
              setAction(item.value);
              setMessage(null);
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="lending-input-block">
          <span>{action === "borrow" || action === "repay" ? "Debt amount" : action === "multiply" ? "Initial margin" : "Amount"}</span>
        <div>
          <input
            inputMode="decimal"
            onChange={(event) => setAmount(event.currentTarget.value)}
            placeholder="0.00"
            value={amount}
          />
          <span className="lending-input-asset">
            {ticketAsset === null ? null : (
              <TokenIcon
                logoUri={avnuTokenArtwork(ticketAsset.assetAddress, null)}
                name={ticketAsset.name}
                size={22}
                symbol={ticketAsset.symbol}
              />
            )}
            <strong>{ticketAsset?.symbol ?? "—"}</strong>
          </span>
        </div>
        <small>{ticketAsset === null ? "—" : usdValue(amount, ticketAsset.priceUsd)}</small>
      </label>

      {needsCollateral ? (
        <label className="lending-field">
          <span>Collateral market</span>
          <select
            value={collateralChoice?.market.assetAddress ?? ""}
            onChange={(event) => setCollateralAddress(event.currentTarget.value)}
          >
            {collateralPairs.map((choice) => (
              <option key={choice.market.assetAddress} value={choice.market.assetAddress}>
                {choice.market.symbol} · {choice.pair.maxLtv.toFixed(0)}% max LTV
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {action === "borrow" ? (
        <label className="lending-input-block compact">
          <span>Collateral to supply</span>
          <div>
            <input
              inputMode="decimal"
              onChange={(event) => setCollateralAmount(event.currentTarget.value)}
              placeholder="0.00"
              value={collateralAmount}
            />
            <strong>{collateralChoice?.market.symbol ?? "—"}</strong>
          </div>
        </label>
      ) : null}

      {action === "multiply" ? (
        <div className="lending-multiply-planner">
          <div>
            <span><Calculator size={12} aria-hidden /> Target multiplier</span>
            <strong className="mono">{multiplier.toFixed(1)}×</strong>
          </div>
          <input
            aria-label="Target multiplier"
            max={4}
            min={1.1}
            onChange={(event) => setMultiplier(Number(event.currentTarget.value))}
            step={0.1}
            type="range"
            value={multiplier}
          />
          <dl>
            <div><dt>Projected net APR</dt><dd className={multiplyNetApr >= 0 ? "pos" : "neg"}>{multiplyNetApr.toFixed(2)}%</dd></div>
            <div><dt>Borrow leg</dt><dd>{(multiplier - 1).toFixed(1)}×</dd></div>
            <div><dt>Projected LTV</dt><dd className={collateralChoice !== null && multiplyLtv >= collateralChoice.pair.maxLtv * 0.9 ? "neg" : ""}>{multiplyLtv.toFixed(2)}%</dd></div>
            <div><dt>Route</dt><dd>Vesu · Ekubo</dd></div>
          </dl>
        </div>
      ) : null}

      {action === "borrow" && collateralChoice !== null ? (
        <div className={`lending-ltv-preview ${ltvTone}`}>
          <div>
            <span>Projected LTV</span>
            <strong className="mono">{ltv.toFixed(2)}%</strong>
          </div>
          <div className="lending-ltv-line">
            <span style={{ width: `${Math.min(100, (ltv / collateralChoice.pair.maxLtv) * 100)}%` }} />
          </div>
          <small>Liquidation threshold {collateralChoice.pair.maxLtv.toFixed(2)}%</small>
        </div>
      ) : null}

      {action === "multiply" ? (
        <div className="lending-ticket-warning">
          <TriangleAlert size={13} aria-hidden />
          Multiply amplifies yield, price exposure, borrow costs, and liquidation risk.
        </div>
      ) : null}
      {message !== null ? <p className="lending-ticket-message" role="status">{message}</p> : null}
      <button className="lending-submit" disabled={disabled} onClick={() => void submit()} type="button">
        {cta}<ArrowRight size={14} aria-hidden />
      </button>
      <p className="lending-ticket-fine">
        Mainnet only · variable rates · self-custodial · calls shown before signing
      </p>
    </aside>
  );
};
