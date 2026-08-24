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
export const AddressBook = checkpointStory("Assets · address book", "assets", "address-book");
export const Allowances = checkpointStory("Assets · allowances", "assets", "allowances");
export const AllowancesEmpty = checkpointStory(
  "Assets · allowances empty",
  "assets",
  "allowances-empty",
);
