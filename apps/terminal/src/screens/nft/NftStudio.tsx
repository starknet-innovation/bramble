import { Box, ExternalLink, Fingerprint, Image, ShieldCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import type { InvokeFunctionResponse } from "starknet";
import { PunkPortrait } from "../../nft/PunkPortrait";
import {
  buildPunkMintCall,
  isFelt,
  parsePunkId,
  PUNK_MAINNET_CONTRACT,
} from "../../nft/punk-contract";
import {
  punkContractUrl,
  punkNetworkName,
  waitForPunkTransaction,
} from "../../nft/punk-runtime";
import type { ScreenId } from "../../shell/screens";
import { shortenAddress } from "../../shell/screens";
import { useWallet } from "../../wallet/connection/WalletProvider";
import {
  type StudioOperation,
  StudioRecipe,
  StudioWorkbench,
} from "./nft-studio-parts";

type NftStudioProps = { readonly onNavigate: (screen: ScreenId) => void };

const responseTransactionHash = (value: InvokeFunctionResponse): string => {
  if (typeof value.transaction_hash !== "string" || value.transaction_hash.length === 0) {
    throw new Error("Wallet returned an invalid transaction hash.");
  }
  return value.transaction_hash;
};

const operationError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "The wallet could not complete this operation.";

const isMainnetChain = (chainId: string | null): boolean =>
  chainId?.toUpperCase() === "SN_MAIN" ||
  chainId?.toLowerCase() === "0x534e5f4d41494e";

export default function NftStudio(_props: NftStudioProps): ReactNode {
  const { address, chainId, connect, isConnected, isConnecting, requestTransaction } = useWallet();
  const [tokenInput, setTokenInput] = useState("0");
  const [recipient, setRecipient] = useState("");
  const [operation, setOperation] = useState<StudioOperation | null>(null);
  const [recentPunks, setRecentPunks] = useState<readonly number[]>([]);

  const tokenId = parsePunkId(tokenInput);
  const previewId = tokenId ?? 0;
  const busy = operation?.tone === "busy";
  const isMainnet = isMainnetChain(chainId);
  const mintRecipient = recipient || address || "";

  const addRecent = (id: number): void => {
    setRecentPunks((current) => [id, ...current.filter((item) => item !== id)].slice(0, 6));
  };

  const submitMint = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      if (!isConnected || address === null) {
        throw new Error("Connect a wallet before submitting a transaction.");
      }
      if (!isMainnet) {
        throw new Error("Switch the connected wallet to Starknet Mainnet before minting.");
      }
      if (tokenId === null) {
        throw new Error("Choose a Punk id between 0 and 9999.");
      }
      if (!isFelt(mintRecipient)) {
        throw new Error("Enter a valid Starknet recipient address.");
      }
      setOperation({ message: `Review minting Punk #${tokenId}…`, tone: "busy" });
      const result = await requestTransaction({
        calls: [buildPunkMintCall(PUNK_MAINNET_CONTRACT, mintRecipient, tokenId)],
        description:
          "Mint this catalog token from the deployed MC Punks collection to the chosen recipient.",
        details: [
          { label: "Punk", value: `#${tokenId}` },
          { label: "Mint to", value: mintRecipient },
          { label: "Collection", value: PUNK_MAINNET_CONTRACT },
        ],
        title: `Mint Punk #${tokenId}`,
        warning: "This is a Mainnet transaction with real network fees.",
      });
      const transactionHash = responseTransactionHash(result);
      setOperation({
        message: "Mint submitted. Waiting for Starknet finality…",
        tone: "busy",
        transactionHash,
      });
      await waitForPunkTransaction(chainId, transactionHash);
      addRecent(tokenId);
      setOperation({
        message: `Punk #${tokenId} minted to ${shortenAddress(mintRecipient)}.`,
        tone: "success",
        transactionHash,
      });
    } catch (cause) {
      setOperation({ message: operationError(cause), tone: "error" });
    }
  };

  const networkLabel = useMemo(() => {
    if (!isConnected) {
      return "Connect on Starknet Mainnet";
    }
    try {
      return punkNetworkName(chainId);
    } catch {
      return "Unsupported network";
    }
  }, [chainId, isConnected]);

  const connectButton = (
    <button
      className="studio-primary"
      disabled={isConnecting}
      onClick={() => void connect()}
      type="button"
    >
      {isConnecting ? "Connecting…" : "Connect wallet"}
    </button>
  );

  return (
    <section className="screen nft-studio">
      <header className="studio-hero">
        <div>
          <span className="studio-kicker">
            <Fingerprint size={13} /> MC Punks · Mainnet mint
          </span>
          <h1>Choose a Punk. Mint it on Mainnet.</h1>
          <p>
            The collection is deployed and ready. Pick an unclaimed catalog id,
            choose its recipient, and review one mint in your wallet.
          </p>
        </div>
        <div className="studio-network">
          <span className={isConnected && isMainnet ? "live" : undefined} />
          <div>
            <small>Active network</small>
            <strong>{networkLabel}</strong>
          </div>
        </div>
      </header>

      <div className="studio-mainnet-warning" role="alert">
        <ShieldCheck size={14} />
        {isConnected && !isMainnet
          ? "Switch your wallet to Starknet Mainnet to mint from this deployed collection."
          : "Mints use Mainnet and real network fees. Review the token id and recipient carefully."}
      </div>

      <div className="studio-layout">
        <aside className="punk-inspector">
          <div className="punk-inspector__top">
            <span>Catalog specimen</span>
            <strong>#{String(previewId).padStart(4, "0")}</strong>
          </div>
          <div className="punk-stage">
            <span className="punk-stage__crosshair" />
            <PunkPortrait id={previewId} size="hero" />
            <span className="punk-stage__scale">24 × 24 px</span>
          </div>
          <label className="studio-field studio-field--token" htmlFor="punk-catalog-id">
            <span>Punk id</span>
            <div className="studio-token-input">
              <input
                aria-label="Punk id"
                aria-invalid={tokenId === null}
                id="punk-catalog-id"
                inputMode="numeric"
                max="9999"
                min="0"
                onChange={(event) => setTokenInput(event.target.value)}
                type="number"
                value={tokenInput}
              />
              <span>/ 9999</span>
            </div>
          </label>
          <div className="punk-inspector__note">
            Artwork preview is loaded from the official CryptoPunks asset host.
            This is an unaffiliated interoperability test collection.
          </div>
        </aside>

        <StudioWorkbench
          busy={busy}
          chainId={chainId}
          connectButton={connectButton}
          isConnected={isConnected}
          isMainnet={isMainnet}
          onRecipientChange={setRecipient}
          onSubmitMint={(event) => void submitMint(event)}
          operation={operation}
          previewId={previewId}
          recipient={mintRecipient}
          tokenId={tokenId}
        />

        <StudioRecipe />
      </div>

      <footer className="studio-collection-strip">
        <div className="studio-collection-strip__title">
          <Image size={15} />
          <span>
            <strong>Session tray</strong>
            <small>Recently minted</small>
          </span>
        </div>
        <div className="studio-punk-tray">
          {recentPunks.length === 0 ? (
            <span className="studio-tray-empty">Your first Punk lands here.</span>
          ) : (
            recentPunks.map((id) => (
              <button
                aria-label={`Select Punk #${id}`}
                key={id}
                onClick={() => setTokenInput(String(id))}
                type="button"
              >
                <PunkPortrait id={id} size="mini" />
                <span>#{String(id).padStart(4, "0")}</span>
              </button>
            ))
          )}
        </div>
        <a
          className="studio-contract-link"
          href={punkContractUrl("SN_MAIN", PUNK_MAINNET_CONTRACT)}
          rel="noreferrer"
          target="_blank"
        >
          <Box size={13} /> Open collection <ExternalLink size={11} />
        </a>
      </footer>
    </section>
  );
}
