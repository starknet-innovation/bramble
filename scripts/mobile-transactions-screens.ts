/**
 * Static text of the extension's Send screens and the Settings deploy row, read by rendering the
 * side panel's own markup (`sendFlow`, `settingsScreen`) and extracting each section's text in order.
 * The mobile screens show the same strings; a copy change in the extension fails the drift gate
 * until the fixture, and the Swift copy table asserted against it, follow.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
// Not package exports: side-panel renderers, read here only to pin the mobile port.
import {
  sendFlow,
  simpleFlowScreen,
} from "../packages/presentation/wallet-ui/src/sidepanel/app/screens/flows";
import { transactionRow } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/home-tabs";
import { sendBalanceLine } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/send/send-model";
import {
  reviewRisksHtml,
  reviewSummaryHtml,
} from "../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-review-markup";
import { settingsScreen } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/settings/settings-views";
import { reviewFeeSection } from "../packages/presentation/wallet-ui/src/sidepanel/shared/review-render";

const ADDRESS = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";
const SECTIONS = [
  "send-recipient-stage",
  "send-details",
  "send-review-stage",
  "send-working",
  "send-pending",
  "send-success",
  "send-failure",
] as const;

const texts = (html: string): string[] =>
  html
    .split(/<[^>]+>/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);

const attributes = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`${name}="([^"]+)"`, "g"))].map((match) => match[1] ?? "");

// The deploy strings the binding writes (fee line, status lines, receipt titles) exist only inside
// its literals; they are read from that source so a wording change there still fails the drift gate.
const BINDING_SOURCE = "packages/presentation/wallet-ui/src/sidepanel/shell/shell-bindings.ts";

// The details step's zero-amount gate is likewise a literal inside the Send binding.
const SEND_BINDING_SOURCE =
  "packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-ui.ts";

const bindingPrefix = (pattern: RegExp, source = BINDING_SOURCE): string => {
  const match = readFileSync(source, "utf8").match(pattern);
  if (!match?.[1]) throw new Error(`${source} no longer contains ${pattern}`);
  return match[1];
};

/** Every Send section's visible text, placeholders and accessible names, in document order. */
export const computeScreenCopy = () => {
  const account = {
    accountContractType: "openzeppelin",
    address: ADDRESS,
    classHash: "0x1",
    derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_SEPOLIA:${ADDRESS}`,
    networkId: "SN_SEPOLIA",
    publicKeyX: "0x1",
  };
  const tokens = DEFAULT_TOKENS.filter((token) => token.networkId === "SN_SEPOLIA").map(
    (token) => ({ ...token, id: `SN_SEPOLIA:${token.symbol}` }),
  );
  const html = sendFlow(
    {
      accounts: [account],
      network: "Starknet Sepolia",
      networkId: "SN_SEPOLIA",
      networks: [],
    } as never,
    account as never,
    { addressBook: [], displayCurrency: "usd", groups: [], tokens } as never,
    [],
  );
  const sections = Object.fromEntries(
    SECTIONS.map((id) => {
      const section =
        html.match(new RegExp(`<section [^>]*id="${id}"[\\s\\S]*?</section>`))?.[0] ?? "";
      return [
        id,
        {
          ariaLabels: attributes(section, "aria-label"),
          placeholders: attributes(section, "placeholder"),
          text: texts(section),
        },
      ];
    }),
  );
  // Deploying first is a choice in Settings, under the account it applies to; Home no longer
  // flags an undeployed account, because the first send deploys it.
  const deployRow = () => {
    const settings = settingsScreen(
      { accounts: [account], network: "Starknet Sepolia", networkId: "SN_SEPOLIA" } as never,
      null,
      { commit: "", version: "" } as never,
    );
    const group =
      settings.match(
        /<section class="section">(?:(?!<\/section>)[\s\S])*?data-view="deploy-account"[\s\S]*?<\/section>/,
      )?.[0] ?? "";
    const [eyebrow = "", label = ""] = texts(group);
    return { eyebrow, label };
  };
  const recipient = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3";
  const summary = reviewSummaryHtml(
    {
      amount: "1.5",
      fiatEstimate: "",
      recipient,
      recipientLabel: "",
      tokenAddress: tokens[0]?.address ?? "",
      tokenSymbol: "STRK",
    } as never,
    "send",
    { address: ADDRESS, label: "Account 1" },
  );
  // The confirm face shows only what needs saying: nothing on a clean send, the deployment note
  // on an account's first one.
  const risks = (requiresDeployment: boolean) =>
    texts(reviewRisksHtml({ flags: [], requiresDeployment, summaries: [] } as never));
  const deployScreen = (deployment: boolean) =>
    texts(
      simpleFlowScreen("deploy-account", {
        account: account as never,
        allowances: [],
        balances: [],
        changes: {},
        classHashVerification: null,
        connectedSites: [],
        currency: "usd",
        deployment,
        expandedGroupId: null,
        preferences: { addressBook: [], displayCurrency: "usd", groups: [], tokens } as never,
        prices: {},
        privacy: {} as never,
        status: {
          accounts: [account],
          network: "Starknet Sepolia",
          networkId: "SN_SEPOLIA",
          networks: [],
        } as never,
      }) ?? "",
    );
  const row = (status: string) =>
    transactionRow({
      accountId: account.id,
      amount: "1.5",
      counterparty: "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3",
      hash: "0x2270039c0c7c45f14e8e57652884c8a44726d67423b2d1959b454b6ce39f099",
      kind: "transfer",
      networkId: "SN_SEPOLIA",
      status,
      submittedAt: 0,
      summary: "Send 1.5 STRK to 0x3fa7…41a3",
      token: "STRK",
    } as never);
  const pending = row("pending");
  return {
    activityRow: { ariaLabels: attributes(pending, "aria-label"), text: texts(pending) },
    activityStatusLabels: Object.fromEntries(
      ["pending", "preconfirmed", "accepted", "rejected", "reverted"].map((status) => [
        status,
        attributes(row(status), "aria-label")[0]?.split(". ").at(-1) ?? "",
      ]),
    ),
    amountGate: bindingPrefix(/error: "(Enter an amount[^"]*)"/, SEND_BINDING_SOURCE),
    deployAccount: {
      confirmedDescription: bindingPrefix(/confirmedDescription: "([^"]+)"/),
      confirmedTitle: bindingPrefix(/confirmedTitle: "([^"]+)"/),
      deployed: deployScreen(true),
      estimateFailed: bindingPrefix(/failed\(error, "([^"]+)"\)/),
      estimating: bindingPrefix(/scopedStatus\(target, "(Estimating[^"]+)"\)/),
      maximumFeePrefix: bindingPrefix(
        /`(Maximum network fee: )\$\{formatFeeEstimate\(estimate\)\}`/,
      ),
      submittedTitle: bindingPrefix(/submittedTitle: "([^"]+)"/),
      submitting: bindingPrefix(/scopedStatus\(target, "(Submitting[^"]+)"\)/),
      undeployed: deployScreen(false),
    },
    review: {
      risks: risks(false),
      risksUndeployed: risks(true),
      shortfall: texts(
        reviewFeeSection(
          {
            fee: { overallFee: "8053560001244160", unit: "FRI" },
            feeAffordability: "insufficient",
          },
          {},
        ),
      ),
      summary: texts(summary),
      summaryLabels: [...attributes(summary, "aria-label"), ...attributes(summary, "title")],
    },
    balanceLines: [
      { formatted: null, line: sendBalanceLine("public", null, "STRK") },
      { formatted: "12.5", line: sendBalanceLine("public", "12.5", "STRK") },
    ],
    deployRow: deployRow(),
    sections,
  };
};
