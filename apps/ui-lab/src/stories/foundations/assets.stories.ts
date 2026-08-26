import { expect } from "storybook/test";
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

export const Receive: LabStory = {
  args: { checkpointId: "receive", scenarioId: "assets" },
  name: "Assets · receive",
  play: async ({ canvasElement }) => {
    await assertCheckpointReady(canvasElement);
    const body =
      canvasElement.querySelector<HTMLIFrameElement>("[data-lab-frame]")?.contentDocument?.body;
    await expect(body?.querySelector(".receive-public-key")).toBeVisible();
    await expect(body?.querySelector(".receive-public-key [data-copy]")).toHaveAttribute(
      "data-copy",
    );
    await expect(body?.querySelector(".receive-public-key")).toHaveTextContent("Copy public key");
    await expect(body?.querySelector("[data-nostr-key-row]")).toBeVisible();
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
    await expect(body?.querySelector("[data-receive-qr]")).toHaveTextContent(
      "Preparing complete wallet card",
    );
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
