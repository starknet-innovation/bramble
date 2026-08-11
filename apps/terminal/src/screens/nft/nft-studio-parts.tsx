import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import type { FormEventHandler, ReactNode } from "react";
import { PUNK_MAINNET_CONTRACT } from "../../nft/punk-contract";
import { punkTransactionUrl } from "../../nft/punk-runtime";

export type StudioOperation = {
  readonly message: string;
  readonly tone: "busy" | "error" | "success";
  readonly transactionHash?: string;
};

export const StudioStatus = ({
  chainId,
  operation,
}: {
  readonly chainId: string | null;
  readonly operation: StudioOperation | null;
}): ReactNode => {
  if (operation === null) {
    return (
      <div className="studio-status studio-status--idle">
        <span className="studio-status__pulse" />
        Ready to mint from the deployed collection
      </div>
    );
  }
  return (
    <div className={`studio-status studio-status--${operation.tone}`} role="status">
      <span className="studio-status__pulse" />
      <span>{operation.message}</span>
      {operation.transactionHash !== undefined && chainId !== null ? (
        <a
          href={punkTransactionUrl(chainId, operation.transactionHash)}
          rel="noreferrer"
          target="_blank"
        >
          View transaction <ExternalLink size={12} />
        </a>
      ) : null}
    </div>
  );
};

export const StudioRecipe = (): ReactNode => (
  <aside className="studio-recipe" aria-label="Deployed collection details">
    <div className="studio-recipe__eyebrow">Deployed collection</div>
    <h2>One collection. One focused mint flow.</h2>
    <p>
      MC Punks is already live on Starknet Mainnet. This surface prepares only
      the owner-authorized mint call and leaves deployment and transfers to
      dedicated tooling.
    </p>
    <ul>
      <li>
        <Check size={14} /> Pinned Mainnet contract
      </li>
      <li>
        <Check size={14} /> Owner-authorized mint
      </li>
      <li>
        <Check size={14} /> Per-token Base64 metadata
      </li>
      <li>
        <Check size={14} /> Fixed 0–9999 catalog
      </li>
      <li>
        <Check size={14} /> Wallet review before submit
      </li>
    </ul>
    <div className="studio-recipe__off">
      <span>Launch controls</span>
      <strong>Removed</strong>
    </div>
    <a
      className="studio-source-link"
      href="https://github.com/OpenZeppelin/cairo-contracts/tree/v3.0.0"
      rel="noreferrer"
      target="_blank"
    >
      OpenZeppelin Cairo v3.0.0 <ExternalLink size={12} />
    </a>
  </aside>
);

export type StudioWorkbenchProps = {
  readonly busy: boolean;
  readonly chainId: string | null;
  readonly connectButton: ReactNode;
  readonly isConnected: boolean;
  readonly isMainnet: boolean;
  readonly onRecipientChange: (value: string) => void;
  readonly onSubmitMint: FormEventHandler;
  readonly operation: StudioOperation | null;
  readonly previewId: number;
  readonly recipient: string;
  readonly tokenId: number | null;
};

/** The mint-only action surface for the deployed Mainnet collection. */
export const StudioWorkbench = ({
  busy,
  chainId,
  connectButton,
  isConnected,
  isMainnet,
  onRecipientChange,
  onSubmitMint,
  operation,
  previewId,
  recipient,
  tokenId,
}: StudioWorkbenchProps): ReactNode => (
  <section className="studio-workbench">
    <div className="studio-workbench__body">
      <label className="studio-field">
        <span>Deployed collection</span>
        <div className="studio-address-field">
          <input
            aria-label="Deployed collection"
            readOnly
            spellCheck={false}
            value={PUNK_MAINNET_CONTRACT}
          />
          <button
            aria-label="Copy collection address"
            onClick={() => void navigator.clipboard.writeText(PUNK_MAINNET_CONTRACT)}
            type="button"
          >
            <Copy size={14} />
          </button>
        </div>
      </label>

      <form className="studio-action-form" onSubmit={onSubmitMint}>
        <div className="studio-action-heading">
          <div className="studio-action-icon">
            <Sparkles size={18} />
          </div>
          <div>
            <h2>Mint Punk #{previewId}</h2>
            <p>Only the collection owner can mint an unclaimed catalog id.</p>
          </div>
        </div>
        <label className="studio-field">
          <span>Mint to</span>
          <input
            onChange={(event) => onRecipientChange(event.target.value)}
            placeholder="0x… recipient address"
            spellCheck={false}
            value={recipient}
          />
        </label>
        {!isConnected ? (
          connectButton
        ) : (
          <button
            className="studio-primary"
            disabled={busy || tokenId === null || !isMainnet}
            type="submit"
          >
            {isMainnet ? `Mint Punk #${previewId}` : "Switch to Mainnet"}{" "}
            <Sparkles size={14} />
          </button>
        )}
      </form>

      <StudioStatus chainId={chainId} operation={operation} />
    </div>
  </section>
);
