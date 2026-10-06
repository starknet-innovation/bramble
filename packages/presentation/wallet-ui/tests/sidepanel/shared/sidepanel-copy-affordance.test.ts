/**
 * Every truncated account or contract identifier the wallet shows on its
 * inspecting and reviewing surfaces is copyable in full: beside each
 * `0x1234…abcd` there is a `[data-copy]` control whose value shortens to
 * exactly that text. Rendered through the production templates with the shared
 * fixtures, so a new truncated identifier on one of these surfaces fails here
 * until it gains its copy control. Picker rows (send recipients, participants,
 * the account drawer) are deliberately not covered: the row is the control
 * there, and the chosen identity lands on one of these surfaces. Full-length
 * addresses in an approval's exact parameters are copyable too, as is Send's
 * chosen recipient once the composer repaints it.
 *
 * The clipboard path itself is exercised once through the shared binding: the
 * control writes the full value and confirms through the section's status line
 * without touching any live-region container that shares the section.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { AllowanceView } from "@bramble/transactions/allowance-discovery";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type { PendingApproval, WalletStatus } from "../../../src/popup/responses/responses";
import { dashboard } from "../../../src/sidepanel/app/screens/views";
import { approvalCard } from "../../../src/sidepanel/journeys/approvals/approval-cards";
import { ledgerSignScreen } from "../../../src/sidepanel/journeys/ledger/sign-views";
import { transactionRow } from "../../../src/sidepanel/journeys/portfolio/home-tabs";
import { restoreTransferCompose } from "../../../src/sidepanel/journeys/send/transfer-compose-ui";
import type { TransferFields } from "../../../src/sidepanel/journeys/send/transfer-model";
import { reviewSummaryHtml } from "../../../src/sidepanel/journeys/send/transfer-review-markup";
import { bindCopyButtons } from "../../../src/sidepanel/shared/dom";
import { accountLabel, inlineCopyButton } from "../../../src/sidepanel/shared/parts";
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

const transferFields: TransferFields = {
  accountId: account.id,
  amount: "1",
  destination: "public",
  fiatEstimate: "$1.00",
  recipient: COUNTERPARTY,
  recipientLabel: "",
  recipientResolvedFrom: "",
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
    expectEveryTruncatedIdentifierCopyable(mount(reviewSummaryHtml(transferFields)), 1);
  });

  test("send's origin account, and the recipient once one is chosen", () => {
    const root = mount(dashboard("send", status, [], preferences, { balances: [] }));
    // The recipient picker rows on the same screen stay lean, so only the
    // origin and route cards are held: "Sending from", then "From" and "To".
    const cards = (): HTMLElement => {
      const host = document.createElement("div");
      for (const card of Array.from(
        root.querySelectorAll(".send-origin-account, #send-route-controls"),
      )) {
        host.append(card.cloneNode(true));
      }
      return host;
    };
    expectEveryTruncatedIdentifierCopyable(cards(), 2);
    const recipientCopy = root.querySelector<HTMLButtonElement>("#send-recipient-copy");
    expect(recipientCopy?.hidden).toBe(true);

    const form = root.querySelector<HTMLFormElement>("#transfer-form");
    if (!form) throw new Error("transfer form missing");
    restoreTransferCompose(form, transferFields);
    expect(recipientCopy?.hidden).toBe(false);
    expect(recipientCopy?.dataset["copy"]).toBe(COUNTERPARTY);
    expectEveryTruncatedIdentifierCopyable(cards(), 3);

    restoreTransferCompose(form, { ...transferFields, recipient: "" });
    expect(recipientCopy?.hidden).toBe(true);
  });

  test("the Ledger signing line", () => {
    const address = "0x0234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const root = mount(
      ledgerSignScreen(
        {
          phase: { kind: "connect" },
          request: {
            accountId: `SN_MAIN:${address}`,
            id: "ledger-sign-1",
            messageHash: "0xabc",
            path: ledgerAccountPath(3),
            publicKeyX: "0xabc",
          },
        },
        status,
      ),
    );
    expect(
      root.querySelector<HTMLElement>(".ledger-signer-line [data-copy]")?.dataset["copy"],
    ).toBe(address);
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
    // The counterparty now sits in the row's expansion as a <code> with its
    // control beside it, which is the shared affordance.
    expect(root.querySelector(".disclosure-body code")?.textContent).toBe(
      accountLabel(COUNTERPARTY),
    );
    expect(root.querySelector<HTMLElement>(".disclosure-body [data-copy]")?.dataset["copy"]).toBe(
      COUNTERPARTY,
    );
    expectEveryTruncatedIdentifierCopyable(root, 1);
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

  test("full addresses in an approval's exact parameters", () => {
    const context = {
      accountId: account.id,
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN" as const,
      payloadDigest: `sha256:${"a".repeat(64)}`,
    };
    const invoke: PendingApproval = {
      callReviews: [{ calldata: ["0x1"], contractAddress: TOKEN, entrypoint: "transfer" }],
      context,
      id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff16",
      kind: "invoke",
      origin: "https://dapp.example",
    };
    const privateInvoke: PendingApproval = {
      actionReviews: [
        { amount: "0x5", token: TOKEN, type: "deposit" },
        { amount: "0x1", recipient: COUNTERPARTY, token: TOKEN, type: "transfer" },
        { calldata: ["0x1"], contract: SPENDER, type: "invoke" },
        {
          calls: [{ calldata: ["0x1"], contract_address: SPENDER, entry_point: "transfer" }],
          collect_policy: { type: "all" },
          dapp_name: "Example",
          nonce: "0x7",
          type: "subaccount_invoke",
        },
      ],
      context,
      id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff17",
      kind: "strk20-invoke",
      origin: "https://dapp.example",
      relayFeeAction: { amount: "0x1", recipient: COUNTERPARTY, token: TOKEN, type: "withdraw" },
    };
    for (const [approval, expected] of [
      [invoke, 1],
      [privateInvoke, 7],
    ] as const) {
      const root = mount(approvalCard(approval, status));
      const full = Array.from(root.querySelectorAll(".request-detail dd > code")).filter((code) =>
        [TOKEN, SPENDER, COUNTERPARTY].includes(code.textContent ?? ""),
      );
      expect(full.length).toBe(expected);
      for (const code of full) {
        const control = code.parentElement?.querySelector<HTMLElement>("[data-copy]");
        expect(control?.dataset["copy"]).toBe(code.textContent ?? "");
      }
      expectEveryTruncatedIdentifierCopyable(root, 0);
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
  test("re-binding a root never makes one click copy twice", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });
    const root = mount(
      `<section class="section">${inlineCopyButton(SPENDER, "Copy spender address")}</section>`,
    );
    // A sub-region re-binds its whole root on every pass (the multisig funding
    // review binds its form on each check), after the shell has bound it once.
    bindCopyButtons(root);
    bindCopyButtons(root);
    bindCopyButtons(root);
    root.querySelector<HTMLButtonElement>("[data-copy]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(copied).toEqual([SPENDER]);
  });

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
