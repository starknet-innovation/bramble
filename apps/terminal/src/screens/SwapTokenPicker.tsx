import { Check, Search } from "lucide-react";
import type { ReactNode } from "react";
import { TokenIcon } from "../components";
import type { TokenRow } from "../data";
import { sameAddress } from "../protocols/support/networks";

type SwapTokenPickerProps = {
  readonly onChoose: (token: TokenRow) => void;
  readonly onClose: () => void;
  readonly onSearchChange: (value: string) => void;
  readonly search: string;
  readonly selectedAddress: string;
  readonly tokens: readonly TokenRow[];
};

/**
 * Searchable AVNU token universe shown over the swap ticket.
 */
export const SwapTokenPicker = ({
  onChoose,
  onClose,
  onSearchChange,
  search,
  selectedAddress,
  tokens,
}: SwapTokenPickerProps): ReactNode => (
  <div className="swap-token-picker" role="dialog" aria-label="Choose a token">
    <div className="swap-token-search">
      <Search aria-hidden="true" size={16} />
      <input
        aria-label="Search tokens"
        autoFocus
        placeholder="Search name, symbol, or address"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
    <div className="swap-token-results" role="listbox">
      {tokens.map((token) => {
        const isSelected = sameAddress(token.address, selectedAddress);
        return (
          <button
            aria-selected={isSelected}
            key={token.address}
            role="option"
            type="button"
            onClick={() => onChoose(token)}
          >
            <TokenIcon
              symbol={token.symbol}
              logoUri={token.logoUri}
              name={token.name}
              size={34}
            />
            <span>
              <strong>{token.symbol}</strong>
              <small>{token.name}</small>
            </span>
            {isSelected && <Check aria-hidden="true" size={16} />}
          </button>
        );
      })}
    </div>
  </div>
);
