import { sameFelt } from "@bramble/wallet-model/networks";
import { KeyRound, ShieldAlert } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { createNetworkFor, createNetworkNames } from "../../create/create-runtime";
import { assertOwnerDeployed, confirmOwnershipChange, readContractOwnership } from "../../create/ownership-runtime";
import {
  buildOwnershipCall,
  type ContractOwnership,
  expectedOwnerAfter,
  isRenounced,
  type OwnershipChange,
  readContractAddress,
  readNewOwner,
} from "../../create/token-ownership";
import { TOKEN_PRESETS } from "../../create/token-presets";
import { userErrorMessage } from "../../protocols/support/user-error";
import { shortenAddress } from "../../shell/screens";
import { useWallet } from "../../wallet/connection/WalletProvider";
import { type CreateOperation, CreateStatus } from "./create-parts";

type TokenOwnershipProps = {
  /** The contract the last create deployed; fills an empty contract field. */
  readonly createdAddress: string | null;
};

/** Ownership read for one wallet identity, so a switch never reuses it. */
type Loaded = { readonly identity: string; readonly ownership: ContractOwnership };

const transactionHashOf = (value: unknown): string => {
  const hash = (value as { readonly transaction_hash?: unknown } | null)?.transaction_hash;
  if (typeof hash !== "string" || hash.length === 0) throw new Error("Wallet returned an invalid transaction hash.");
  return hash;
};

const warningFor = (change: OwnershipChange, networkId: string): { warning?: string } => {
  const lines = [
    ...(networkId === "SN_MAIN" ? ["This is a Mainnet transaction with real network fees."] : []),
    ...(change.kind === "renounce" ? ["This cannot be undone."] : []),
  ];
  return lines.length === 0 ? {} : { warning: lines.join(" ") };
};

/**
 * Transfer or renounce ownership of a contract Create deploys. The contract is
 * read first: it must run a pinned preset and be owned by the connected
 * account. Renounce takes a second, explicit confirm. Each change is one
 * `Ownable` call reviewed in the wallet, and is reported only after the chain
 * shows the new owner.
 */
