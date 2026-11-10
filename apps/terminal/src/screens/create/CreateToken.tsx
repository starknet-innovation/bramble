import { addressLabel } from "@bramble/wallet-model/networks";
import { Hammer, ShieldCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { confirmTokenDeployment, createNetworkFor, createNetworkNames } from "../../create/create-runtime";
import { assertErc1155Recipient } from "../../create/recipient-check";
import { buildTokenDeployment, type TokenDeployment } from "../../create/token-create";
import { TOKEN_PRESETS, type TokenStandard } from "../../create/token-presets";
import { userErrorMessage } from "../../protocols/support/user-error";
import type { ScreenId } from "../../shell/screens";
import { useWallet } from "../../wallet/connection/WalletProvider";
import {
  type CreateFields,
  type CreateOperation,
  CreateReview,
  CreateStatus,
  FIELDS_BY_STANDARD,
  STANDARD_TABS,
} from "./create-parts";
import TokenMetadata from "./TokenMetadata";
import TokenOwnership from "./TokenOwnership";

type CreateTokenProps = {
  readonly onNavigate: (screen: ScreenId) => void;
  /** Injectable for tests; production draws a fresh 248-bit salt. */
  readonly makeSalt?: () => string;
};

const EMPTY_FIELDS: CreateFields = {
  amounts: "",
  baseUri: "",
  name: "",
  recipient: "",
  supply: "",
  symbol: "",
  tokenIds: "",
};

/** A random non-zero felt below 2^248, so it is always a valid salt. */
const randomSalt = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  bytes[30] = bytes[30] === 0 ? 1 : (bytes[30] ?? 1);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const draftFor = (standard: TokenStandard, fields: CreateFields, recipient: string) => {
  switch (standard) {
    case "erc20":
      return { ...fields, recipient, standard };
    case "erc721":
      return { ...fields, recipient, standard };
    case "erc1155":
      return { ...fields, recipient, standard };
  }
};

const isBlank = (standard: TokenStandard, fields: CreateFields): boolean =>
  FIELDS_BY_STANDARD[standard].every((field) => field.key === "recipient" || fields[field.key].trim() === "");

const transactionHashOf = (value: unknown): string => {
  const hash = (value as { readonly transaction_hash?: unknown } | null)?.transaction_hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error("Wallet returned an invalid transaction hash.");
  }
  return hash;
};

/**
 * Create: deploy a pinned OpenZeppelin ERC-20, ERC-721 or ERC-1155 preset
 * through the Universal Deployer, minting the initial supply in its
 * constructor. One call, reviewed here and then in the connected wallet; the
 * screen reports success only after the class at the new address is checked.
 */
