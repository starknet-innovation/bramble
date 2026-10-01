/**
 * Fixture 5 (docs/privacy.md §6): the extension's privacy gates, rendered through its own side-panel
 * templates and bindings and read back from the markup, so the mobile core's gate enums and the
 * Swift strings are pinned to what the extension shows today. The journey outcomes are driven
 * through `bindPrivacy` in a DOM with stubbed wallet calls; nothing reaches a network.
 */
import { defaultWalletPreferences, type TokenConfig } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import { PrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import type {
  TokenBalance,
  WalletStatus,
} from "../packages/presentation/wallet-ui/src/popup/responses/responses";
import { simpleFlowScreen } from "../packages/presentation/wallet-ui/src/sidepanel/app/screens/flows";
import {
  homeTabs,
  unifiedHomeBalances,
  visiblePrivateHomeBalances,
} from "../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/home-tabs";
import { tokenDetailFlow } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/token-flows";
import {
  compactAmount,
  PORTFOLIO_FRACTION_PLACES,
} from "../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/token-row";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../packages/presentation/wallet-ui/src/sidepanel/journeys/privacy/privacy-model";
import { bindPrivacy } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/privacy/privacy-ui";
import type { SidepanelWallet } from "../packages/presentation/wallet-ui/src/sidepanel/runtime/runtime";
import { privacyDataIssue } from "../packages/presentation/wallet-ui/src/sidepanel/shared/network-status";
import { shieldTile } from "../packages/presentation/wallet-ui/src/sidepanel/shell/wallet-shell";
import {
  registerDom,
  unregisterDom,
} from "../packages/presentation/wallet-ui/tests/support/groups-harness";

const preferences = defaultWalletPreferences();
const token = (symbol: string): TokenConfig => {
  const found = preferences.tokens.find(
    (entry) => entry.networkId === "SN_MAIN" && entry.symbol === symbol,
  );
  if (!found) throw new Error(`missing ${symbol}`);
  return found;
};
const ETH = token("ETH");
const STRK = token("STRK");
const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

/** The readings the mobile gates take, as the extension's disclosure states. */
export const READINGS = [
  "idle",
  "loading",
  "failed",
  "unconfigured",
  "unregistered",
  "registered",
] as const;
type Reading = (typeof READINGS)[number];

const PRIVATE_ETH = { balance: "1234567890000000000", formatted: "1.23456789" };

const value = (registration: "registered" | "unregistered") => ({
  accountId: account.id,
  balances:
    registration === "registered"
      ? [
          { ...PRIVATE_ETH, symbol: "ETH", token: ETH.address, tokenId: ETH.id },
          { balance: "0", formatted: "0", symbol: "STRK", token: STRK.address, tokenId: STRK.id },
        ]
      : [],
  networkId: "SN_MAIN",
  poolFeeFri: "0x53444835ec580000",
  relayConfigured: false,
  registration,
});

/** The extension's disclosure state for a reading. */
export const disclosureFor = (reading: Reading): PrivacyDisclosureState => {
  switch (reading) {
    case "idle":
      return { error: null, loading: false, value: null };
    case "loading":
      return { error: null, loading: true, value: null };
    case "failed":
      return {
        blockerKind: "service",
        error: "Private balances unavailable",
        loading: false,
        value: null,
      };
    case "unconfigured":
      return {
        blockerKind: "network",
        error: "Private balances are not configured for this network",
        loading: false,
        value: null,
      };
    default:
      return { error: null, loading: false, value: value(reading) };
  }
};

const text = (html: string): string =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const attr = (html: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? null;

const STRK_VALUES = { null: null, zero: "0", funded: "1000000000000000000" } as const;
type Strk = keyof typeof STRK_VALUES;
const DEPLOYMENTS = { deployed: true, undeployed: false, unknown: null } as const;
type Deployment = keyof typeof DEPLOYMENTS;

const balancesFor = (strk: Strk): TokenBalance[] => [
  { ...ETH, balance: "2000000000000000000", formatted: "2" },
  ...(STRK_VALUES[strk] === null
    ? []
    : [{ ...STRK, balance: STRK_VALUES[strk] ?? "0", formatted: "1" }]),
];
const fundedFor = (strk: Strk): boolean | null => (strk === "null" ? null : strk === "funded");

const tileOf = (html: string) => ({
  action: html.includes("disabled")
    ? "none"
    : (attr(html, "data-view") ??
      (html.includes("data-send-shield") ? "send-shield" : "privacy-open")),
  aria: attr(html, "aria-label"),
  label: /<span class="tile-label">([^<]*)<\/span>/.exec(html)?.[1] ?? null,
});

const privateLineOf = (html: string) => {
  const row =
    html
      .split('<li class="token-row token-unified"')
      .find((part) => part.includes(`token:${ETH.id}:balance`)) ?? "";
  const register = /<button class="token-breakdown-register"[\s\S]*?<\/button>/.exec(row)?.[0];
  if (register) {
    return {
      action: attr(register, "data-view") ?? "privacy-open",
      text: text(register).replace(/^Private balance /, ""),
    };
  }
  const value = /<span class="token-breakdown-value">([^<]*)<\/span>/g;
  const values = [...row.matchAll(value)].map((match) => match[1]);
  return { action: "none", text: values[1] ?? null };
};

const detailOf = (html: string) => {
  const section =
    html
      .split('<p class="eyebrow">Your balance</p>')[1]
      ?.split('<p class="eyebrow">Contract</p>')[0] ?? "";
  const block = section.split("private-balance-summary")[1];
  const summary = block
    ? ((/<strong class="token-amount">([^<]*)<\/strong>/.exec(block) ??
        /<span class="token-fiat">([^<]*)<\/span>/.exec(block))?.[1] ?? null)
    : null;
  const actions = [
    ...section.matchAll(
      /<button[^>]*(data-view="receive"|data-privacy-open|data-send-shield|data-send-unshield)[^>]*>[\s\S]*?<\/button>/g,
    ),
  ].map((m) => text(m[0]));
  return { actions, summary };
};

const noticeOf = (html: string): string => {
  if (!html.includes("privacy-pool-notice")) return "hidden";
  if (html.includes("Deploy this account and add STRK")) return "fund-first";
  if (html.includes("takes two transactions")) return "deploy-first";
  return "register";
};

const poolNotice = (reading: Reading, deployment: Deployment, strk: Strk): string =>
  noticeOf(
    simpleFlowScreen("receive", {
      account,
      allowances: [],
      balances: strk === "null" ? [] : balancesFor(strk),
      changes: {},
      classHashVerification: null,
      connectedSites: [],
      currency: "usd",
      deployment: DEPLOYMENTS[deployment],
      expandedGroupId: null,
      preferences,
      prices: {},
      privacy: disclosureFor(reading),
      status,
    }) ?? "",
  );

/** The static gates over every (reading, deployment, STRK) combination. */
const computeStaticGates = () => {
  const rows = [];
  for (const reading of READINGS) {
    for (const deployment of Object.keys(DEPLOYMENTS) as Deployment[]) {
      for (const strk of Object.keys(STRK_VALUES) as Strk[]) {
        const privacy = disclosureFor(reading);
        const funded = fundedFor(strk);
        const known = reading === "registered" ? true : DEPLOYMENTS[deployment];
        const home = homeTabs(
          { balances: balancesFor(strk) },
          preferences,
          {},
          {},
          "usd",
          privacy,
          DEPLOYMENTS[deployment],
          funded,
        );
        rows.push({
          deployment,
          detail: detailOf(
            tokenDetailFlow(
              status,
              ETH,
              { ...ETH, balance: "2", formatted: "2" },
              [],
              null,
              "usd",
              privacy,
              DEPLOYMENTS[deployment],
            ),
          ),
          notice: poolNotice(reading, deployment, strk),
          privateLine: privateLineOf(home),
          reading,
          retryRow: home.includes("data-privacy-retry"),
          status: privacyDataIssue("home", account, status, privacy, false),
          strk,
          tile: tileOf(shieldTile(STRK.id, reading === "registered", known, funded)),
        });
      }
    }
  }
  return rows;
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type JourneyInput = {
  readonly deployment: Deployment;
  readonly deploymentRead: Deployment | "throws";
  readonly load: "failed" | "registered" | "unregistered";
  readonly reading: Reading;
};

const runJourney = async (input: JourneyInput) => {
  let disclosure = disclosureFor(input.reading);
  const journeys: PrivacyJourneyState[] = [];
  let opened = false;
  const app = document.createElement("main");
  app.innerHTML = `<button data-privacy-open="${ETH.id}">Shield</button>`;
  document.body.append(app);
  bindPrivacy({
    app,
    balances: () => [],
    deployment: () => DEPLOYMENTS[input.deployment],
    disclosure: () => disclosure,
    generation: () => 0,
    journey: () => journeys.at(-1) ?? { stage: "idle" },
    navigate: () => undefined,
    openSend: () => {
      opened = true;
    },
    paint: () => undefined,
    preferences: () => preferences,
    setDisclosure: (state) => {
      disclosure = state;
    },
    setJourney: (journey) => {
      journeys.push(journey);
    },
    status: () => status,
    wallet: {
      loadDeploymentStatus: async () => {
        if (input.deploymentRead === "throws") throw new Error("rpc down");
        return { accountId: account.id, deployed: DEPLOYMENTS[input.deploymentRead] };
      },
      loadPrivacyState: async () => {
        if (input.load === "failed") throw new Error("Private balances unavailable");
        return value(input.load);
      },
      preparePrivacyRegistration: async () => {
        throw new PrivacyBlockerError("service", "fixture stops before proving");
      },
    } as unknown as SidepanelWallet,
  });
  app.querySelector<HTMLButtonElement>("[data-privacy-open]")?.click();
  for (let i = 0; i < 5; i += 1) await tick();
  app.remove();
  const proving = journeys.some(
    (journey) => journey.stage === "preparing" && journey.step === "proving",
  );
  const last = journeys.at(-1);
  const outcome = opened
    ? "open-shield"
    : proving
      ? "activate"
      : last?.stage === "blocked"
        ? `blocked:${last.blocker.kind}`
        : (last?.stage ?? "idle");
  const detail = !proving && last?.stage === "blocked" ? last.blocker.message : null;
  return { ...input, detail, outcome };
};

/** Journey outcomes: every reading and deployment, with each deployment read and load result. */
const computeJourneys = async () => {
  const rows = [];
  for (const reading of READINGS) {
    for (const deployment of Object.keys(DEPLOYMENTS) as Deployment[]) {
      const reads: (Deployment | "throws")[] =
        deployment === "unknown" ? ["deployed", "undeployed", "throws"] : [deployment];
      for (const deploymentRead of reads) {
        for (const load of ["registered", "unregistered", "failed"] as const) {
          rows.push(await runJourney({ deployment, deploymentRead, load, reading }));
        }
      }
    }
  }
  return rows;
};

const PUBLIC_MIXES = {
  both: [
    { ...ETH, balance: "2000000000000000000", formatted: "2" },
    { ...STRK, balance: "1234567000000000000000", formatted: "1234.567" },
  ],
  ethOnly: [{ ...ETH, balance: "10000000000000", formatted: "0.00001" }],
  none: [],
} as const;

/** `unifiedHomeBalances` + `compactAmount` over public/private mixes, and "Includes shielded". */
const computeUnified = () =>
  (Object.keys(PUBLIC_MIXES) as (keyof typeof PUBLIC_MIXES)[]).flatMap((mix) =>
    (["loading", "unregistered", "registered"] as const).map((reading) => {
      const privacy = disclosureFor(reading);
      return {
        includesShielded: visiblePrivateHomeBalances(privacy, preferences).some(
          (t) => BigInt(t.balance) > 0n,
        ),
        mix,
        public: PUBLIC_MIXES[mix].map((t) => ({ balance: t.balance, token: t.address })),
        reading,
        rows: unifiedHomeBalances({ balances: [...PUBLIC_MIXES[mix]] }, privacy, preferences).map(
          (t) => ({
            balance: BigInt(t.balance).toString(),
            compact: compactAmount(t.formatted, PORTFOLIO_FRACTION_PLACES),
            formatted: t.formatted,
            token: t.address,
          }),
        ),
      };
    }),
  );

const COMPACT_INPUTS = [
  "0",
  "1",
  "1.5",
  "0.5",
  "12.000001",
  "1234567.891",
  "0.00001234",
  "0.000012345678",
  "0.000000001",
  "999.999",
  "1000000",
];

/** Fixture 5 in full. Registers a DOM for the journey rows and removes it afterwards. */
export const computeGates = async () => {
  await registerDom();
  try {
    return {
      compactAmounts: COMPACT_INPUTS.flatMap((input) => [
        { input, places: null, text: compactAmount(input) },
        {
          input,
          places: PORTFOLIO_FRACTION_PLACES,
          text: compactAmount(input, PORTFOLIO_FRACTION_PLACES),
        },
      ]),
      journeys: await computeJourneys(),
      privateEth: PRIVATE_ETH,
      static: computeStaticGates(),
      unified: computeUnified(),
    };
  } finally {
    await unregisterDom();
  }
};
