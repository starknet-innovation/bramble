import { Copy, Download, FileJson, Plus, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  buildTokenMetadata,
  MAX_TRAITS,
  type MetadataTrait,
  type TokenMetadata as Metadata,
} from "../../create/token-metadata";
import { isSharedErc1155Uri, metadataFileName, readBaseUri, resolveTokenUri } from "../../create/token-uri";
import { userErrorMessage } from "../../protocols/support/user-error";

type TokenMetadataProps = {
  readonly baseUri: string;
  readonly standard: "erc721" | "erc1155";
  /** The create form's token ids; the first one fills an empty token id. */
  readonly tokenIds: string;
};

type TextKey = "description" | "image" | "name" | "tokenId";

type TraitRow = MetadataTrait & { readonly key: number };

const emptyRow = (key: number): TraitRow => ({ key, trait: "", value: "" });

const tokenUriFor = (standard: "erc721" | "erc1155", baseUri: string, tokenId: bigint): string | null => {
  try {
    return resolveTokenUri(standard, readBaseUri(baseUri, standard), tokenId);
  } catch {
    return null;
  }
};

/**
 * Per-token metadata authoring for an ERC-721 or ERC-1155 collection. Builds
 * the JSON file for one token and shows the URI it must be hosted at. Nothing
 * is uploaded or fetched: the user copies or downloads the file and hosts it.
 */
export default function TokenMetadata({ baseUri, standard, tokenIds }: TokenMetadataProps): ReactNode {
  const [text, setText] = useState<Record<TextKey, string>>({ description: "", image: "", name: "", tokenId: "" });
  const [traits, setTraits] = useState<readonly TraitRow[]>([emptyRow(0)]);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const tokenId = text.tokenId || (tokenIds.split(/[\s,]+/).find((part) => part !== "") ?? "");

  const built = useMemo((): { metadata: Metadata | null; problem: string | null } => {
    if (text.name.trim() === "" && text.image.trim() === "") return { metadata: null, problem: null };
    try {
      return { metadata: buildTokenMetadata({ ...text, tokenId, traits }), problem: null };
    } catch (cause) {
      return { metadata: null, problem: userErrorMessage(cause, "Check the metadata.") };
    }
  }, [text, tokenId, traits]);

  const metadata = built.metadata;
  const tokenUri = metadata === null ? null : tokenUriFor(standard, baseUri, metadata.tokenId);
  const fileName = metadata === null ? null : metadataFileName(tokenUri, metadata.tokenId);

  const edit = (key: TextKey, value: string): void => {
    setText((current) => ({ ...current, [key]: value }));
    setCopied(null);
  };
  const editTrait = (index: number, key: keyof MetadataTrait, value: string): void => {
    setTraits((current) => current.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
    setCopied(null);
  };
  const copy = (json: string): void => {
    void navigator.clipboard.writeText(json).then(
      () => setCopied("copied"),
      () => setCopied("failed"),
    );
  };

  return (
    <section className="studio-action-form create-tool" aria-label="Token metadata">
      <div className="studio-action-heading">
        <div className="studio-action-icon">
          <FileJson size={17} />
        </div>
        <div>
          <h2>Token metadata</h2>
          <p>Write a token's JSON file, then host it at its token URI.</p>
        </div>
      </div>
      <div className="studio-form-grid">
        <label className="studio-field">
          <span>Token id</span>
          <input
            onChange={(event) => edit("tokenId", event.target.value)}
            placeholder="1"
            spellCheck={false}
            value={tokenId}
          />
        </label>
        <label className="studio-field">
          <span>Token name</span>
          <input onChange={(event) => edit("name", event.target.value)} placeholder="Garden #1" value={text.name} />
        </label>
      </div>
      <label className="studio-field">
        <span>Image URI</span>
        <input
          onChange={(event) => edit("image", event.target.value)}
          placeholder="ipfs://…/1.png"
          spellCheck={false}
          value={text.image}
        />
      </label>
      <label className="studio-field">
        <span>Description</span>
        <textarea onChange={(event) => edit("description", event.target.value)} rows={3} value={text.description} />
      </label>
      <fieldset className="create-traits">
        <legend>Traits</legend>
        {traits.map((row, index) => (
          <div className="create-traits__row" key={row.key}>
            <input
              aria-label={`Trait ${index + 1}`}
              onChange={(event) => editTrait(index, "trait", event.target.value)}
              placeholder="Background"
              value={row.trait}
            />
            <input
              aria-label={`Value ${index + 1}`}
              onChange={(event) => editTrait(index, "value", event.target.value)}
              placeholder="Moss"
              value={row.value}
            />
            <button
              aria-label={`Remove trait ${index + 1}`}
              className="studio-secondary"
              onClick={() => setTraits((current) => current.filter((_, at) => at !== index))}
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          className="studio-secondary"
          disabled={traits.length >= MAX_TRAITS}
          onClick={() =>
            setTraits((current) => [...current, emptyRow(Math.max(-1, ...current.map((row) => row.key)) + 1)])
          }
          type="button"
        >
          <Plus size={12} /> Add trait
        </button>
      </fieldset>
      {metadata === null ? (
        <p className="create-review__empty">{built.problem ?? "Add a name and an image URI to see the file."}</p>
      ) : (
        <>
          <dl className="create-review__facts">
            <div>
              <dt>Token URI</dt>
              <dd>{tokenUri ?? "Enter a valid base URI above to see it."}</dd>
            </div>
            <div>
              <dt>File name</dt>
              <dd>{fileName}</dd>
            </div>
          </dl>
          {standard === "erc1155" && tokenUri !== null && isSharedErc1155Uri(baseUri.trim()) ? (
            <p className="create-review__note">
              Every token id uses this one file. Add {"{id}"} to the base URI for one file per token.
            </p>
          ) : null}
          <pre className="create-json" aria-label="Metadata JSON">
            {metadata.json}
          </pre>
          <div className="studio-button-pair">
            <button className="studio-secondary" onClick={() => copy(metadata.json)} type="button">
              <Copy size={12} /> {copied === "copied" ? "Copied" : "Copy JSON"}
            </button>
            <a
              className="studio-secondary"
              download={fileName ?? undefined}
              href={`data:application/json;charset=utf-8,${encodeURIComponent(metadata.json)}`}
            >
              <Download size={12} /> Download JSON
            </a>
          </div>
          {copied === "failed" ? (
            <p className="create-review__empty">Couldn't copy. Select the JSON and copy it.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
