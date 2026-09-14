/**
 * Every truncated account or contract identifier the wallet shows on its
 * inspecting and reviewing surfaces is copyable in full: beside each
 * `0x1234…abcd` there is a `[data-copy]` control whose value shortens to
 * exactly that text. Rendered through the production templates with the shared
 * fixtures, so a new truncated identifier on one of these surfaces fails here
 * until it gains its copy control. Picker rows (send recipients, participants,
 * the account drawer) are deliberately not covered: the row is the control
 * there, and the chosen identity lands on one of these surfaces.
 *
 * The clipboard path itself is exercised once through the shared binding: the
 * control writes the full value and confirms through the section's status line
 * without touching any live-region container that shares the section.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { AllowanceView } from "@bramble/transactions/allowance-discovery";
import type { PendingApproval, WalletStatus } from "../../../src/popup/responses/responses";
import { dashboard } from "../../../src/sidepanel/app/screens/views";
import { approvalCard } from "../../../src/sidepanel/journeys/approvals/approval-cards";
import { transactionRow } from "../../../src/sidepanel/journeys/portfolio/home-tabs";
import { reviewSummaryHtml } from "../../../src/sidepanel/journeys/send/transfer-review-markup";
import { bindCopyButtons } from "../../../src/sidepanel/shared/dom";
import { accountLabel } from "../../../src/sidepanel/shared/parts";
import { makeArgentMultisigFixture } from "../../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

beforeEach(() => {
  document.body.replaceChildren();
});

const SPENDER = "0x05abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const COUNTERPARTY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const allowance: AllowanceView = {
  accountId: account.id,
  amount: "1000",
  id: `SN_MAIN:${TOKEN}:${SPENDER}`,
  networkId: "SN_MAIN",
  source: "wallet",
  spender: SPENDER,
  token: TOKEN,
};

const TRUNCATED = /^0x[0-9a-f]{4}…[0-9a-f]{4}$/;

const mount = (markup: string): HTMLElement => {
  const host = document.createElement("div");
  host.replaceChildren(document.createRange().createContextualFragment(markup));
  document.body.append(host);
  return host;
};

/**
 * Every `<code>` showing a truncated identifier, paired with the copy controls
 * whose full value shortens to it.
 */
const truncatedIdentifiers = (
  root: HTMLElement,
): readonly { readonly text: string; readonly copies: readonly string[] }[] => {
  const copies = Array.from(root.querySelectorAll<HTMLElement>("[data-copy]")).map(
    (control) => control.dataset["copy"] ?? "",
  );
  return Array.from(root.querySelectorAll("code"))
    .map((code) => code.textContent?.trim() ?? "")
    .filter((text) => TRUNCATED.test(text))
    .map((text) => ({ copies: copies.filter((value) => accountLabel(value) === text), text }));
};

const expectEveryTruncatedIdentifierCopyable = (root: HTMLElement, atLeast: number): void => {
  const identifiers = truncatedIdentifiers(root);
  expect(identifiers.length).toBeGreaterThanOrEqual(atLeast);
  for (const identifier of identifiers) {
    expect(identifier.copies.length).toBeGreaterThan(0);
  }
  // Copy controls are real buttons with a name, and never nest in another control.
  for (const control of Array.from(root.querySelectorAll<HTMLElement>("[data-copy]"))) {
    expect(control.tagName).toBe("BUTTON");
    expect(control.getAttribute("aria-label") || control.textContent?.trim()).toBeTruthy();
    expect(control.parentElement?.closest("button, a")).toBeNull();
  }
};

