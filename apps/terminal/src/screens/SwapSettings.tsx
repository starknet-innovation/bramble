import { Check, Settings2, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { SwapVenue } from "./swap-panel-utils";

const SLIPPAGE_OPTIONS = [10, 50, 100] as const;

type SwapSettingsProps = {
  readonly slippageBps: number;
  readonly venue: SwapVenue;
  readonly onSlippageChange: (basisPoints: number) => void;
  readonly onVenueChange: (venue: SwapVenue) => void;
};

/**
 * Compact execution settings shared by the quote and wallet-review stages.
 */
export const SwapSettings = ({
  slippageBps,
  venue,
  onSlippageChange,
  onVenueChange,
}: SwapSettingsProps): ReactNode => (
  <details className="swap-settings">
    <summary aria-label="Swap settings">
      <Settings2 aria-hidden="true" size={18} />
    </summary>
    <div className="swap-settings-popover">
      <fieldset>
        <legend>Routing</legend>
        <button
          className={venue === "avnu" ? "selected" : ""}
          type="button"
          onClick={() => onVenueChange("avnu")}
        >
          <span>
            <Zap size={14} aria-hidden="true" /> AVNU best execution
          </span>
          {venue === "avnu" && <Check size={14} aria-hidden="true" />}
        </button>
        <button
          className={venue === "ekubo" ? "selected" : ""}
          type="button"
          onClick={() => onVenueChange("ekubo")}
        >
          <span>Ekubo direct</span>
          {venue === "ekubo" && <Check size={14} aria-hidden="true" />}
        </button>
      </fieldset>
      <fieldset>
        <legend>Max slippage</legend>
        <div className="swap-slippage-options">
          {SLIPPAGE_OPTIONS.map((basisPoints) => (
            <button
              className={slippageBps === basisPoints ? "selected" : ""}
              key={basisPoints}
              type="button"
              onClick={() => onSlippageChange(basisPoints)}
            >
              {basisPoints / 100}%
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  </details>
);
