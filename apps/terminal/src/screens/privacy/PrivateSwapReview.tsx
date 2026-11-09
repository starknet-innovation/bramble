/** Displays the exact private-swap review before proof authorization. */
import type { ReactNode } from "react";
import { PRIVATE_SWAP_SLIPPAGE_BPS } from "../../../shared/privacy";
import type { PrivacyPoolSnapshot } from "../../protocols/privacy/privacy-pool";
import { formatRaw, short, type SwapReview } from "./model";

/** Render-only review; the parent owns proof submission and connection state. */
export function PrivateSwapReview({
  busy,
  pool,
  swapReview,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly pool: PrivacyPoolSnapshot | null;
  readonly swapReview: SwapReview | null;
  readonly onSubmit: () => void;
}): ReactNode {
  return (
    <aside className="privacy-review-card">
      <span>Review</span>
      {swapReview ? (
        <>
          <h3>
            {formatRaw(`0x${swapReview.sellAmount.toString(16)}`, swapReview.sellToken.decimals)}{" "}
            {swapReview.sellToken.symbol} →{" "}
            {formatRaw(`0x${swapReview.buyAmount.toString(16)}`, swapReview.buyToken.decimals)}{" "}
            {swapReview.buyToken.symbol}
          </h3>
          <dl>
            <div>
              <dt>Estimated received</dt>
              <dd>
                {formatRaw(`0x${swapReview.buyAmount.toString(16)}`, swapReview.buyToken.decimals)}{" "}
                {swapReview.buyToken.symbol}
              </dd>
            </div>
            <div>
              <dt>Minimum received</dt>
              <dd>
                {formatRaw(
                  `0x${swapReview.minBuyAmount.toString(16)}`,
                  swapReview.buyToken.decimals,
                )}{" "}
                {swapReview.buyToken.symbol}
              </dd>
            </div>
            <div>
              <dt>Slippage limit</dt>
              <dd>{(PRIVATE_SWAP_SLIPPAGE_BPS / 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt>Private executor</dt>
              <dd>
                <code>{short(swapReview.executor)}</code>
              </dd>
            </div>
            <div>
              <dt>Pool fee</dt>
              <dd>{formatRaw(swapReview.fee.amount, 18)} STRK</dd>
            </div>
            <div>
              <dt>Wallet actions</dt>
              <dd>{swapReview.actions.length}</dd>
            </div>
          </dl>
          <p>
            The wallet independently validates this batch, checks balances and privacy leakage, then
            creates the proof. The server receives only the final proof.
          </p>
          <button className="privacy-primary" disabled={busy} onClick={onSubmit} type="button">
            {busy ? "Proving…" : "Authorize proof and submit"}
          </button>
        </>
      ) : (
        <>
          <h3>No hidden execution</h3>
          <p>
            Route, exact inputs, expected output, executor, pool fee, and action count appear here
            before the wallet opens.
          </p>
          <dl>
            <div>
              <dt>Pool</dt>
              <dd>
                <code>{short(pool?.address ?? "0x040337…812a")}</code>
              </dd>
            </div>
            <div>
              <dt>Proof validity</dt>
              <dd>{pool ? `${pool.proofValidityBlocks} blocks` : "Reading…"}</dd>
            </div>
            <div>
              <dt>Auto retry</dt>
              <dd>Off</dd>
            </div>
          </dl>
        </>
      )}
    </aside>
  );
}