describe("truncated identifiers are copyable in full", () => {
  test("send review facts", () => {
    const root = mount(
      reviewSummaryHtml({
        accountId: account.id,
        amount: "1",
        destination: "public",
        fiatEstimate: "$1.00",
        recipient: COUNTERPARTY,
        recipientLabel: "",
        signer: "software",
        source: "public",
        speed: "standard",
        tokenAddress: TOKEN,
        tokenBalance: "0",
        tokenDecimals: "18",
        tokenFormatted: "0",
        tokenId: `SN_MAIN:STRK:${TOKEN}`,
        tokenPrice: "",
        tokenSymbol: "STRK",
      }),
    );
    expectEveryTruncatedIdentifierCopyable(root, 1);
  });

  test("activity rows with a recorded counterparty", () => {
    const root = mount(
      transactionRow({
        accountId: account.id,
        counterparty: COUNTERPARTY,
        hash: "0x123",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "accepted",
        submittedAt: 1,
        summary: "Send 1 STRK",
      }),
    );
    // The detail line is not a <code>, so check it by hand: truncated text,
    // full value on the control.
    expect(root.querySelector(".tx-counterparty > span")?.textContent).toBe(
      `To ${accountLabel(COUNTERPARTY)}`,
    );
    expect(root.querySelector<HTMLElement>(".tx-counterparty [data-copy]")?.dataset["copy"]).toBe(
      COUNTERPARTY,
    );
    expectEveryTruncatedIdentifierCopyable(root, 0);
  });

  test("accounts & groups, deploy review, address book, and allowances", () => {
    const withContacts = {
      ...preferences,
      addressBook: [
        {
          address: COUNTERPARTY,
          id: `SN_MAIN:${COUNTERPARTY}`,
          label: "Research treasury",
          networkId: "SN_MAIN" as const,
          publicKeyX: TOKEN,
        },
      ],
    };
    const screens = [
      ["account", 2],
      ["deploy-account", 1],
      ["address-book", 1],
      ["allowances", 1],
    ] as const;
    for (const [view, atLeast] of screens) {
      const root = mount(
        dashboard(view, status, [], withContacts, { balances: [] }, false, [], [], {}, [], null, [
          allowance,
        ]),
      );
      expectEveryTruncatedIdentifierCopyable(root, atLeast);
    }
  });

  test("dApp approval cards", () => {
    const watchAsset: PendingApproval = {
      id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
      kind: "watch-asset",
      origin: "https://dapp.example",
      token: {
        address: TOKEN,
        decimals: 18,
        name: "Starknet",
        networkId: "SN_MAIN",
        symbol: "STRK",
      },
    };
    const invoke: PendingApproval = {
      context: {
        accountId: account.id,
        chainId: "0x534e5f4d41494e",
        networkId: "SN_MAIN",
        payloadDigest: `sha256:${"a".repeat(64)}`,
      },
      id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff15",
      kind: "invoke",
      origin: "https://dapp.example",
      summaries: ["Transfer 1 STRK"],
    };
    for (const approval of [watchAsset, invoke]) {
      expectEveryTruncatedIdentifierCopyable(mount(approvalCard(approval, status)), 1);
    }
  });

  test("multisig signers and intent technical details", async () => {
    const fixture = await makeArgentMultisigFixture([
      { calldata: ["0x1"], contractAddress: COUNTERPARTY, entrypoint: "transfer" },
    ]);
    const signer = fixture.status.accounts[0] ?? null;
    const signers = mount(
      dashboard(
        "multisig-signers",
        fixture.status,
        [],
        preferences,
        { balances: [] },
        null,
        [],
        [],
        {},
        [],
        null,
        [],
        null,
        {},
        [fixture.view],
        [],
        fixture.record.id,
      ),
    );
    expectEveryTruncatedIdentifierCopyable(signers, 0);
    expect(signers.querySelectorAll("[data-copy]").length).toBeGreaterThanOrEqual(2);

    const detail = mount(
      dashboard(
        "multisig-detail",
        fixture.status,
        [],
        preferences,
        { balances: [] },
        null,
        [],
        [],
        {},
        [],
        null,
        [],
        null,
        {},
        [fixture.view],
        [fixture.intent],
        fixture.record.id,
      ),
    );
    expect(signer).not.toBeNull();
    expectEveryTruncatedIdentifierCopyable(detail, 2);
  });
});

describe("the shared copy binding", () => {
  test("copies the full value and confirms on the section's status line only", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });
    const root = mount(
      dashboard(
        "allowances",
        status,
        [],
        preferences,
        { balances: [] },
        null,
        [],
        [],
        {},
        [],
        null,
        [allowance],
      ),
    );
    bindCopyButtons(root);
    const control = root.querySelector<HTMLButtonElement>(".allowance-spender [data-copy]");
    if (!control) throw new Error("spender copy control missing");

    control.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(copied).toEqual([SPENDER]);
    expect(control.getAttribute("aria-label")).toBe("Copy spender address");
    const section = control.closest(".section");
    expect(section?.querySelector('p[role="status"]')?.textContent).toBe("Copied");
    // No container carrying the role was rewritten into the feedback text.
    for (const region of Array.from(
      root.querySelectorAll('section[role="status"], div[role="status"]'),
    )) {
      expect(region.textContent?.trim()).not.toBe("Copied");
    }
  });
});
