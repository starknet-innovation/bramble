import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { TokenIcon } from "../../components/index";
import type { TokenRow } from "../../data/index";

type SwapTokenButtonProps = {
  readonly token: TokenRow;
  readonly onClick: () => void;
};

/**
 * Asset selector used by both sides of the swap pair.
 */
export const SwapTokenButton = ({
  token,
  onClick,
}: SwapTokenButtonProps): ReactNode => (
  <button
    className="swap-token-button"
    type="button"
    onClick={onClick}
    aria-label={`Select ${token.symbol} token`}
  >
    <TokenIcon
      symbol={token.symbol}
      logoUri={token.logoUri}
      name={token.name}
      size={30}
    />
    <span>{token.symbol}</span>
    <ChevronDown aria-hidden="true" size={15} strokeWidth={2.2} />
  </button>
);
