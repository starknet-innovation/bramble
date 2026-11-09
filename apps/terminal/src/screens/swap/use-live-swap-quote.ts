/**
 * The swap ticket's live quote: debounced on every input change, refreshed
 * every five seconds while a ready quote is on screen, and paused while the
 * wallet review is open. Read-only; nothing here signs or submits.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { quoteAvnuSwap, quoteEkuboSwap } from "../../protocols/index";
import { userErrorMessage } from "../../protocols/support/user-error";
import { toSmallestUnit, type QuoteState, type SwapVenue } from "./swap-panel-utils";

type LiveQuoteInput = {
  readonly address: string | null;
  readonly amount: string;
  readonly isConnected: boolean;
  readonly isRequesting: boolean;
  readonly receive: { readonly address: string; readonly decimals: number };
  readonly slippageBps: number;
  readonly spend: { readonly address: string; readonly decimals: number };
  readonly venue: SwapVenue;
};

/** The quote, its in-flight flag, and the two controls the ticket drives. */
export type LiveQuote = {
  readonly isQuoteFetching: boolean;
  readonly quoteState: QuoteState;
  readonly requote: () => void;
  readonly setQuoteState: Dispatch<SetStateAction<QuoteState>>;
};

/**
 * Keeps a live quote for the ticket's inputs. A failed quote is reported as
 * the user-facing error sentence; a stale answer for inputs that have since
 * changed is dropped.
 */
export const useLiveSwapQuote = ({
  address,
  amount,
  isConnected,
  isRequesting,
  receive,
  slippageBps,
  spend,
  venue,
}: LiveQuoteInput): LiveQuote => {
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [isQuoteFetching, setIsQuoteFetching] = useState(false);

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

  return {
    isQuoteFetching,
    quoteState,
    requote: () => setQuoteVersion((value) => value + 1),
    setQuoteState,
  };
};
