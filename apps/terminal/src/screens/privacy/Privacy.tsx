import { PRIVATE_SWAP_SLIPPAGE_BPS } from "../../../shared/privacy";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { TokenIcon } from "../../components/index";
import {
  fetchPrivateSwapPlan,
  submitPrivateSwapProof,
} from "../../protocols/avnu/private-swap-client";
import { readPrivacyPool, type PrivacyPoolSnapshot } from "../../protocols/privacy/privacy-pool";
import {
  buildPrivacyDeposit,
  buildPrivacyTransfer,
  buildPrivacyWithdraw,
} from "../../protocols/privacy/privacy";
import { useWallet } from "../../wallet/connection/WalletProvider";
import { isPrivateRegistrationRequired } from "../../wallet/privacy/privacy-wallet";
import type { ScreenId } from "../../shell/screens";
import { PrivateBalanceGrid } from "./PrivateBalanceGrid";
import { PrivacyRegistration } from "./PrivacyRegistration";
import {
  FEE_MODE,
  formatRaw,
  type Mode,
  modeLabel,
  parseAmount,
  short,
  type SwapReview,
  TOKENS,
  type TokenOption,
} from "./model";

type PrivacyProps = { readonly onNavigate: (screen: ScreenId) => void };

export default function Privacy({ onNavigate }: PrivacyProps): ReactNode {
  const {
    address,
    chainId,
    connect,
    invokePrivate,
    isConnected,
    isConnecting,
    preparePrivateInvoke,
    privateBalances,
    registerPrivate,
  } = useWallet();
  const [mode, setMode] = useState<Mode>("balances");
  const [token, setToken] = useState<TokenOption>(TOKENS[0] as TokenOption);
  const [buyToken, setBuyToken] = useState<TokenOption>(TOKENS[1] as TokenOption);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [pool, setPool] = useState<PrivacyPoolSnapshot | null>(null);
  const [balances, setBalances] = useState<ReadonlyMap<bigint, string>>(new Map());
  const [status, setStatus] = useState("Connect Bramble to inspect private balances.");
  const [busy, setBusy] = useState(false);
  const [swapReview, setSwapReview] = useState<SwapReview | null>(null);
  const [registration, setRegistration] = useState<"active" | "required" | "unknown">("unknown");

  useEffect(() => {
    let cancelled = false;
    void readPrivacyPool().then(
      (snapshot) => {
        if (!cancelled) setPool(snapshot);
      },
      () => {
        if (!cancelled) setPool(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBalance = balances.get(BigInt(token.address)) ?? "0x0";
  const isMainnet = chainId === "SN_MAIN" || chainId?.toLowerCase() === "0x534e5f4d41494e";
  const actionSummary = useMemo(() => {
    if (mode === "deposit") return "Move a public ERC20 balance into private notes.";
    if (mode === "register") return "Complete the one-time public registration for this account.";
    if (mode === "withdraw") return "Return a private balance to a public Starknet address.";
    if (mode === "transfer") return "Send notes privately to a registered pool recipient.";
    if (mode === "swap")
      return "Trade through AVNU while settling inputs and output as private notes.";
    return "Only aggregate token balances leave the wallet. Notes and viewing keys stay inside it.";
  }, [mode]);

  const refreshBalances = async (): Promise<void> => {
    setBusy(true);
    setStatus("Requesting aggregate balances from the wallet…");
    try {
      const rows = await privateBalances(TOKENS.map((item) => item.address));
      setBalances(new Map(rows.map((row) => [BigInt(row.token), row.balance])));
      setRegistration("active");
      setStatus("Private balances are current.");
    } catch (cause) {
      if (isPrivateRegistrationRequired(cause)) {
        setRegistration("required");
        setMode("register");
        setStatus("Activate this account before requesting private balances.");
        return;
      }
      setStatus(cause instanceof Error ? cause.message : "Private balances are unavailable.");
    } finally {
      setBusy(false);
    }
  };

  const activatePrivateBalances = async (): Promise<void> => {
    setBusy(true);
    setStatus("Opening Bramble for one-time registration review…");
    try {
      const transactionHash = await registerPrivate();
      setRegistration("active");
      setMode("balances");
      setStatus(`Registration accepted on Starknet · ${short(transactionHash)}`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Private activation failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitAction = async (): Promise<void> => {
    setBusy(true);
    setStatus("Opening the wallet for private transaction review…");
    try {
      const raw = `0x${parseAmount(amount, token.decimals).toString(16)}`;
      const actions =
        mode === "deposit"
          ? [buildPrivacyDeposit({ amount: raw, token: token.address })]
          : mode === "withdraw"
            ? [buildPrivacyWithdraw({ amount: raw, recipient, token: token.address })]
            : [buildPrivacyTransfer({ amount: raw, recipient, token: token.address })];
      const transactionHash = await invokePrivate(actions);
      setStatus(`Accepted on Starknet · ${short(transactionHash)}`);
      setAmount("");
      await refreshBalances();
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Private transaction failed.");
    } finally {
      setBusy(false);
    }
  };

  const quotePrivateSwap = async (): Promise<void> => {
    if (!address) {
      setStatus("Connect Bramble before preparing a private swap.");
      return;
    }
    setBusy(true);
    setSwapReview(null);
    setStatus("Finding an AVNU private route and paymaster fee…");
    try {
      const sellAmount = parseAmount(amount, token.decimals);
      if (BigInt(token.address) === BigInt(buyToken.address)) {
        throw new Error("Choose two different assets.");
      }
      const plan = await fetchPrivateSwapPlan({
        buyToken: buyToken.address,
        sellAmount: `0x${sellAmount.toString(16)}`,
        sellToken: token.address,
        takerAddress: address,
      });
      setSwapReview({
        actions: plan.actions,
        buyAmount: BigInt(plan.buyAmount),
        minBuyAmount: BigInt(plan.minBuyAmount),
        buyToken,
        executor: plan.executor,
        fee: plan.fee,
        sellAmount,
        sellToken: token,
      });
      setStatus("Route ready. Review every value before asking the wallet to prove it.");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Private route preparation failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitPrivateSwap = async (): Promise<void> => {
    if (!swapReview) return;
    setBusy(true);
    setStatus("Wallet review open · waiting for proof authorization…");
    try {
      const proof = await preparePrivateInvoke(swapReview.actions);
      setStatus("Proof ready · submitting through the AVNU private paymaster…");
      const transactionHash = await submitPrivateSwapProof(proof, FEE_MODE);
      setStatus(`Private swap accepted · ${short(transactionHash)}`);
      setSwapReview(null);
      setAmount("");
      await refreshBalances();
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Private swap failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="privacy-screen">
      <header className="privacy-hero">
        <div>
          <h1>Private balances, without leaving the wallet.</h1>
          <p>
            Shield, transfer, withdraw, and privately swap through one reviewed action surface. The
            Terminal never receives viewing keys or individual notes.
          </p>
        </div>
        <div className="privacy-pool-status">
          <span className={pool ? "pool-dot live" : "pool-dot"} />
          <div>
            <small>Production pool</small>
            <strong>{pool ? "On-chain configuration read" : "Checking pool…"}</strong>
            <code>
              {short(
                pool?.address ??
                  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
              )}
            </code>
          </div>
        </div>
      </header>

      <div className="privacy-layout">
        <aside className="privacy-nav" aria-label="Privacy actions">
          {(Object.keys(modeLabel) as Mode[]).map((item) => (
            <button
              className={mode === item ? "active" : ""}
              key={item}
              onClick={() => {
                setMode(item);
                setSwapReview(null);
              }}
              type="button"
            >
              {item === "balances" ? <RefreshCw /> : null}
              {item === "register" ? <ShieldCheck /> : null}
              {item === "deposit" ? <ArrowDownToLine /> : null}
              {item === "withdraw" ? <ArrowUpFromLine /> : null}
              {item === "transfer" ? <Send /> : null}
              {item === "swap" ? <LockKeyhole /> : null}
              <span>{modeLabel[item]}</span>
            </button>
          ))}
          <div className="privacy-trust">
            <small>Execution boundary</small>
            <strong>Bramble</strong>
            <span>Review · prove · authorize</span>
          </div>
        </aside>

        <section className="privacy-workspace">
          <div className="privacy-workspace-heading">
            <div>
              <span>Private operation</span>
              <h2>{modeLabel[mode]}</h2>
            </div>
            <p>{actionSummary}</p>
          </div>

          {!isConnected ? (
            <div className="privacy-connect">
              <LockKeyhole size={28} />
              <h3>Connect Bramble</h3>
              <p>Private state is requested only after an explicit action.</p>
              <button disabled={isConnecting} onClick={() => void connect()} type="button">
                {isConnecting ? "Checking wallet…" : "Connect wallet"}
              </button>
            </div>
          ) : !isMainnet ? (
            <div className="privacy-connect">
              <h3>Switch to Starknet Mainnet</h3>
              <p>This audited pool address is bound to Mainnet. No request was sent.</p>
            </div>
          ) : mode === "register" ? (
            <PrivacyRegistration
              active={registration === "active"}
              busy={busy}
              onActivate={() => void activatePrivateBalances()}
              poolAddress={pool?.address ?? "0x040337…812a"}
            />
          ) : mode === "balances" ? (
            <PrivateBalanceGrid
              busy={busy}
              items={TOKENS.map((item) => ({
                address: item.address,
                balance: formatRaw(balances.get(BigInt(item.address)) ?? "0x0", item.decimals),
                logoUri: item.logoUri,
                symbol: item.symbol,
              }))}
              onRefresh={() => void refreshBalances()}
            />
          ) : (
            <div className="privacy-compose-grid">
              <div className="privacy-form">
                <label>Asset to {mode === "swap" ? "sell privately" : mode}</label>
                <div className="privacy-token-options">
                  {TOKENS.map((item) => (
                    <button
                      className={item.address === token.address ? "active" : ""}
                      key={item.address}
                      onClick={() => {
                        setToken(item);
                        setSwapReview(null);
                      }}
                      type="button"
                    >
                      <TokenIcon logoUri={item.logoUri} size={26} symbol={item.symbol} />
                      {item.symbol}
                    </button>
                  ))}
                </div>
                {mode === "swap" ? (
                  <>
                    <label>Asset to receive as an open note</label>
                    <div className="privacy-token-options">
                      {TOKENS.map((item) => (
                        <button
                          className={item.address === buyToken.address ? "active" : ""}
                          key={item.address}
                          onClick={() => {
                            setBuyToken(item);
                            setSwapReview(null);
                          }}
                          type="button"
                        >
                          <TokenIcon logoUri={item.logoUri} size={26} symbol={item.symbol} />
                          {item.symbol}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                <label htmlFor="privacy-amount">Amount</label>
                <div className="privacy-amount-input">
                  <input
                    id="privacy-amount"
                    inputMode="decimal"
                    onChange={(event) => {
                      setAmount(event.target.value);
                      setSwapReview(null);
                    }}
                    placeholder="0"
                    value={amount}
                  />
                  <span>{token.symbol}</span>
                </div>
                <small>
                  Available privately: {formatRaw(selectedBalance, token.decimals)} {token.symbol}
                </small>
                {mode === "withdraw" || mode === "transfer" ? (
                  <>
                    <label htmlFor="privacy-recipient">
                      {mode === "withdraw" ? "Public recipient" : "Registered private recipient"}
                    </label>
                    <input
                      className="privacy-address-input"
                      id="privacy-recipient"
                      onChange={(event) => setRecipient(event.target.value.trim())}
                      placeholder="0x…"
                      spellCheck={false}
                      value={recipient}
                    />
                  </>
                ) : null}
                {mode === "swap" ? (
                  <button
                    className="privacy-primary"
                    disabled={busy || amount.length === 0}
                    onClick={() => void quotePrivateSwap()}
                    type="button"
                  >
                    {busy ? "Finding route…" : "Review private route"}
                  </button>
                ) : (
                  <button
                    className="privacy-primary"
                    disabled={busy || amount.length === 0}
                    onClick={() => void submitAction()}
                    type="button"
                  >
                    {busy ? "Waiting for wallet…" : `Review ${modeLabel[mode].toLowerCase()}`}
                  </button>
                )}
              </div>

              <aside className="privacy-review-card">
                <span>Review</span>
                {swapReview ? (
                  <>
                    <h3>
                      {formatRaw(
                        `0x${swapReview.sellAmount.toString(16)}`,
                        swapReview.sellToken.decimals,
                      )}{" "}
                      {swapReview.sellToken.symbol} →{" "}
                      {formatRaw(
                        `0x${swapReview.buyAmount.toString(16)}`,
                        swapReview.buyToken.decimals,
                      )}{" "}
                      {swapReview.buyToken.symbol}
                    </h3>
                    <dl>
                      <div>
                        <dt>Estimated received</dt>
                        <dd>
                          {formatRaw(
                            `0x${swapReview.buyAmount.toString(16)}`,
                            swapReview.buyToken.decimals,
                          )}{" "}
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
                      The wallet independently validates this batch, checks balances and privacy
                      leakage, then creates the proof. The server receives only the final proof.
                    </p>
                    <button
                      className="privacy-primary"
                      disabled={busy}
                      onClick={() => void submitPrivateSwap()}
                      type="button"
                    >
                      {busy ? "Proving…" : "Authorize proof and submit"}
                    </button>
                  </>
                ) : (
                  <>
                    <h3>No hidden execution</h3>
                    <p>
                      Route, exact inputs, expected output, executor, pool fee, and action count
                      appear here before the wallet opens.
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
            </div>
          )}
          <div className="privacy-live-status" aria-live="polite" role="status">
            <span className={busy ? "status-pulse active" : "status-pulse"} />
            {status}
            <button onClick={() => onNavigate("portfolio")} type="button">
              View portfolio
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
