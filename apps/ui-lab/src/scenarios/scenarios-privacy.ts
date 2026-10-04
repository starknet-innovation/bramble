/**
 * Deterministic private-balance checkpoints. These render production templates
 * with fixture values only: no vault, hardware, prover, indexer, or RPC access.
 */

import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
  PrivacyPreparation,
  PrivateBalanceView,
} from "@bramble/wallet-ui/lab";
import { softwareAccount, statusFor } from "../fixtures/fixtures";
import {
  ETH_TOKEN,
  journeyBalances,
  journeyPreferences,
  journeyPrices,
} from "../fixtures/journey-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { WalletScenario } from "../runtime/types";
import { privacyDappCheckpoints } from "./scenarios-privacy-dapp";

const digest = `sha256:${"d".repeat(64)}`;

const activation: PrivacyPreparation = {
  id: digest,
  kind: "register",
  payloadDigest: digest,
  poolAddress: STRK20_MAINNET_POOL,
  route: "public-account",
  summaries: [
    "Register this account with the privacy pool",
    "Registration is public and links this wallet address to its viewing key",
  ],
  symbol: ETH_TOKEN.symbol,
  tokenId: ETH_TOKEN.id,
};

const disclosure = (
  registration: "registered" | "unregistered",
  balances: readonly PrivateBalanceView[] = [],
): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: {
    accountId: softwareAccount.id,
    balances,
    networkId: "SN_MAIN",
    // The pool's 6 STRK action fee and a configured relay: the scenarios review
    // the private route, which is only offered when a relay exists.
    poolFeeFri: "0x53444835ec580000",
    registration,
    relayConfigured: true,
  },
});

const privateReady = disclosure("registered", [
  {
    balance: "0x6f05b59d3b20000",
    formatted: "0.5",
    symbol: ETH_TOKEN.symbol,
    token: ETH_TOKEN.address,
    tokenId: ETH_TOKEN.id,
  },
]);

const privacyDashboard = (
  privacy: PrivacyDisclosureState,
  privacyJourney: PrivacyJourneyState = { stage: "idle" },
  view: "home" | "privacy" | "token-detail" = "home",
): string =>
  walletDashboard({
    balanceState: { balances: journeyBalances },
    preferences: journeyPreferences,
    prices: journeyPrices,
    privacy,
    privacyJourney,
    selectedTokenId: ETH_TOKEN.id,
    status: statusFor(),
    view,
  });

