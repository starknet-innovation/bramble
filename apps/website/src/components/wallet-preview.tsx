import { useState } from "react";
import { Button } from "./ui/button";

export const WalletPreview = () => {
  const [decision, setDecision] = useState<"confirmed" | "rejected" | null>(null);
  return (
    <figure aria-label="Interactive transaction review example" className="wallet-preview">
      <div className="wallet-heading">
        <img alt="" height="28" src="/brand/mark.svg" />
        <span>Review request</span>
      </div>
      <div className="wallet-request">
        <p>You are sending</p>
        <strong className="wallet-amount">128.40 STRK</strong>
        <dl>
          <div>
            <dt>To</dt>
            <dd>0x04f2…9c1a</dd>
          </div>
          <div>
            <dt>Call</dt>
            <dd>transfer</dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>0.0002 ETH</dd>
          </div>
        </dl>
      </div>
      <div className="wallet-actions">
        {decision === null ? (
          <>
            <Button onClick={() => setDecision("confirmed")} type="button">
              Confirm
            </Button>
            <Button onClick={() => setDecision("rejected")} type="button" variant="ghost">
              Reject
            </Button>
          </>
        ) : (
          <Button onClick={() => setDecision(null)} type="button" variant="ghost">
            Try again
          </Button>
        )}
      </div>
      <figcaption aria-live="polite">
        {decision === null
          ? "Interactive example. No funds are moved."
          : `Example ${decision}. No transaction was signed or sent.`}
      </figcaption>
    </figure>
  );
};
