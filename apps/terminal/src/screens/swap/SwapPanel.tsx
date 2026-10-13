/**
 * AVNU-inspired swap ticket for the Tokens workspace. The pay and receive
 * assets are independently selectable from the terminal token universe, while
 * choosing the asset on the opposite side reverses the pair. Quotes remain
 * read-only until the wallet review step.
 */
import { ArrowDownUp, ChevronDown, LoaderCircle, ShieldCheck } from "lucide-react";
import { userErrorMessage } from "../../protocols/support/user-error";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Call } from "starknet";
import { usePortfolio, type TokenRow } from "../../data/index";
import {
  buildAvnuSwapCalls,
  buildEkuboSwapCalls,
  MAINNET_TOKEN_ADDRESSES,
  MAINNET_TOKEN_DECIMALS,
  quoteAvnuSwap,
  quoteEkuboSwap,
} from "../../protocols/index";
import { sameAddress } from "../../protocols/support/networks";
import { useWallet } from "../../wallet/connection/WalletProvider";
import { SwapSettings } from "./SwapSettings";
import { SwapTokenButton } from "./SwapTokenButton";
import { SwapTokenPicker } from "./SwapTokenPicker";
import {
  amountInput,
  fromSmallestUnit,
  toSmallestUnit,
  usdValue,
  type PickerTarget,
  type QuoteState,
  type SwapVenue,
} from "./swap-panel-utils";

type SwapPanelProps = {
  readonly selectedToken: TokenRow;
  readonly tokens: readonly TokenRow[];
};

const ETH_ADDRESS = MAINNET_TOKEN_ADDRESSES.ETH;
const ETH_DECIMALS = MAINNET_TOKEN_DECIMALS.ETH;
const PERCENTAGES = [25, 50, 75, 100] as const;

