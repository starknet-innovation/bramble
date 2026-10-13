/**
 * Deterministic private-balance checkpoints. These render production templates
 * with fixture values only: no vault, hardware, prover, indexer, or RPC access.
 */

import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { STRK20_MAX_POOL_FEE } from "@bramble/privacy/fee-policy";
import { formatStrk20PoolFee } from "@bramble/privacy/service";
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
  POOL_FEE_FRI,
} from "../fixtures/journey-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { WalletScenario } from "../runtime/types";
import { privacyDappCheckpoints } from "./scenarios-privacy-dapp";
import { shadowAccountCheckpoints } from "./scenarios-shadow-accounts";

const digest = `sha256:${"d".repeat(64)}`;

/** The largest pool fee the wallet accepts, the bound the fee line must hold. */
const MAX_POOL_FEE_FRI = `0x${STRK20_MAX_POOL_FEE.toString(16)}`;

// Production registration awaits a successful fee estimate before it returns a
// review, so the fixture carries the same shape and spelling production does: a
// network fee as a canonical base-units integer with its denomination, and the
// pool's action fee as a canonical felt. Omitting them, or spelling either in a
// form the wire grammar rejects, would render a ready-to-authorize review that
// production never produces.
const activation: PrivacyPreparation = {
  id: digest,
  kind: "register",
  networkFee: { overallFee: "2000000000000000", unit: "FRI" },
  payloadDigest: digest,
  poolAddress: STRK20_MAINNET_POOL,
  poolFeeFri: "0x53444835ec580000",
  route: "public-account",
  summaries: [
    "Register this account with the privacy pool",
    "Registration is public and links this wallet address to its viewing key",
    `Approve and pay the reviewed ${formatStrk20PoolFee(POOL_FEE_FRI)} pool fee from this account`,
  ],
  symbol: ETH_TOKEN.symbol,
  tokenId: ETH_TOKEN.id,
};

const disclosure = (
  registration: "registered" | "unregistered",
  balances: readonly PrivateBalanceView[] = [],
  poolFeeFri: string = POOL_FEE_FRI,
): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: {
    accountId: softwareAccount.id,
    balances,
    networkId: "SN_MAIN",
    // The pool's current 6 STRK action fee and a configured relay: the scenarios
    // review the private route, which is only offered when a relay exists. The
    // fund-blocked checkpoints override it to cover the fee's display bounds.
    poolFeeFri,
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
        "The immutable review names the public route, pool, network, and viewing-key commitment before proof generation.",
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
            severity: "danger",
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
    {
      content: () =>
        privacyDashboard(
          privateReady,
          {
            error:
              "The wallet's background worker stopped while sending this private transaction, so its status is unknown. Check Activity before trying again.",
            severity: "warning",
            stage: "failure",
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "activation-unknown",
      label: "Status unknown",
      narrative:
        "A registration whose reply was lost may still be on chain: the amber tone and Activity lead, never the red failure with a blind retry (issue 382).",
      state: { autoRetry: false, severity: "warning", stage: "failure" },
    },
    {
      content: () =>
        privacyDashboard(
          disclosure("unregistered"),
          {
            blocker: {
              kind: "service",
              message: "Could not estimate the network fee for this registration.",
            },
            stage: "blocked",
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "activation-fee-failed",
      label: "Fee estimate failed",
      narrative:
        "A failed fee estimate never reaches a ready-to-authorize review: the preparation blocks with the reported reason and an explicit retry, and nothing is submitted.",
      state: { failClosed: true, prerequisite: "fee-estimate", retry: "available" },
    },
    // The funding shortfall sits after the activation sequence so the guided
    // walkthrough's Step order (required, review, proving, submitted) is intact.
    {
      content: () =>
        privacyDashboard(
          disclosure("unregistered"),
          {
            blocker: { kind: "fund", message: "Not enough STRK for the pool fee" },
            stage: "blocked",
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "fund-blocked",
      label: "Registration needs funds",
      narrative:
        "An account short of STRK is told the exact pool fee its registration needs, in the unit it pays.",
      state: { blocked: "fund", poolFee: "6 STRK", registration: "required" },
    },
    {
      content: () =>
        privacyDashboard(
          disclosure("unregistered", [], MAX_POOL_FEE_FRI),
          {
            blocker: { kind: "fund", message: "Not enough STRK for the pool fee" },
            stage: "blocked",
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "fund-blocked-long",
      label: "Registration fee at its ceiling",
      narrative:
        "The fee line holds at the largest pool fee the wallet accepts, so no figure can push the screen sideways.",
      state: { blocked: "fund", poolFee: "protocol maximum" },
    },
    ...privacyDappCheckpoints,
    ...shadowAccountCheckpoints,
  ],
  description:
    "Balance disclosure, pool registration, dapp approvals, dapp anonymizers, AVNU private swap, shadow accounts, and fail-closed recovery. Shielding, unshielding, and private sends are composed in Send, so they are checkpointed with the other send routes rather than here.",
  id: "privacy",
  surface: "sidepanel",
  title: "Private balances and actions",
  views: ["home", "token-detail", "privacy", "requests", "shadow-accounts"],
};
