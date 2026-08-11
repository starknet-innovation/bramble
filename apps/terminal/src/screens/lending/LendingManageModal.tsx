import { ArrowRight, LoaderCircle, Radio, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { VesuMarket, VesuPosition } from "../../data/index";
import {
  buildVesuMultiplyCloseCalls,
  buildVesuMultiplyIncreaseCalls,
  buildVesuVaultDepositCalls,
  buildVesuVaultRedeemCalls,
  quoteVesuMultiplyClose,
  quoteVesuMultiplyIncrease,
} from "../../protocols/index";
import { buildLendingCalls, quoteLending } from "../../protocols/vesu/vesu";
import { useWallet } from "../../wallet/connection/WalletProvider";
import { toSmallestUnit } from "../swap/swap-panel-utils";

type ManageAction =
  | "borrow"
  | "deposit"
  | "repay"
  | "supply"
  | "redeem"
  | "unwind"
  | "wind"
  | "withdraw";

type Props = {
  readonly markets: readonly VesuMarket[];
  readonly onClose: () => void;
  readonly onSubmitted: () => void;
  readonly position: VesuPosition;
};

const actionsFor = (
  position: VesuPosition,
): readonly { readonly id: ManageAction; readonly label: string }[] => {
  switch (position.type) {
    case "earn":
      return [
        { id: "withdraw", label: "Withdraw" },
        { id: "supply", label: "Add funds" },
      ];
    case "borrow":
      return [
        { id: "repay", label: "Repay" },
        { id: "borrow", label: "Borrow more" },
      ];
    case "multiply":
      return [
        { id: "unwind", label: "Unwind" },
        { id: "wind", label: "Wind +" },
      ];
    case "vault":
      return [
        { id: "redeem", label: "Redeem" },
        { id: "deposit", label: "Add funds" },
      ];
  }
};

const actionAsset = (
  action: ManageAction,
  position: VesuPosition,
): { readonly decimals: number; readonly symbol: string } => {
  if (action === "repay" || action === "borrow") {
    return {
      decimals: position.debtDecimals ?? position.collateralDecimals,
      symbol: position.debtSymbol ?? "debt",
    };
  }
  if (action === "redeem") {
    return {
      decimals: position.sharesDecimals ?? position.collateralDecimals,
      symbol: position.sharesSymbol ?? "shares",
    };
  }
  return { decimals: position.collateralDecimals, symbol: position.collateralSymbol };
};

const maxAmount = (action: ManageAction, position: VesuPosition): string | null => {
  if (action === "withdraw") return position.collateralAmount.toString();
  if (action === "repay") return position.debtAmount.toString();
  if (action === "redeem") return position.sharesAmount?.toString() ?? null;
  return null;
};

const matchingMarket = (
  markets: readonly VesuMarket[],
  poolId: string,
  assetAddress: string | null,
): VesuMarket | null => {
  if (assetAddress === null) return null;
  return (
    markets.find(
      (market) =>
        market.poolId === poolId && BigInt(market.assetAddress) === BigInt(assetAddress),
    ) ?? null
  );
};

/** Focused, in-context position management without returning to the market desk. */
export const LendingManageModal = ({
  markets,
  onClose,
  onSubmitted,
  position,
}: Props): ReactNode => {
  const { address, requestTransaction, watchAsset } = useWallet();
  const dialogRef = useRef<HTMLElement>(null);
  const actions = useMemo(() => actionsFor(position), [position]);
  const [action, setAction] = useState<ManageAction>(actions[0]?.id ?? "withdraw");
  const [amount, setAmount] = useState("");
  const [multiplier, setMultiplier] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const debtMarket = matchingMarket(markets, position.poolId, position.debtAddress);
  const collateralMarket = matchingMarket(
    markets,
    position.poolId,
    position.collateralAddress,
  );
  const market = position.type === "borrow" || position.type === "multiply"
    ? debtMarket
    : collateralMarket;
  const receiptMarket = position.type === "vault" ? null : collateralMarket;
  const receiptSymbol = position.sharesSymbol ?? (
    receiptMarket === null ? null : `v${receiptMarket.symbol}`
  );
  const asset = actionAsset(action, position);
  const raw = toSmallestUnit(amount, asset.decimals);
  const isFullUnwind = action === "unwind";
  const currentMax = maxAmount(action, position);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    (dialog?.querySelector<HTMLElement>(focusableSelector) ?? dialog)?.focus();
    const trapFocus = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", trapFocus);
    return () => {
      window.removeEventListener("keydown", trapFocus);
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSubmitting, onClose]);

  const standardCalls = async (): Promise<readonly import("starknet").Call[]> => {
    if (address === null || market === null || raw === null) {
      throw new Error("Enter a valid amount for this position.");
    }
    const quote = await quoteLending({
      accountAddress: address,
      action: action as "borrow" | "repay" | "supply" | "withdraw",
      amount: raw,
      asset: market.assetAddress,
      collateralAmount: "0",
      collateralAsset:
        action === "borrow" || action === "repay" ? position.collateralAddress : undefined,
      poolId: position.poolId,
    });
    return buildLendingCalls({ accountAddress: address, quote });
  };

  const multiplyCalls = async (): Promise<readonly import("starknet").Call[]> => {
    if (
      address === null ||
      position.debtAddress === null ||
      position.debtRaw === null
    ) {
      throw new Error("This Multiply position is missing its debt leg.");
    }
    if (action === "unwind") {
      const route = await quoteVesuMultiplyClose(
        position.debtAddress,
        position.collateralAddress,
        BigInt(position.debtRaw),
      );
      return buildVesuMultiplyCloseCalls(
        position.poolId,
        position.collateralAddress,
        position.debtAddress,
        address,
        route,
      );
    }
    if (raw === null) throw new Error("Enter a valid margin amount.");
    const outputRaw = toSmallestUnit(
      (Number(amount) * (multiplier - 1)).toFixed(Math.min(asset.decimals, 12)),
      asset.decimals,
    );
    if (outputRaw === null) throw new Error("Enter a valid margin amount.");
    const route = await quoteVesuMultiplyIncrease(
      position.collateralAddress,
      position.debtAddress,
      BigInt(outputRaw),
    );
    return buildVesuMultiplyIncreaseCalls(
      position.poolId,
      position.collateralAddress,
      position.debtAddress,
      address,
      BigInt(raw),
      route,
    );
  };

  const vaultCalls = (): readonly import("starknet").Call[] => {
    if (address === null || raw === null) throw new Error("Enter a valid amount.");
    return action === "redeem"
      ? buildVesuVaultRedeemCalls(position.poolId, BigInt(raw), address)
      : buildVesuVaultDepositCalls(
          position.poolId,
          position.collateralAddress,
          BigInt(raw),
          address,
        );
  };

  const submit = async (): Promise<void> => {
    setIsSubmitting(true);
    setMessage(action === "unwind" || action === "wind" ? "Quoting atomic route…" : "Preparing calls…");
    try {
      const calls =
        position.type === "multiply"
          ? await multiplyCalls()
          : position.type === "vault"
            ? vaultCalls()
            : await standardCalls();
      await requestTransaction({
        calls,
        description: `Manage the existing Vesu ${position.type} position without leaving its current context.`,
        details: [
          { label: "Action", value: actions.find((item) => item.id === action)?.label ?? action },
          { label: "Position", value: `${position.collateralSymbol} · ${position.poolName}` },
          {
            label: "Amount",
            value: isFullUnwind ? "Full position" : `${amount} ${asset.symbol}`,
          },
          { label: "Oracle", value: market?.oracleKey ?? "Pool configured" },
        ],
        reviewMode: "wallet",
        title: `${actions.find((item) => item.id === action)?.label ?? action} ${position.collateralSymbol}`,
        warning:
          action === "borrow" || action === "wind"
            ? "This increases exposure and liquidation risk. Verify the amount and fee."
            : "Verify the amount and final wallet calldata before approval.",
      });
      if (action === "supply" && market !== null) {
        setMessage("Transaction broadcast. Add the receipt token in your wallet…");
        try {
          await watchAsset({ address: market.vTokenAddress });
        } catch {
          setMessage("Transaction broadcast. The receipt token was not added to the wallet.");
          onSubmitted();
          return;
        }
      }
      setMessage("Broadcast accepted. Position confirmation is updating.");
      onSubmitted();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Position request failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const trackReceiptToken = async (): Promise<void> => {
    if (receiptMarket === null || receiptSymbol === null) return;
    setIsTracking(true);
    setMessage(`Opening the wallet to add ${receiptSymbol}…`);
    try {
      await watchAsset({ address: receiptMarket.vTokenAddress });
      setMessage(`${receiptSymbol} is now tracked in the wallet.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Receipt token was not added.");
    } finally {
      setIsTracking(false);
    }
  };

  return (
    <div className="lending-manage-backdrop">
      <section
        aria-labelledby="lending-manage-title"
        aria-modal="true"
        className="lending-manage-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <span>Manage position</span>
            <h2 id="lending-manage-title">
              {position.collateralSymbol}
              {position.debtSymbol === null ? "" : ` / ${position.debtSymbol}`}
            </h2>
          </div>
          <button aria-label="Close position manager" disabled={isSubmitting} onClick={onClose} type="button">
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="lending-manage-snapshot">
          <div><span>Supplied</span><strong>{position.collateralAmount.toLocaleString()} {position.collateralSymbol}</strong></div>
          <div><span>Debt</span><strong>{position.debtSymbol === null ? "None" : `${position.debtAmount.toLocaleString()} ${position.debtSymbol}`}</strong></div>
          <div><span>Health</span><strong>{position.healthFactor === null ? "—" : `${position.healthFactor.toFixed(2)}×`}</strong></div>
        </div>

        <div className="lending-manage-actions" role="group" aria-label="Position action">
          {actions.map((item) => (
            <button
              aria-pressed={action === item.id}
              className={action === item.id ? "active" : ""}
              key={item.id}
              onClick={() => {
                setAction(item.id);
                setAmount("");
                setMessage(null);
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        {isFullUnwind ? (
          <div className="lending-manage-full">
            <strong>Close the full multiplied position</strong>
            <span>Debt is repaid atomically and residual collateral returns to the wallet.</span>
          </div>
        ) : (
          <label className="lending-manage-amount">
            <span>{action === "wind" ? "Additional margin" : "Amount"}</span>
            <div>
              <input
                aria-label="Position amount"
                autoFocus
                inputMode="decimal"
                onChange={(event) => setAmount(event.currentTarget.value)}
                placeholder="0.00"
                value={amount}
              />
              <strong>{asset.symbol}</strong>
              {currentMax === null ? null : (
                <button onClick={() => setAmount(currentMax)} type="button">Max</button>
              )}
            </div>
          </label>
        )}

        {action === "wind" ? (
          <label className="lending-manage-multiplier">
            <span>Target multiplier <strong>{multiplier.toFixed(1)}×</strong></span>
            <input
              max={4}
              min={1.1}
              onChange={(event) => setMultiplier(Number(event.currentTarget.value))}
              step={0.1}
              type="range"
              value={multiplier}
            />
          </label>
        ) : null}

        <div className="lending-manage-context">
          <span><Radio size={11} aria-hidden /> {market?.oracleKey ?? "Vesu pool oracle"}</span>
          {receiptSymbol === null ? (
            <span>{position.poolName}</span>
          ) : (
            <button
              disabled={isSubmitting || isTracking}
              onClick={() => void trackReceiptToken()}
              type="button"
            >
              {isTracking ? "Opening wallet…" : `Track ${receiptSymbol}`}
            </button>
          )}
        </div>
        {message === null ? null : <p role="status">{message}</p>}
        <footer>
          <button disabled={isSubmitting} onClick={onClose} type="button">Cancel</button>
          <button
            disabled={isSubmitting || (!isFullUnwind && raw === null)}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? <LoaderCircle size={14} aria-hidden /> : null}
            Review in wallet <ArrowRight size={14} aria-hidden />
          </button>
        </footer>
      </section>
    </div>
  );
};
