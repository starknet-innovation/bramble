import { Check, ExternalLink, ShieldCheck, WalletCards, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { shortenAddress } from "../../shell/screens";
import type { WalletRequestView } from "./wallet-request";

type WalletRequestDialogProps = {
  readonly address: string | null;
  readonly chainName: string;
  readonly request: WalletRequestView;
  readonly walletName: string | null;
  readonly onApprove: () => void;
  readonly onCancel: () => void;
  readonly onClose: () => void;
  readonly onRetry: () => void;
};

const requestEyebrow = (request: WalletRequestView): string => {
  if (request.phase === "review") return "Review request";
  if (request.phase === "awaiting") return "Secure wallet handoff";
  if (request.phase === "failed") return "Not submitted";
  return "Request submitted";
};

/** Terminal-side transaction review and wallet hand-off feedback. */
export const WalletRequestDialog = ({
  address,
  chainName,
  request,
  walletName,
  onApprove,
  onCancel,
  onClose,
  onRetry,
}: WalletRequestDialogProps): ReactNode => {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? dialog)?.focus();
    const trapFocus = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
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
      if (event.key !== "Escape") return;
      if (request.phase === "submitted") {
        onClose();
      } else if (request.phase !== "awaiting") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, onClose, request.phase]);

  const canDismiss = request.phase !== "awaiting";
  return (
    <div className="wallet-request-backdrop">
      <section
        aria-describedby="wallet-request-description"
        aria-labelledby="wallet-request-title"
        aria-modal="true"
        className="wallet-request-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="wallet-request-header">
          <div className={`wallet-request-mark ${request.phase}`}>
            {request.phase === "submitted" ? (
              <Check size={20} aria-hidden />
            ) : (
              <WalletCards size={20} aria-hidden />
            )}
          </div>
          <div>
            <p className="wallet-request-eyebrow">{requestEyebrow(request)}</p>
            <h2 id="wallet-request-title">{request.preview.title}</h2>
          </div>
          {canDismiss ? (
            <button
              aria-label="Close wallet request"
              className="wallet-request-close"
              onClick={request.phase === "submitted" ? onClose : onCancel}
              type="button"
            >
              <X size={17} aria-hidden />
            </button>
          ) : null}
        </header>

        <p className="wallet-request-description" id="wallet-request-description">
          {request.preview.description}
        </p>

        <div className="wallet-request-route" aria-label="Request route">
          <div>
            <span>From</span>
            <strong>{address === null ? "No account" : shortenAddress(address)}</strong>
          </div>
          <ExternalLink size={14} aria-hidden />
          <div>
            <span>Via</span>
            <strong>{walletName ?? "Starknet wallet"}</strong>
          </div>
          <div>
            <span>Network</span>
            <strong>{chainName}</strong>
          </div>
        </div>

        {request.preview.details.length > 0 ? (
          <dl className="wallet-request-details">
            {request.preview.details.map((detail) => (
              <div key={`${detail.label}:${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
            {request.preview.callCount !== undefined ? (
              <div>
                <dt>Calls</dt>
                <dd>{request.preview.callCount}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {request.preview.warning ? (
          <p className="wallet-request-warning">{request.preview.warning}</p>
        ) : null}

        {request.phase === "awaiting" ? (
          <div className="wallet-request-state" role="status">
            <span className="wallet-request-spinner" aria-hidden />
            <div>
              <strong>Request sent to {walletName ?? "your wallet"}</strong>
              <span>Review once, then approve or reject. Broadcast starts immediately.</span>
            </div>
          </div>
        ) : null}
        {request.phase === "failed" ? (
          <div className="wallet-request-state failed" role="alert">
            <X size={17} aria-hidden />
            <div>
              <strong>Request stopped</strong>
              <span>{request.message}</span>
            </div>
          </div>
        ) : null}
        {request.phase === "submitted" ? (
          <div className="wallet-request-state submitted" role="status">
            <ShieldCheck size={18} aria-hidden />
            <div>
              <strong>Handed to Starknet</strong>
              <span className="mono">{shortenAddress(request.transactionHash)}</span>
            </div>
          </div>
        ) : null}

        <footer className="wallet-request-actions">
          {request.phase === "review" ? (
            <>
              <button className="wallet-request-secondary" onClick={onCancel} type="button">
                Cancel
              </button>
              <button className="wallet-request-primary" onClick={onApprove} type="button">
                Continue in wallet
              </button>
            </>
          ) : null}
          {request.phase === "failed" ? (
            <>
              <button className="wallet-request-secondary" onClick={onCancel} type="button">
                Close
              </button>
              <button className="wallet-request-primary" onClick={onRetry} type="button">
                Try again
              </button>
            </>
          ) : null}
          {request.phase === "submitted" ? (
            <button className="wallet-request-primary full" onClick={onClose} type="button">
              Done
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
};
