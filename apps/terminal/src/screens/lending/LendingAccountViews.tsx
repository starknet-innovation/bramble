import {
  ArrowRight,
  Banknote,
  Clock3,
  Gift,
  Layers3,
  LockKeyhole,
  Radio,
} from "lucide-react";
import { loadFailedMessage, userErrorMessage } from "../../protocols/support/user-error";
import { useMemo, useState, type ReactNode } from "react";
import { avnuTokenArtwork } from "../../assets/avnu-token-assets";
import { ErrorBanner, SkeletonRows, TokenIcon } from "../../components/index";
import {
  formatCompactUsd,
  type Resource,
  type VesuMarket,
  type VesuPosition,
  type VesuRedeem,
  type VesuRewards,
  type VesuVault,
} from "../../data/index";
import {
  buildVesuRewardClaimCalls,
  buildVesuVaultClaimCalls,
  buildVesuVaultDepositCalls,
  buildVesuVaultRedeemCalls,
  VESU_VAULT_DEPOSITS_ENABLED,
  VESU_VAULT_DEPOSITS_PAUSED,
} from "../../protocols/index";
import { shortenAddress } from "../../shell/screens";
import { useWallet } from "../../wallet/connection/WalletProvider";
import { toSmallestUnit } from "../swap/swap-panel-utils";

type PositionsProps = {
  readonly resource: Resource<readonly VesuPosition[]>;
  readonly connected: boolean;
  readonly markets: readonly VesuMarket[];
  readonly onConnect: () => void;
  readonly onManage: (position: VesuPosition) => void;
};