export default function CreateToken({ makeSalt = randomSalt }: CreateTokenProps): ReactNode {
  const { address, chainId, connect, isConnected, isConnecting, requestTransaction } = useWallet();
  const [standard, setStandard] = useState<TokenStandard>("erc20");
  const [fields, setFields] = useState<CreateFields>(EMPTY_FIELDS);
  const [salt, setSalt] = useState(makeSalt);
  const [operation, setOperation] = useState<CreateOperation | null>(null);
  const network = createNetworkFor(chainId);
  const recipient = fields.recipient || address || "";
  const busy = operation?.tone === "busy";
  // A created contract occupies its address; resubmitting would only revert.
  const done = operation?.tone === "success";

  const preview = useMemo((): { deployment: TokenDeployment | null; problem: string | null } => {
    if (address === null || isBlank(standard, fields)) return { deployment: null, problem: null };
    try {
      return { deployment: buildTokenDeployment(draftFor(standard, fields, recipient), address, salt), problem: null };
    } catch (cause) {
      return { deployment: null, problem: userErrorMessage(cause, "Check the form.") };
    }
  }, [address, fields, recipient, salt, standard]);

  const update = (key: keyof CreateFields, value: string): void => {
    setFields((current) => ({ ...current, [key]: value }));
    // After a create, the review keeps showing the deployed address until the
    // form changes; the next create then gets a fresh salt and a new address.
    if (operation?.tone === "success") setSalt(makeSalt());
    if (operation?.tone !== "busy") setOperation(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    let transactionHash: string | undefined;
    try {
      if (!isConnected || address === null) throw new Error("Connect a wallet first.");
      if (network === null) throw new Error(`Switch your wallet to ${createNetworkNames()}.`);
      const deployment = buildTokenDeployment(draftFor(standard, fields, recipient), address, salt);
      const preset = TOKEN_PRESETS[standard];
      if (standard === "erc1155") {
        // The preset's constructor mint reverts for a recipient that can't
        // receive ERC-1155, and the fee would still be paid.
        setOperation({ chainId, message: "Checking…", tone: "busy" });
        await assertErc1155Recipient(chainId, recipient.trim().toLowerCase());
      }
      setOperation({ chainId, message: "Review in your wallet…", tone: "busy" });
      const result = await requestTransaction({
        calls: [deployment.call],
        description: `Deploys an OpenZeppelin ${preset.presetName} contract and mints its initial supply.`,
        details: [{ label: "Contract address", value: deployment.address }, ...deployment.details],
        reviewMode: "terminal",
        title: `Create ${preset.label}`,
        ...(network.id === "SN_MAIN" ? { warning: "This is a Mainnet transaction with real network fees." } : {}),
      });
      transactionHash = transactionHashOf(result);
      setOperation({ chainId, message: "Submitted. Waiting for Starknet…", tone: "busy", transactionHash });
      await confirmTokenDeployment(chainId, transactionHash, deployment.address, deployment.classHash);
      setOperation({
        address: deployment.address,
        chainId,
        message: `Created at ${addressLabel(deployment.address)}.`,
        tone: "success",
        transactionHash,
      });
    } catch (cause) {
      // The salt is kept on purpose: if the outcome is unknown and the user
      // tries again, the same address means a second contract can't be made.
      setOperation({
        chainId,
        message: userErrorMessage(cause, "The wallet could not complete this create."),
        tone: "error",
        ...(transactionHash === undefined ? {} : { transactionHash }),
      });
    }
  };

  return (
    <section className="screen nft-studio token-create">
      <header className="studio-hero">
        <div>
          <span className="studio-kicker">
            <Hammer size={13} /> Create · OpenZeppelin presets
          </span>
          <h1>Create a token or collection.</h1>
          <p>
            One transaction deploys the contract and mints the initial supply. Your account owns it and can upgrade
            it.
          </p>
        </div>
        <div className="studio-network">
          <span className={network === null ? undefined : "live"} />
          <div>
            <small>Active network</small>
            <strong>{network?.name ?? (isConnected ? "Unsupported network" : "Not connected")}</strong>
          </div>
        </div>
      </header>

      {network?.id === "SN_MAIN" ? (
        <div className="studio-mainnet-warning" role="alert">
          <ShieldCheck size={14} /> This is a Mainnet transaction with real network fees.
        </div>
      ) : null}

      <div className="create-layout">
        <section className="studio-workbench">
          <div className="studio-mode-tabs" role="tablist" aria-label="Token standard">
            {STANDARD_TABS.map((tab) => (
              <button
                aria-selected={standard === tab.id}
                className={standard === tab.id ? "active" : undefined}
                disabled={busy}
                key={tab.id}
                onClick={() => setStandard(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          <form className="studio-workbench__body" onSubmit={(event) => void submit(event)}>
            {FIELDS_BY_STANDARD[standard].map((field) => (
              <label className="studio-field" key={field.key}>
                <span>{field.label}</span>
                <input
                  disabled={busy}
                  inputMode={field.inputMode}
                  onChange={(event) => update(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  spellCheck={false}
                  value={field.key === "recipient" ? recipient : fields[field.key]}
                />
              </label>
            ))}
            {!isConnected ? (
              <button className="studio-primary" disabled={isConnecting} onClick={() => void connect()} type="button">
                {isConnecting ? "Connecting…" : "Connect wallet"}
              </button>
            ) : (
              <button className="studio-primary" disabled={busy || done || preview.deployment === null || network === null} type="submit">
                Review create
              </button>
            )}
            <CreateStatus operation={operation} />
          </form>
        </section>
        <CreateReview deployment={preview.deployment} problem={preview.problem} />
      </div>
      <div className="create-tools">
        {standard === "erc20" ? null : (
          <TokenMetadata baseUri={fields.baseUri} standard={standard} tokenIds={fields.tokenIds} />
        )}
        <TokenOwnership createdAddress={operation?.tone === "success" ? operation.address : null} />
      </div>
    </section>
  );
}
