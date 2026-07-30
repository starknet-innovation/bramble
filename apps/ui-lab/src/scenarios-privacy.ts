/**
 * Deterministic private-balance checkpoints. These render production templates
 * with fixture values only: no vault, hardware, prover, indexer, or RPC access.
 */
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../../src/sidepanel/privacy-model";
import type {
  PrivacyPreparation,
  PrivateBalanceView,
} from "../../../src/sidepanel/privacy-runtime";
import { softwareAccount, statusFor } from "./fixtures";
import { ETH_TOKEN, journeyBalances, journeyPreferences, journeyPrices } from "./journey-fixtures";
import { walletDashboard } from "./scenario-dashboard";
import type { WalletScenario } from "./types";

const digest = `sha256:${"d".repeat(64)}`;
const poolAddress = "0x04f53a62c20f7dfc5406c6f8704cf18ac78f313641988d12fb6efb79893e813";

const activation: PrivacyPreparation = {
  id: digest,
  kind: "register",
  payloadDigest: digest,
  poolAddress,
  route: "public-account",
  summaries: [
    "Register this account with the privacy pool",
    "Registration is public and links this wallet address to its viewing key",
  ],
  symbol: ETH_TOKEN.symbol,
  tokenId: ETH_TOKEN.id,
};

const deposit: PrivacyPreparation = {
  amount: "0.5",
  id: digest,
  kind: "deposit",
  payloadDigest: digest,
  poolAddress,
  route: "public-account",
  summaries: [
    "Shield 0.5 ETH",
    "Public account fee — first deposits are linked to this wallet",
    "The deposit is public; the resulting balance can be spent privately",
  ],
  symbol: ETH_TOKEN.symbol,
  tokenId: ETH_TOKEN.id,
};

const disclosure = (
  registration: "registered" | "unregistered",
  balances: readonly PrivateBalanceView[] = [],
): PrivacyDisclosureState => ({
  enabled: true,
  error: null,
  loading: false,
  value: {
    accountId: softwareAccount.id,
    balances,
    networkId: "SN_MAIN",
    registration,
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
      content: () => privacyDashboard({ enabled: false, error: null, loading: false, value: null }),
      id: "public-portfolio",
      label: "Public portfolio",
      narrative:
        "Private note discovery stays off until the user explicitly enables the account-scoped disclosure.",
      state: { disclosure: "off", privateDataRead: false },
    },
    {
      content: () => privacyDashboard({ enabled: true, error: null, loading: true, value: null }),
      id: "discovering",
      label: "Discovering balances",
      narrative:
        "The explicitly selected private portfolio communicates indexer work without implying that its private totals are already known.",
      state: { disclosure: "on", indexer: "loading", scope: softwareAccount.id },
    },
    {
      content: () =>
        privacyDashboard({
          enabled: true,
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
          enabled: true,
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
          enabled: true,
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
        "A registered account with no discovered notes gets an asset-oriented shielding next step rather than a zero-value ambiguity.",
      state: { privateAssets: 0, registration: "ready" },
    },
    {
      content: () => privacyDashboard(privateReady, { stage: "idle" }, "token-detail"),
      id: "asset-entry",
      label: "Asset privacy action",
      narrative:
        "The asset detail preserves token context and exposes one direct Shield ETH action.",
      state: { asset: ETH_TOKEN.id, cta: "shield" },
    },
    {
      content: () =>
        privacyDashboard(privateReady, { stage: "compose", tokenId: ETH_TOKEN.id }, "privacy"),
      id: "shield-compose",
      label: "Choose shield amount",
      narrative:
        "Amount, available public balance, shortcuts, token identity, and destination network fit one task view.",
      state: { amount: "editable", publicBalance: "1.25", token: "ETH" },
    },
    {
      content: () =>
        privacyDashboard(
          privateReady,
          { preparation: deposit, stage: "deposit-review", tokenId: ETH_TOKEN.id },
          "privacy",
        ),
      id: "shield-review",
      label: "Review shielding",
      narrative:
        "The user sees that this deposit and its fee route are public before authorizing the frozen amount.",
      state: { amount: "0.5 ETH", route: "public-account", stage: "review" },
    },
    {
      content: () =>
        walletDashboard({
          balanceState: { balances: journeyBalances },
          pending: [
            {
              actionReviews: [
                {
                  amount: "0x2386f26fc10000",
                  recipient: "0x031075ef90ad626dc13fb97cdc7e04499ee5fa1007f2c4e1a9439b22fc3755b9",
                  token: ETH_TOKEN.address,
                  type: "transfer",
                },
              ],
              context: {
                accountId: softwareAccount.id,
                chainId: "0x534e5f4d41494e",
                networkId: "SN_MAIN",
                payloadDigest: digest,
              },
              id: "8db96ddc-e9c8-4e07-9da0-d2d91d8d6270",
              kind: "strk20-invoke",
              origin: "https://terminal.example",
              relayFeeAction: {
                amount: "0x1",
                recipient: "0x99",
                token: ETH_TOKEN.address,
                type: "withdraw",
              },
              summaries: [
                "Transfer 0.25 privately to 0x031075…755b9 (0x049d…4dc7)",
                "Private relay fee 0x1 (0x049d…4dc7) · outside execution by 0x0000…0099 from 1 until 3600 for 1 public approval call",
              ],
            },
          ],
          preferences: journeyPreferences,
          prices: journeyPrices,
          privacy: privateReady,
          status: statusFor(),
          view: "requests",
        }),
      id: "private-relay-review",
      label: "Wallet API private relay",
      narrative:
        "Transfers, withdrawals, and invokes remain dapp/API journeys: their exact actions, fee, outside-execution capability, account, network, and digest are reviewed before private reads, proving, or signing.",
      state: { route: "private-relay", stage: "approval", surface: "wallet-api" },
    },
    {
      content: () =>
        privacyDashboard(
          privateReady,
          {
            kind: "deposit",
            preparation: deposit,
            stage: "working",
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "shielding",
      label: "Shielding in progress",
      narrative:
        "The same liveness sequence makes remote proving and wallet authorization legible.",
      state: { liveness: "visible", stage: "proving", task: "deposit" },
    },
    {
      content: () =>
        privacyDashboard(
          privateReady,
          {
            hash: "0x05c4767aa1f10347767214ea38c518bfdf0d22aa5ad53f85669a887d96cacb2",
            kind: "deposit",
            stage: "success",
            symbol: ETH_TOKEN.symbol,
            tokenId: ETH_TOKEN.id,
          },
          "privacy",
        ),
      id: "shielded",
      label: "Shielding submitted",
      narrative:
        "The wallet confirms broadcast and explains when the new private balance becomes visible.",
      state: { indexer: "catching-up", stage: "success", task: "deposit" },
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
      id: "shield-failed",
      label: "Recover from failure",
      narrative:
        "Failure is explicit, never auto-retries, and keeps retry or return choices close to the task.",
      state: { autoRetry: false, stage: "failure" },
    },
  ],
  description:
    "Opt-in private disclosure, account registration, public-to-private shielding, liveness, success, and fail-closed recovery.",
  id: "privacy",
  surface: "sidepanel",
  title: "Private balances and shielding",
  views: ["home", "token-detail", "privacy", "requests"],
};