export const SwapPanel = ({
  selectedToken,
  tokens,
}: SwapPanelProps): ReactNode => {
  const {
    address,
    isConnected,
    isConnecting,
    connect,
    requestTransaction,
  } = useWallet();
  const portfolio = usePortfolio(address);
  const [amount, setAmount] = useState("");
  const [venue, setVenue] = useState<SwapVenue>("avnu");
  const [slippageBps, setSlippageBps] = useState(50);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [search, setSearch] = useState("");
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [isQuoteFetching, setIsQuoteFetching] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [execMessage, setExecMessage] = useState<string | null>(null);

  const ethToken = useMemo<TokenRow>(
    () =>
      tokens.find((token) => sameAddress(token.address, ETH_ADDRESS)) ?? {
        address: ETH_ADDRESS,
        change24h: null,
        decimals: ETH_DECIMALS,
        liquidityUsd: null,
        logoUri: null,
        marketCapUsd: null,
        name: "Ethereum",
        priceUsd: null,
        symbol: "ETH",
        volume24hUsd: null,
      },
    [tokens],
  );
  const initialReceiveToken = useMemo(
    () =>
      sameAddress(selectedToken.address, ETH_ADDRESS)
        ? (tokens.find((token) => !sameAddress(token.address, ETH_ADDRESS)) ?? selectedToken)
        : selectedToken,
    [selectedToken, tokens],
  );
  const [spendAddress, setSpendAddress] = useState(ethToken.address);
  const [receiveAddress, setReceiveAddress] = useState(initialReceiveToken.address);
  const [pairReversed, setPairReversed] = useState(false);
  const spend =
    tokens.find((token) => sameAddress(token.address, spendAddress)) ?? ethToken;
  const receive =
    tokens.find((token) => sameAddress(token.address, receiveAddress)) ?? initialReceiveToken;
  const spendHolding = portfolio.data.holdings.find((holding) =>
    sameAddress(holding.address, spend.address),
  );
  const spendBalance = spendHolding?.amount ?? 0;
  const receiveAmount =
    quoteState.status === "ready"
      ? fromSmallestUnit(quoteState.quote.buyAmount, quoteState.receiveDecimals)
      : "";
  const minimumReceived =
    quoteState.status === "ready"
      ? fromSmallestUnit(quoteState.quote.minBuyAmount, quoteState.receiveDecimals)
      : "";

  const filteredTokens = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tokens
      .filter(
        (token) =>
          needle === "" ||
          token.symbol.toLowerCase().includes(needle) ||
          token.name.toLowerCase().includes(needle) ||
          token.address.toLowerCase().includes(needle),
      )
      .slice(0, 40);
  }, [search, tokens]);

  useEffect(() => {
    setExecMessage(null);
  }, [amount, receive.address, slippageBps, spend.address, venue]);

  useEffect(() => {
    if (isRequesting) {
      setIsQuoteFetching(false);
      return;
    }
    if (!isConnected || address === null) {
      setQuoteState({ status: "idle" });
      setIsQuoteFetching(false);
      return;
    }
    const sellAmount = toSmallestUnit(amount, spend.decimals);
    if (sellAmount === null) {
      setQuoteState({ status: "idle" });
      setIsQuoteFetching(false);
      return;
    }
    let cancelled = false;
    setIsQuoteFetching(true);
    setQuoteState((current) => (current.status === "ready" ? current : { status: "loading" }));
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const quote = await (venue === "avnu" ? quoteAvnuSwap : quoteEkuboSwap)({
            buyToken: receive.address,
            sellAmount,
            sellToken: spend.address,
            slippageBps,
            takerAddress: address,
          });
          if (!cancelled) {
            setQuoteState({ quote, receiveDecimals: receive.decimals, status: "ready" });
            setIsQuoteFetching(false);
          }
        } catch (cause) {
          if (!cancelled) {
            setQuoteState({
              message: userErrorMessage(cause, "Could not fetch a live quote."),
              status: "error",
            });
            setIsQuoteFetching(false);
          }
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    address,
    amount,
    isConnected,
    quoteVersion,
    receive.address,
    receive.decimals,
    isRequesting,
    slippageBps,
    spend.address,
    spend.decimals,
    venue,
  ]);

  useEffect(() => {
    if (quoteState.status !== "ready" || isRequesting || isQuoteFetching) {
      return;
    }
    const handle = window.setInterval(() => setQuoteVersion((value) => value + 1), 5_000);
    return () => window.clearInterval(handle);
  }, [isQuoteFetching, isRequesting, quoteState.status]);

  const chooseToken = (target: PickerTarget, token: TokenRow): void => {
    setQuoteState({ status: "idle" });
    if (target === "pay") {
      if (sameAddress(token.address, receive.address)) {
        setReceiveAddress(spend.address);
        setPairReversed((value) => !value);
      }
      setSpendAddress(token.address);
    } else {
      if (sameAddress(token.address, spend.address)) {
        setSpendAddress(receive.address);
        setPairReversed((value) => !value);
      }
      setReceiveAddress(token.address);
    }
    setPickerTarget(null);
    setSearch("");
  };

  const reversePair = (): void => {
    setQuoteState({ status: "idle" });
    setSpendAddress(receive.address);
    setReceiveAddress(spend.address);
    setPairReversed((value) => !value);
  };

  const setPercentage = (percent: number): void => {
    if (spendBalance <= 0) {
      return;
    }
    setQuoteState({ status: "idle" });
    setAmount(amountInput((spendBalance * percent) / 100, spend.decimals));
  };

  const networkFeeLabel =
    quoteState.status === "ready" &&
    quoteState.quote.gasFeesInStrk !== null &&
    quoteState.quote.gasFeesInStrk !== undefined
      ? `${fromSmallestUnit(quoteState.quote.gasFeesInStrk, 18)} STRK${
          quoteState.quote.gasFeesInUsd === null ||
          quoteState.quote.gasFeesInUsd === undefined
            ? ""
            : ` · ${usdValue("1", quoteState.quote.gasFeesInUsd)}`
        }`
      : "Estimated in wallet";

  const onSubmit = useCallback(() => {
    if (
      quoteState.status !== "ready" ||
      address === null ||
      isQuoteFetching ||
      isRequesting
    ) {
      return;
    }
    let calls: readonly Call[];
    try {
      const buildCalls =
        quoteState.quote.protocol === "avnu" ? buildAvnuSwapCalls : buildEkuboSwapCalls;
      calls = buildCalls({
        quote: quoteState.quote,
        slippageBps,
        takerAddress: address,
      });
    } catch (cause) {
      setExecMessage(userErrorMessage(cause, "Could not build the swap."));
      return;
    }
    setIsRequesting(true);
    setExecMessage("Request sent. Review it in Bramble.");
    void (async () => {
      try {
        await requestTransaction({
          calls,
          description:
            "Review the swap once in your wallet, then approve to broadcast it immediately.",
          details: [
            { label: "You pay", value: `${amount} ${spend.symbol}` },
            { label: "You receive", value: `${receiveAmount} ${receive.symbol}` },
            { label: "Route", value: venue === "avnu" ? "AVNU best execution" : "Ekubo direct" },
            { label: "Estimated network fee", value: networkFeeLabel },
            { label: "Max slippage", value: `${slippageBps / 100}%` },
          ],
          reviewMode: "wallet",
          title: `Swap ${spend.symbol} for ${receive.symbol}`,
          warning: "The output can change before execution. Verify the minimum received and fee.",
        });
        setExecMessage("Broadcast accepted. Confirmation is updating automatically.");
      } catch (cause) {
        setExecMessage(userErrorMessage(cause, "Wallet rejected the swap."));
      } finally {
        setIsRequesting(false);
      }
    })();
  }, [
    address,
    amount,
    isQuoteFetching,
    isRequesting,
    networkFeeLabel,
    quoteState,
    receive.symbol,
    receiveAmount,
    requestTransaction,
    slippageBps,
    spend.symbol,
    venue,
  ]);

  const amountIsValid = toSmallestUnit(amount, spend.decimals) !== null;
  const ctaLabel = !isConnected
    ? "Connect wallet"
    : isRequesting
      ? "Wallet review open"
      : !amountIsValid
        ? "Enter an amount"
        : isQuoteFetching
          ? "Finding the best price…"
          : quoteState.status === "error"
            ? "Try quote again"
            : "Review in wallet";
  const ctaDisabled =
    isConnecting ||
    isRequesting ||
    (isConnected &&
      (isQuoteFetching ||
        quoteState.status === "idle" ||
        quoteState.status === "loading"));
  const onCta = (): void => {
    if (!isConnected) {
      void connect();
    } else if (quoteState.status === "error") {
      setQuoteVersion((value) => value + 1);
    } else {
      onSubmit();
    }
  };

  const rate =
    quoteState.status === "ready" && Number(amount) > 0
      ? Number(receiveAmount.replace(/,/g, "")) / Number(amount)
      : null;

  return (
    <section className="swap-shell" aria-label="Swap tokens">
      <header className="swap-header">
        <div>
          <h2>Swap</h2>
          <span className="swap-provider">
            <ShieldCheck aria-hidden="true" size={13} />
            {venue === "avnu" ? "Best execution by AVNU" : "Direct via Ekubo"}
          </span>
        </div>
        <SwapSettings
          slippageBps={slippageBps}
          venue={venue}
          onSlippageChange={(basisPoints) => {
            setQuoteState({ status: "idle" });
            setSlippageBps(basisPoints);
          }}
          onVenueChange={(nextVenue) => {
            setQuoteState({ status: "idle" });
            setVenue(nextVenue);
          }}
        />
      </header>

      <div className="swap-assets">
        <div className="swap-asset-card">
          <div className="swap-asset-label">
            <span>You pay</span>
            <span>Balance {spendHolding?.display ?? "0"} {spend.symbol}</span>
          </div>
          <div className="swap-asset-main">
            <input
              aria-label="You pay amount"
              autoComplete="off"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(event) => {
                setQuoteState({ status: "idle" });
                setAmount(event.target.value);
              }}
            />
            <SwapTokenButton token={spend} onClick={() => setPickerTarget("pay")} />
          </div>
          <div className="swap-asset-foot">
            <span>{usdValue(amount, spend.priceUsd)}</span>
            <div className="swap-percentages" aria-label="Balance shortcuts">
              {PERCENTAGES.map((percent) => (
                <button
                  disabled={spendBalance <= 0}
                  key={percent}
                  type="button"
                  onClick={() => setPercentage(percent)}
                >
                  {percent === 100 ? "Max" : `${percent}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          aria-label="Switch swap direction"
          className={`swap-direction${pairReversed ? " reversed" : ""}`}
          type="button"
          onClick={reversePair}
        >
          <ArrowDownUp aria-hidden="true" size={17} strokeWidth={2.2} />
        </button>

        <div className="swap-asset-card receive">
          <div className="swap-asset-label">
            <span>You receive</span>
            <span>Estimated</span>
          </div>
          <div className="swap-asset-main">
            <input
              aria-label="You receive amount"
              placeholder={quoteState.status === "loading" ? "Quoting…" : "0"}
              readOnly
              value={receiveAmount}
            />
            <SwapTokenButton token={receive} onClick={() => setPickerTarget("receive")} />
          </div>
          <div className="swap-asset-foot">
            <span>{usdValue(receiveAmount, receive.priceUsd)}</span>
            {isQuoteFetching && (
              <span className="swap-live-status">
                <LoaderCircle aria-hidden="true" size={13} /> Refreshing quote
              </span>
            )}
            {quoteState.status === "ready" && !isQuoteFetching && (
              <span className="swap-live-status ready">
                <span aria-hidden="true" /> Live quote
              </span>
            )}
          </div>
        </div>
      </div>

      {pickerTarget !== null && (
        <SwapTokenPicker
          onChoose={(token) => chooseToken(pickerTarget, token)}
          onClose={() => setPickerTarget(null)}
          onSearchChange={setSearch}
          search={search}
          selectedAddress={pickerTarget === "pay" ? spend.address : receive.address}
          tokens={filteredTokens}
        />
      )}

      {quoteState.status === "error" && (
        <p className="swap-error" role="alert">{quoteState.message}</p>
      )}

      {quoteState.status === "ready" && (
        <details className="swap-quote-details">
          <summary>
            <span>
              1 {spend.symbol} = {rate === null ? "—" : rate.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })} {receive.symbol}
            </span>
            <ChevronDown aria-hidden="true" size={15} />
          </summary>
          <dl>
            <div><dt>Minimum received</dt><dd>{minimumReceived} {receive.symbol}</dd></div>
            <div><dt>Price impact</dt><dd>{quoteState.quote.priceImpactBps === null ||
              quoteState.quote.priceImpactBps === undefined
              ? "—"
              : `${(quoteState.quote.priceImpactBps / 100).toFixed(2)}%`}</dd></div>
            <div><dt>Network fee</dt><dd>{networkFeeLabel}</dd></div>
            <div><dt>Max slippage</dt><dd>{slippageBps / 100}%</dd></div>
            <div><dt>Route</dt><dd>{quoteState.quote.routeLabels?.join(" · ") ||
              (venue === "avnu" ? "AVNU optimized" : "Ekubo direct")}</dd></div>
          </dl>
        </details>
      )}

      {execMessage !== null && <p className="swap-exec-message" role="status">{execMessage}</p>}

      <button
        className="swap-cta"
        disabled={ctaDisabled}
        type="button"
        onClick={onCta}
      >
        {(isQuoteFetching || isRequesting) && isConnected && (
          <LoaderCircle aria-hidden="true" size={17} />
        )}
        {ctaLabel}
      </button>

      <p className="swap-disclosure">
        Quotes refresh automatically. Final calldata, minimum received, and network fee are shown
        again by your wallet before approval.
      </p>
    </section>
  );
};
