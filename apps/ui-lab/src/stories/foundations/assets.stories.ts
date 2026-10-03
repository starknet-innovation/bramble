import { expect, userEvent, waitFor } from "storybook/test";
import {
  assertCheckpointReady,
  checkpointStory,
  LAB_META,
  type LabMeta,
  type LabStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "account-a", scenarioId: "activity" },
  title: "Wallet journeys/07 Activity and assets",
};

export default meta;

export const ActivityAccountA = checkpointStory("Activity · account A", "activity", "account-a");
export const ActivitySwitch = checkpointStory(
  "Activity · switch boundary",
  "activity",
  "scope-cleared",
);
export const ActivityAccountB = checkpointStory("Activity · account B", "activity", "account-b");
export const ActivityAccountARestored = checkpointStory(
  "Activity · account A restored",
  "activity",
  "account-a-restored",
);

/**
 * The feed is long enough to scroll. The title bar holds its place at the top
 * of the panel while the rows move beneath it, which is the whole point of the
 * checkpoint: assert the resting bar starts below the panel edge, then that a
 * scroll pins it at zero with the list moving under it.
 */
export const ActivityLongFeed: LabStory = {
  args: { checkpointId: "account-a-long", scenarioId: "activity" },
  name: "Activity · long feed (pinned title bar)",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const frame = canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]");
    const win = frame?.contentWindow;
    const doc = frame?.contentDocument;
    const header = doc?.querySelector<HTMLElement>(".activity-head");
    const list = doc?.querySelector<HTMLElement>(".tx-list");
    if (!win || !doc || !header || !list) throw new Error("Missing Activity feed");
    // The fixture must actually overflow, or this state would prove nothing.
    await expect(doc.documentElement.scrollHeight).toBeGreaterThan(
      doc.documentElement.clientHeight,
    );
    const restingTop = Math.round(header.getBoundingClientRect().top);
    await expect(restingTop).toBeGreaterThan(0);
    win.scrollTo(0, 240);
    await waitFor(() => expect(Math.round(header.getBoundingClientRect().top)).toBe(0));
    await expect(header).toBeVisible();
    await expect(list.getBoundingClientRect().top).toBeLessThan(restingTop);
    // Leave the surface at rest, so a snapshot shows the screen, not the scroll.
    win.scrollTo(0, 0);
  },
};

export const Receive: LabStory = {
  args: { checkpointId: "receive", scenarioId: "assets" },
  name: "Assets · receive",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    // Address first: the plain address is shown whole and is the default QR;
    // the contact card is the second, switchable payload (spec item 3).
    await expect(
      body?.querySelector(".receive-address-copy [data-receive-address-text]"),
    ).toHaveTextContent(/^0x[0-9a-f]+$/);
    await expect(body?.querySelector("[data-receive-qr]")).toHaveAttribute(
      "data-qr-payload",
      "address",
    );
    await expect(body?.querySelector("[data-receive-qr] svg")).toHaveAttribute(
      "aria-label",
      "QR code for your Starknet address",
    );
    await expect(body?.querySelector('[data-receive-payload="address"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(body?.querySelector('[data-receive-payload="card"]')).toBeEnabled();
    // The contact card, the keys, and the payload switch wait behind Advanced; the
    // QR stays on the address until the user asks for the card.
    const advanced = body?.querySelector<HTMLButtonElement>("#advanced-receive");
    if (!advanced) throw new Error("Missing receive Advanced switch");
    await expect(advanced).toHaveAttribute("aria-checked", "false");
    await expect(body?.querySelector("#receive-advanced-fields")).not.toBeVisible();
    await userEvent.click(advanced);
    await expect(body?.querySelector("#receive-advanced-fields")).toBeVisible();
    await expect(body?.querySelector(".receive-public-key [data-copy]")).toHaveAttribute(
      "data-copy",
    );
    await expect(body?.querySelector(".receive-public-key [data-copy]")).toHaveAttribute(
      "aria-label",
      "Copy signer public key",
    );
    await expect(body?.querySelector("[data-nostr-key-row]")).toBeInTheDocument();
    await expect(body?.querySelector("[data-nostr-key-row]")).toHaveTextContent(
      "Coordination public key",
    );
    await expect(body?.querySelector("[data-wallet-card-copy]")).toHaveAttribute(
      "data-copy",
      expect.stringContaining("mcw:contact:1:SN_MAIN:"),
    );
  },
};
export const ReceivePreparing: LabStory = {
  args: { checkpointId: "receive-preparing", scenarioId: "assets" },
  name: "Assets · receive preparing",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("[data-receive-wallet-card]")).toHaveAttribute(
      "data-wallet-card-state",
      "preparing",
    );
    await expect(body?.querySelector("[data-wallet-card-copy]")).toBeDisabled();
    // Preparing the card never blocks the address: its QR is already painted
    // and only the card option waits.
    await expect(body?.querySelector("[data-receive-qr] svg")).toHaveAttribute(
      "aria-label",
      "QR code for your Starknet address",
    );
    await expect(body?.querySelector('[data-receive-payload="card"]')).toBeDisabled();
  },
};
export const ReceiveAddressOnly: LabStory = {
  args: { checkpointId: "receive-address-only", scenarioId: "assets" },
  name: "Assets · receive address only",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector("[data-receive-wallet-card]")).toHaveAttribute(
      "data-wallet-card-state",
      "unavailable",
    );
    await expect(body?.querySelector("[data-wallet-card-copy]")).not.toBeVisible();
    await expect(body?.querySelector("[data-receive-payload-switch]")).not.toBeVisible();
    await expect(body?.querySelector("[data-receive-qr] svg")).toHaveAttribute(
      "aria-label",
      "QR code for your Starknet address",
    );
    await expect(body?.querySelector("[data-nostr-key-status]")).toHaveTextContent(
      "Share the account address instead",
    );
  },
};
export const Tokens = checkpointStory("Assets · tokens", "assets", "tokens");
export const AddToken = checkpointStory("Assets · add token", "assets", "token-add");
export const DiscoverTokens = checkpointStory(
  "Assets · discover tokens",
  "assets",
  "token-discover",
);
export const TokenCatalog = checkpointStory("Assets · AVNU token list", "assets", "token-catalog");
export const TokensEmpty = checkpointStory("Assets · tokens empty", "assets", "tokens-empty");
export const TokenDetail = checkpointStory("Assets · token detail", "assets", "token-detail");
export const TokenOffline = checkpointStory("Assets · token offline", "assets", "token-offline");
export const AddressBook: LabStory = {
  args: { checkpointId: "address-book", scenarioId: "assets" },
  name: "Assets · address book",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    // Label and address are the whole form; the wallet card and the keys wait
    // behind Advanced, so saving a contact never reads as a five-field task.
    const advanced = body?.querySelector<HTMLButtonElement>("#advanced-address");
    if (!advanced) throw new Error("Missing address book Advanced switch");
    await expect(body?.querySelector('input[name="address"]')).toBeVisible();
    await expect(body?.querySelector('textarea[name="walletCard"]')).not.toBeVisible();
    await userEvent.click(advanced);
    await expect(body?.querySelector('textarea[name="walletCard"]')).toBeVisible();
    await expect(body?.querySelector('input[name="nostrPublicKey"]')).toBeVisible();
    await expect(body?.querySelector(".address-book")).toHaveTextContent(
      "Secure coordination ready",
    );
  },
};
export const Allowances = checkpointStory("Assets · allowances", "assets", "allowances");
export const AllowancesEmpty = checkpointStory(
  "Assets · allowances empty",
  "assets",
  "allowances-empty",
);
