import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { TokenDeployment } from "../../create/token-create";
import { TOKEN_PRESET_RELEASE, TOKEN_PRESET_SOURCE_URL, type TokenStandard } from "../../create/token-presets";
import { punkContractUrl, punkTransactionUrl } from "../../nft/punk-runtime";

/**
 * Progress of one create, from wallet review to the on-chain class check.
 * `chainId` is the network the create was sent on, so its explorer links stay
 * right if the wallet switches network afterwards.
 */
export type CreateOperation =
  | {
      readonly tone: "busy";
      readonly chainId: string | null;
      readonly message: string;
      readonly transactionHash?: string;
    }
  | {
      readonly tone: "error";
      readonly chainId: string | null;
      readonly message: string;
      readonly transactionHash?: string;
    }
  | {
      readonly tone: "success";
      readonly address: string;
      readonly chainId: string | null;
      readonly message: string;
      readonly transactionHash: string;
    };

/** Form fields across the three standards; each standard reads its own. */
export type CreateFields = {
  readonly amounts: string;
  readonly baseUri: string;
  readonly name: string;
  readonly recipient: string;
  readonly supply: string;
  readonly symbol: string;
  readonly tokenIds: string;
};

export const STANDARD_TABS: readonly { readonly id: TokenStandard; readonly label: string }[] = [
  { id: "erc20", label: "ERC-20" },
  { id: "erc721", label: "ERC-721" },
  { id: "erc1155", label: "ERC-1155" },
];

type FieldSpec = {
  readonly key: keyof CreateFields;
  readonly label: string;
  readonly placeholder: string;
  readonly inputMode?: "decimal" | "text";
};

const NAME: FieldSpec = { key: "name", label: "Name", placeholder: "Bramble Garden" };
const SYMBOL: FieldSpec = { key: "symbol", label: "Symbol", placeholder: "GRDN" };
const BASE_URI: FieldSpec = { key: "baseUri", label: "Base URI", placeholder: "ipfs://…/" };
const TOKEN_IDS: FieldSpec = { key: "tokenIds", label: "Token ids", placeholder: "1, 2, 3" };

/** Fields shown for each standard, in form order. */
export const FIELDS_BY_STANDARD: Readonly<Record<TokenStandard, readonly FieldSpec[]>> = {
  erc20: [
    NAME,
    SYMBOL,
    { inputMode: "decimal", key: "supply", label: "Supply", placeholder: "1000000" },
    { key: "recipient", label: "Send supply to", placeholder: "0x… address" },
  ],
  erc721: [NAME, SYMBOL, BASE_URI, TOKEN_IDS, { key: "recipient", label: "Mint to", placeholder: "0x… address" }],
  erc1155: [
    BASE_URI,
    TOKEN_IDS,
    { key: "amounts", label: "Amounts", placeholder: "100, 1, 1" },
    { key: "recipient", label: "Mint to", placeholder: "0x… address" },
  ],
};

/** The fixed outcome of the current form: address, facts and the pinned class. */
export const CreateReview = ({
  deployment,
  problem,
}: {
  readonly deployment: TokenDeployment | null;
  readonly problem: string | null;
}): ReactNode => (
  <aside className="create-review" aria-label="Create review">
    <div className="studio-recipe__eyebrow">Will deploy to</div>
    {deployment === null ? (
      <p className="create-review__empty">{problem ?? "Fill in the form to see the contract address."}</p>
    ) : (
      <>
        <code className="create-review__address">{deployment.address}</code>
        <dl className="create-review__facts">
          {deployment.details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
        <p className="create-review__note">
          Upgradeable contract: your account owns it and can change its code later.
        </p>
      </>
    )}
    <a className="studio-source-link" href={TOKEN_PRESET_SOURCE_URL} rel="noreferrer" target="_blank">
      {TOKEN_PRESET_RELEASE} <ExternalLink size={12} />
    </a>
  </aside>
);

/** Status line under the form, with explorer links once there is a hash. */
export const CreateStatus = ({ operation }: { readonly operation: CreateOperation | null }): ReactNode => {
  if (operation === null) return null;
  const { chainId } = operation;
  return (
    <div className={`studio-status studio-status--${operation.tone}`} role="status">
      <span className="studio-status__pulse" />
      <span>{operation.message}</span>
      {operation.tone === "success" ? (
        <a href={punkContractUrl(chainId, operation.address)} rel="noreferrer" target="_blank">
          Open contract <ExternalLink size={12} />
        </a>
      ) : operation.transactionHash !== undefined ? (
        <a href={punkTransactionUrl(chainId, operation.transactionHash)} rel="noreferrer" target="_blank">
          View transaction <ExternalLink size={12} />
        </a>
      ) : null}
    </div>
  );
};