/** Connected-account Vesu positions with liquidation health surfaced first. */
export const LendingPositions = ({
  resource,
  connected,
  markets,
  onConnect,
  onManage,
}: PositionsProps): ReactNode => {
  if (!connected) {
    return (
      <div className="lending-account-empty">
        <LockKeyhole size={24} aria-hidden />
        <h2>Connect to load your Vesu book</h2>
        <p>Open earn, borrow, multiply, and vault positions are read by wallet address.</p>
        <button onClick={onConnect} type="button">Connect wallet</button>
      </div>
    );
  }
  if (resource.error !== null && resource.data === null) {
    return <ErrorBanner message={loadFailedMessage("positions", resource.error)} />;
  }
  if (resource.isLoading && resource.data === null) return <SkeletonRows rows={7} />;
  const positions = resource.data ?? [];
  if (positions.length === 0) {
    return (
      <div className="lending-account-empty">
        <Layers3 size={24} aria-hidden />
        <h2>No open Vesu positions</h2>
        <p>Supply an asset or open a collateralized position from the Markets desk.</p>
      </div>
    );
  }
  return (
    <div className="lending-position-list">
      <div className="lending-position-head">
        <span>Position</span><span>Supplied / collateral</span><span>Debt</span><span>Health</span><span>Pool</span><span>Action</span>
      </div>
      {positions.map((position, index) => {
        const pricedAsset = position.debtAddress ?? position.collateralAddress;
        const oracleMarket = markets.find(
          (market) =>
            market.poolId === position.poolId &&
            BigInt(market.assetAddress) === BigInt(pricedAsset),
        );
        return (
        <div className="lending-position-row" key={position.id}>
          <span className="lending-position-kind">
            <TokenIcon
              colorIndex={index}
              logoUri={avnuTokenArtwork(position.collateralAddress, null)}
              size={28}
              symbol={position.collateralSymbol}
            />
            <span><strong>{position.type}</strong><small>{position.collateralSymbol}</small></span>
          </span>
          <span className="mono">{position.collateralAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {position.collateralSymbol}</span>
          <span className="mono">{position.debtSymbol === null ? "—" : `${position.debtAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${position.debtSymbol}`}</span>
          <span>
            {position.healthFactor === null ? (
              "—"
            ) : (
              <span className={position.healthFactor < 1.2 ? "neg" : position.healthFactor < 1.5 ? "lending-warn-text" : "pos"}>
                {position.healthFactor.toFixed(2)}×
              </span>
            )}
            {position.currentLtv === null ? null : <small>{position.currentLtv.toFixed(2)}% LTV</small>}
          </span>
          <span title={position.poolId}>
            {position.poolName}
            <small title={oracleMarket?.oracleAddress}>
              <Radio size={9} aria-hidden /> {oracleMarket?.oracleKey ?? "Oracle unavailable"}
            </small>
          </span>
          <span className="lending-position-actions">
            <button onClick={() => onManage(position)} type="button">
              Manage
            </button>
          </span>
        </div>
        );
      })}
    </div>
  );
};

type VaultProps = {
  readonly resource: Resource<readonly VesuVault[]>;
  readonly positions: Resource<readonly VesuPosition[]>;
  readonly redeems: Resource<readonly VesuRedeem[]>;
};

/** Curated Vesu vault comparison and deposit execution surface. */
export const LendingVaults = ({ resource, positions, redeems }: VaultProps): ReactNode => {
  const { address, isConnected, connect, requestTransaction } = useWallet();
  const [selectedAddress, setSelectedAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const vaults = resource.data ?? [];
  const selected = vaults.find((vault) => vault.address === selectedAddress) ?? vaults[0] ?? null;
  const raw = selected === null ? null : toSmallestUnit(amount, selected.assetDecimals);
  const vaultPosition =
    selected === null
      ? null
      : (positions.data ?? []).find(
          (position) => position.type === "vault" && position.poolId === selected.address,
        ) ?? null;
  const redeemRaw =
    selected === null
      ? null
      : toSmallestUnit(
          redeemAmount,
          vaultPosition?.sharesDecimals ?? selected.assetDecimals,
        );

  const deposit = async (): Promise<void> => {
    if (!isConnected) {
      await connect();
      return;
    }
    if (selected === null || address === null || raw === null) return;
    try {
      const calls = buildVesuVaultDepositCalls(
        selected.address,
        selected.assetAddress,
        BigInt(raw),
        address,
      );
      await requestTransaction({
        calls,
        description:
          "Deposit into the selected curated Vesu vault. The allowance is revoked in the same transaction.",
        details: [
          { label: "Vault", value: selected.name },
          { label: "Deposit", value: `${amount} ${selected.assetSymbol}` },
          { label: "7d APR", value: `${selected.apr7d.toFixed(2)}%` },
          { label: "Management fee", value: `${selected.managementFee.toFixed(2)}%` },
          { label: "Redemption", value: `Async · average ${Math.round(selected.averageRedeemDelaySeconds / 3600)}h` },
        ],
        title: `Deposit into ${selected.name}`,
        warning:
          "Vault strategies add curator, liquidity, and delayed-redemption risk. Verify the fee and contract.",
      });
      setMessage("Vault deposit submitted.");
      setAmount("");
    } catch (cause) {
      setMessage(userErrorMessage(cause, "Vault request failed."));
    }
  };

  const requestRedeem = async (): Promise<void> => {
    if (!isConnected) {
      await connect();
      return;
    }
    if (selected === null || address === null || redeemRaw === null || vaultPosition === null) return;
    try {
      const calls = buildVesuVaultRedeemCalls(selected.address, BigInt(redeemRaw), address);
      await requestTransaction({
        calls,
        description:
          "Submit an asynchronous Vesu vault redemption request. Assets become claimable after the vault processes its epoch.",
        details: [
          { label: "Vault", value: selected.name },
          { label: "Shares to redeem", value: `${redeemAmount} ${selected.symbol}` },
          { label: "Average delay", value: `${Math.round(selected.averageRedeemDelaySeconds / 3600)} hours` },
        ],
        title: `Request ${selected.name} redemption`,
        warning: "This starts a delayed redemption. It does not transfer underlying assets immediately.",
      });
      setRedeemAmount("");
      setMessage("Redemption requested. The queue will refresh shortly.");
    } catch (cause) {
      setMessage(userErrorMessage(cause, "Redemption request failed."));
    }
  };

  const claimRedeem = async (redeem: VesuRedeem): Promise<void> => {
    try {
      const calls = buildVesuVaultClaimCalls(redeem.sharesAddress, BigInt(redeem.redemptionId));
      await requestTransaction({
        calls,
        description: "Claim the underlying assets from a processed Vesu vault redemption.",
        details: [
          { label: "Redemption id", value: redeem.redemptionId },
          { label: "Expected assets", value: `${redeem.assetsAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${redeem.assetsSymbol}` },
          { label: "Vault", value: shortenAddress(redeem.sharesAddress) },
        ],
        title: `Claim ${redeem.assetsSymbol} redemption`,
      });
      setMessage("Redemption claim submitted.");
    } catch (cause) {
      setMessage(userErrorMessage(cause, "Redemption claim failed."));
    }
  };

  if (resource.error !== null && vaults.length === 0) {
    return <ErrorBanner message={loadFailedMessage("vaults", resource.error)} />;
  }
  if (resource.isLoading && vaults.length === 0) return <SkeletonRows rows={5} />;
  return (
    <div className="lending-vault-layout">
      <div className="lending-vault-list">
        <div className="lending-position-head vault-head">
          <span>Vault</span><span>TVL</span><span>7d APR</span><span>30d APR</span><span>Fees</span>
        </div>
        {vaults.map((vault, index) => (
          <button
            className={selected?.address === vault.address ? "lending-vault-row selected" : "lending-vault-row"}
            key={vault.address}
            onClick={() => setSelectedAddress(vault.address)}
            type="button"
          >
            <span className="lending-position-kind">
              <TokenIcon
                colorIndex={index + 4}
                logoUri={avnuTokenArtwork(vault.assetAddress, null)}
                size={28}
                symbol={vault.assetSymbol}
              />
              <span><strong>{vault.name}</strong><small>by {shortenAddress(vault.curatorAddress)}</small></span>
            </span>
            <span>{formatCompactUsd(vault.tvlUsd)}</span>
            <span className={vault.apr7d >= 0 ? "pos" : "neg"}>{vault.apr7d.toFixed(2)}%</span>
            <span>{vault.apr30d.toFixed(2)}%</span>
            <span>{vault.managementFee.toFixed(1)}% / {vault.performanceFee.toFixed(0)}%</span>
          </button>
        ))}
      </div>
      <aside className="lending-vault-ticket">
        <span>Vault deposit</span>
        <h2>{selected?.name ?? "No vault selected"}</h2>
        {selected === null ? null : (
          <>
            <dl>
              <div><dt>Deposit cap</dt><dd>{selected.depositLimit.toLocaleString()} {selected.assetSymbol}</dd></div>
              <div><dt>Average redemption</dt><dd>{Math.round(selected.averageRedeemDelaySeconds / 3600)} hours</dd></div>
              <div><dt>Vault contract</dt><dd title={selected.address}>{shortenAddress(selected.address)}</dd></div>
            </dl>
            <label className="lending-input-block compact">
              <span>Deposit amount</span>
              <div>
                <input inputMode="decimal" onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" value={amount} />
                <strong>{selected.assetSymbol}</strong>
              </div>
            </label>
            {message !== null ? <p className="lending-ticket-message">{message}</p> : null}
            {/* Deposits pay the API-named vault, which nothing verifies yet (Sherlock 169). */}
            {VESU_VAULT_DEPOSITS_ENABLED ? null : <p className="lending-ticket-message">{VESU_VAULT_DEPOSITS_PAUSED}</p>}
            <button className="lending-submit" disabled={!VESU_VAULT_DEPOSITS_ENABLED || (isConnected && raw === null)} onClick={() => void deposit()} type="button">
              {isConnected ? "Review deposit" : "Connect wallet"}<ArrowRight size={14} aria-hidden />
            </button>
            <div className="lending-vault-divider" />
            <span>Redemption queue</span>
            <label className="lending-input-block compact">
              <span>Vault shares</span>
              <div>
                <input inputMode="decimal" onChange={(event) => setRedeemAmount(event.currentTarget.value)} placeholder="0.00" value={redeemAmount} />
                <strong>{selected.symbol}</strong>
              </div>
            </label>
            <small className="lending-vault-balance">
              {vaultPosition === null
                ? "No shares detected"
                : `Position: ${(vaultPosition.sharesAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${vaultPosition.sharesSymbol ?? selected.symbol}`}
            </small>
            <button
              className="lending-secondary-submit"
              disabled={!isConnected || redeemRaw === null || vaultPosition === null}
              onClick={() => void requestRedeem()}
              type="button"
            >
              Request redemption
            </button>
          </>
        )}
      </aside>
      {(redeems.data?.length ?? 0) > 0 ? (
        <div className="lending-redeem-queue">
          <h3>Redemption activity</h3>
          {redeems.data?.map((redeem) => (
            <div key={`${redeem.sharesAddress}:${redeem.redemptionId}`}>
              <span><strong>{redeem.assetsAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {redeem.assetsSymbol}</strong><small>Request #{redeem.redemptionId}</small></span>
              <span className={`lending-redeem-status ${redeem.status}`}>{redeem.status}</span>
              {redeem.status === "claimable" ? (
                <button onClick={() => void claimRedeem(redeem)} type="button">Claim</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

type RewardsProps = {
  readonly resource: Resource<VesuRewards>;
  readonly connected: boolean;
  readonly onConnect: () => void;
};

/** BTCFi reward overview and proof-backed claim execution. */
export const LendingRewards = ({ resource, connected, onConnect }: RewardsProps): ReactNode => {
  const { requestTransaction } = useWallet();
  const [message, setMessage] = useState<string | null>(null);
  const reward = resource.data;
  const claimable = reward !== null ? Number(reward.claimableRaw) / 10 ** reward.decimals : 0;
  const earned = useMemo(
    () => (reward === null ? 0 : Number(reward.amount) / 10 ** reward.decimals),
    [reward],
  );

  const claim = async (): Promise<void> => {
    if (!connected) {
      onConnect();
      return;
    }
    if (reward === null) return;
    try {
      const calls = buildVesuRewardClaimCalls(BigInt(reward.claimableRaw), reward.proof);
      await requestTransaction({
        calls,
        description: "Claim Vesu BTCFi incentives with the API-supplied Merkle proof.",
        details: [
          { label: "Program", value: "Vesu BTCFi" },
          { label: "Claimable", value: `${claimable.toLocaleString(undefined, { maximumFractionDigits: 6 })} STRK` },
          { label: "Proof nodes", value: reward.proof.length.toString() },
        ],
        title: "Claim Vesu rewards",
        warning: "Verify the distributor contract and claim amount before approving.",
      });
      setMessage("Reward claim submitted.");
    } catch (cause) {
      setMessage(userErrorMessage(cause, "Reward claim failed."));
    }
  };

  return (
    <div className="lending-rewards">
      <div className="lending-reward-ledger">
        <div className="lending-reward-mark"><Gift size={28} aria-hidden /></div>
        <div><span>BTCFi incentives</span><h2>{connected ? `${earned.toLocaleString(undefined, { maximumFractionDigits: 4 })} STRK` : "Connect to calculate"}</h2><p>Earned across eligible Vesu markets.</p></div>
        <dl>
          <div><dt>Claimable now</dt><dd>{claimable.toLocaleString(undefined, { maximumFractionDigits: 6 })} STRK</dd></div>
          <div><dt>Claim proof</dt><dd>{reward?.proof.length ?? 0} nodes</dd></div>
          <div><dt>Source</dt><dd>Vesu API + distributor</dd></div>
        </dl>
      </div>
      <aside className="lending-reward-action">
        <Banknote size={22} aria-hidden />
        <h3>Claim to your wallet</h3>
        <p>The terminal validates the proof shape, then shows the distributor call before signing.</p>
        {resource.error !== null ? <ErrorBanner message={resource.error} /> : null}
        {message !== null ? <p className="lending-ticket-message">{message}</p> : null}
        <button
          className="lending-submit"
          disabled={connected && (resource.isLoading || claimable <= 0 || (reward?.proof.length ?? 0) === 0)}
          onClick={() => void claim()}
          type="button"
        >
          {connected ? (claimable > 0 ? "Review claim" : "Nothing claimable") : "Connect wallet"}
          <ArrowRight size={14} aria-hidden />
        </button>
        <small><Clock3 size={11} aria-hidden /> Reward availability follows Vesu epochs.</small>
      </aside>
    </div>
  );
};