export const privacyScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => privacyDashboard({ error: null, loading: false, value: null }),
      id: "public-portfolio",
      label: "Public portfolio",
      narrative:
        "Private note discovery stays off until the user explicitly enables the account-scoped disclosure.",
      state: { disclosure: "off", privateDataRead: false },
    },
    {
      content: () => privacyDashboard({ error: null, loading: true, value: null }),
      id: "discovering",
      label: "Discovering balances",
      narrative:
        "The explicitly selected private portfolio communicates indexer work without implying that its private totals are already known.",
      state: { disclosure: "on", indexer: "loading", scope: softwareAccount.id },
    },
    {
      content: () =>
        privacyDashboard({
          error: "Private services are not configured for Starknet Mainnet.",
          loading: false,
          value: null,
        }),
      id: "unconfigured",
      label: "Network not configured",
      narrative:
        "A network with incomplete privacy routing fails closed and directs the user to configuration instead of attempting discovery.",
      state: { configuration: "missing", failClosed: true },
    },
    {
      content: () =>
        privacyDashboard({
          error: "Ledger accounts cannot derive the STRK20 viewing key in this wallet.",
          loading: false,
          value: null,
        }),
      id: "ledger-unsupported",
      label: "Ledger unsupported",
      narrative:
        "The hardware boundary is explicit: no fallback key derivation or ambiguous retry is offered.",
      state: { accountKind: "ledger", failClosed: true },
    },
    {
      content: () =>
        privacyDashboard({
          error: "The privacy discovery service is unavailable. No private state was returned.",
          loading: false,
          value: null,
        }),
      id: "service-failed",
      label: "Discovery service failure",
      narrative:
        "A remote failure remains local to the private portfolio and offers an explicit retry without leaking stale balances.",
      state: { indexer: "failed", staleDataVisible: false },
    },
    {
      content: () =>
        privacyDashboard(
          {
            error: "The privacy discovery service is unavailable. No private state was returned.",
            loading: false,
            value: null,
          },
          { stage: "idle" },
          "token-detail",
        ),
      id: "asset-service-failed",
      label: "Asset privacy unavailable",
      narrative:
        "Token detail keeps the failure compact; retry surfaces the display-safe diagnostic in a copyable toast instead of embedding service text in the asset screen.",
      state: { indexer: "failed", rawServiceCopyVisible: false, retry: "available" },
    },
    {
      content: () => privacyDashboard(disclosure("unregistered")),
      id: "activation-required",
      label: "Activation required",
      narrative:
        "An unregistered account gets one precise next step and a clear public-linkage disclosure.",
      state: { accountRegistration: "required", privateBalances: 0 },
    },
    {
      content: () =>
        privacyDashboard(
          disclosure("unregistered"),
          { preparation: activation, stage: "activate-review", tokenId: ETH_TOKEN.id },
          "privacy",
        ),
      id: "activation-review",
      label: "Review activation",
      narrative:
        "The review states the outcome in plain language and that registration moves no funds; the public route, pool, network, and viewing-key commitment stay under Technical details.",
      state: { route: "public-account", stage: "review", task: "register" },
    },
    {
      content: () =>
        privacyDashboard(
          disclosure("unregistered"),
          {
            kind: "register",
            preparation: activation,
            stage: "working",
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "activating",
      label: "Proof and authorization",
      narrative:
        "Progress remains visible across proof generation, authorization, broadcast, and indexer discovery.",
      state: { liveness: "visible", stage: "proving", task: "register" },
    },
    {
      content: () =>
        privacyDashboard(
          privateReady,
          {
            hash: "0x074782b2c25c9cebaef01d6289b80829b69f10c2d3b8a648aa10cf019a2eb31",
            kind: "register",
            stage: "success",
            symbol: ETH_TOKEN.symbol,
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "activated",
      label: "Activation submitted",
      narrative:
        "Success confirms the on-chain result while honestly allowing for indexer catch-up.",
      state: { indexer: "catching-up", stage: "success", task: "register" },
    },
    {
      content: () => privacyDashboard(privateReady),
      id: "private-portfolio",
      label: "Private portfolio",
      narrative:
        "The same token list now displays account-scoped private note totals instead of public balances.",
      state: { disclosure: "on", privateAssets: 1, registration: "ready" },
    },
    {
      content: () => privacyDashboard(disclosure("registered")),
      id: "registered-empty",
      label: "Registered with no notes",
      narrative:
        "A registered account with no discovered notes gets an asset-oriented next step into Send rather than a zero-value ambiguity.",
      state: { privateAssets: 0, registration: "ready" },
    },
    {
      content: () => privacyDashboard(privateReady, { stage: "idle" }, "token-detail"),
      id: "asset-entry",
      label: "Asset privacy action",
      narrative:
        "The asset detail preserves token context and offers Shield and Unshield side by side; each opens Send already configured for that direction.",
      state: { asset: ETH_TOKEN.id, cta: ["shield", "unshield"] },
    },
    {
      content: () =>
        privacyDashboard(
          privateReady,
          {
            error: "The prover could not complete this proof. No transaction was submitted.",
            stage: "failure",
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "activation-failed",
      label: "Recover from failure",
      narrative:
        "Failure is explicit, never auto-retries, and keeps retry or return choices close to the task.",
      state: { autoRetry: false, stage: "failure" },
    },
    ...privacyDappCheckpoints,
  ],
  description:
    "Balance disclosure, pool registration, dapp approvals, dapp anonymizers, AVNU private swap, sub-accounts, and fail-closed recovery. Shielding, unshielding, and private sends are composed in Send, so they are checkpointed with the other send routes rather than here.",
  id: "privacy",
  surface: "sidepanel",
  title: "Private balances and actions",
  views: ["home", "token-detail", "privacy", "requests"],
};