export default function TokenOwnership({ createdAddress }: TokenOwnershipProps): ReactNode {
  const { address, chainId, isConnected, requestTransaction } = useWallet();
  const [contractInput, setContractInput] = useState("");
  const [newOwnerInput, setNewOwnerInput] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [confirmingRenounce, setConfirmingRenounce] = useState(false);
  const [operation, setOperation] = useState<CreateOperation | null>(null);
  const network = createNetworkFor(chainId);
  const contractText = contractInput || createdAddress || "";
  const identity = `${chainId ?? ""}:${address ?? ""}:${contractText.trim().toLowerCase()}`;
  const ownership = loaded?.identity === identity ? loaded.ownership : null;
  const busy = operation?.tone === "busy";
  const isOwner = ownership !== null && address !== null && sameFelt(ownership.owner, address);

  const fail = (cause: unknown, fallback: string): void =>
    setOperation({ chainId, message: userErrorMessage(cause, fallback), tone: "error" });

  const load = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setConfirmingRenounce(false);
    try {
      if (!isConnected || address === null) throw new Error("Connect a wallet first.");
      if (network === null) throw new Error(`Switch your wallet to ${createNetworkNames()}.`);
      const contract = readContractAddress(contractText);
      setOperation({ chainId, message: "Checking…", tone: "busy" });
      setLoaded({ identity, ownership: await readContractOwnership(chainId, contract) });
      setOperation(null);
    } catch (cause) {
      setLoaded(null);
      fail(cause, "Couldn't read this contract.");
    }
  };

  const change = async (kind: OwnershipChange["kind"]): Promise<void> => {
    let transactionHash: string | undefined;
    try {
      if (ownership === null || address === null || network === null) throw new Error("Check the contract first.");
      if (!isOwner) throw new Error("Your account doesn't own this contract.");
      const request: OwnershipChange =
        kind === "transfer" ? { kind, newOwner: readNewOwner(newOwnerInput, ownership) } : { kind };
      if (request.kind === "transfer") {
        setOperation({ chainId, message: "Checking…", tone: "busy" });
        await assertOwnerDeployed(chainId, request.newOwner);
      }
      const call = buildOwnershipCall(ownership.contract, request);
      const preset = TOKEN_PRESETS[ownership.standard];
      setOperation({ chainId, message: "Review in your wallet…", tone: "busy" });
      const result = await requestTransaction({
        calls: [call],
        description:
          request.kind === "transfer"
            ? `Makes the new owner the only account that can upgrade this ${preset.presetName} contract. Your account loses that right.`
            : `Removes the owner of this ${preset.presetName} contract. Nobody can upgrade it again.`,
        details: [
          { label: "Contract", value: ownership.contract },
          { label: "Current owner", value: ownership.owner },
          { label: "New owner", value: request.kind === "transfer" ? request.newOwner : "None" },
          {
            label: "Call",
            value: request.kind === "transfer" ? `transfer_ownership(${request.newOwner})` : "renounce_ownership()",
          },
        ],
        // The owner can change while the review is open; re-read it before the wallet sees the call.
        handoffCheck: async () => {
          const fresh = await readContractOwnership(chainId, ownership.contract);
          if (!sameFelt(fresh.owner, address)) throw new Error("Your account no longer owns this contract.");
        },
        reviewMode: "terminal",
        title: request.kind === "transfer" ? "Transfer contract ownership" : "Renounce contract ownership",
        ...warningFor(request, network.id),
      });
      transactionHash = transactionHashOf(result);
      setConfirmingRenounce(false);
      setOperation({ chainId, message: "Submitted. Waiting for Starknet…", tone: "busy", transactionHash });
      const owner = expectedOwnerAfter(request);
      await confirmOwnershipChange(chainId, transactionHash, ownership.contract, owner);
      setLoaded({ identity, ownership: { ...ownership, owner } });
      setNewOwnerInput("");
      setOperation({
        address: ownership.contract,
        chainId,
        message: request.kind === "transfer" ? `Ownership moved to ${shortenAddress(owner)}.` : "Ownership renounced.",
        tone: "success",
        transactionHash,
      });
    } catch (cause) {
      if (transactionHash === undefined) {
        fail(cause, "The wallet could not complete this change.");
        return;
      }
      // Sent, but the result isn't confirmed: never call it failed, and keep
      // the cause visible beside the sentence.
      const detail = userErrorMessage(cause, "");
      setOperation({
        chainId,
        message: `Couldn't confirm the change. Check the transaction.${detail === "" ? "" : ` (${detail})`}`,
        tone: "error",
        transactionHash,
      });
    }
  };

  return (
    <section className="studio-action-form create-tool" aria-label="Ownership">
      <div className="studio-action-heading">
        <div className="studio-action-icon">
          <KeyRound size={17} />
        </div>
        <div>
          <h2>Ownership</h2>
          <p>Only the owner can upgrade a contract made here.</p>
        </div>
      </div>
      <form className="create-tool__row" onSubmit={(event) => void load(event)}>
        <label className="studio-field">
          <span>Contract</span>
          <input
            disabled={busy}
            onChange={(event) => {
              setContractInput(event.target.value);
              setConfirmingRenounce(false);
              if (!busy) setOperation(null);
            }}
            placeholder="0x… contract address"
            spellCheck={false}
            value={contractText}
          />
        </label>
        <button className="studio-secondary" disabled={busy || contractText.trim() === ""} type="submit">
          Check owner
        </button>
      </form>
      {ownership === null ? null : (
        <dl className="create-review__facts">
          <div>
            <dt>Contract</dt>
            <dd>{TOKEN_PRESETS[ownership.standard].presetName}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>
              {isRenounced(ownership) ? "None — renounced" : isOwner ? `${ownership.owner} (you)` : ownership.owner}
            </dd>
          </div>
        </dl>
      )}
      {ownership !== null && !isRenounced(ownership) && !isOwner ? (
        <p className="create-review__empty">Connect the owner account to change ownership.</p>
      ) : null}
      {isOwner ? (
        <>
          <form
            className="create-tool__row"
            onSubmit={(event) => {
              event.preventDefault();
              void change("transfer");
            }}
          >
            <label className="studio-field">
              <span>New owner</span>
              <input
                disabled={busy}
                onChange={(event) => setNewOwnerInput(event.target.value)}
                placeholder="0x… address"
                spellCheck={false}
                value={newOwnerInput}
              />
            </label>
            <button className="studio-primary" disabled={busy || newOwnerInput.trim() === ""} type="submit">
              Transfer ownership
            </button>
          </form>
          {confirmingRenounce ? (
            <div className="create-renounce" role="group" aria-label="Confirm renounce">
              <p>
                <ShieldAlert size={14} /> Renouncing leaves this contract with no owner. Nobody can upgrade it again,
                and this cannot be undone.
              </p>
              <div className="studio-button-pair">
                <button
                  className="studio-secondary"
                  disabled={busy}
                  onClick={() => setConfirmingRenounce(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button className="create-danger" disabled={busy} onClick={() => void change("renounce")} type="button">
                  Confirm renounce
                </button>
              </div>
            </div>
          ) : (
            <button className="create-danger" disabled={busy} onClick={() => setConfirmingRenounce(true)} type="button">
              Renounce ownership
            </button>
          )}
        </>
      ) : null}
      <CreateStatus operation={operation} />
    </section>
  );
}
