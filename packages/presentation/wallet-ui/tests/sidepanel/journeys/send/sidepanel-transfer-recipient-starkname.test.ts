/**
 * Send resolves a typed Starknet name to the recipient's address. A name is not
 * an address, so it is only offered to the background for resolution; the
 * address it resolves to becomes the reviewed recipient while the typed name
 * stays as the visible label. An unregistered name, a network without Starknet
 * ID, an unreachable set of endpoints, and a malformed reply each keep the
 * recipient from being committed and say so in the field's own note.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type {
  StarkNameResolutionResponse,
  WalletStatus,
} from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindTransferCompose } from "../../../../src/sidepanel/journeys/send/transfer-compose-ui";
import type { TransferStage } from "../../../../src/sidepanel/journeys/send/transfer-model";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { deferred, paint } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

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

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};

const ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const NAME = "altaga.braavos.stark";

const resolved: StarkNameResolutionResponse = {
  ok: true,
  resolution: { address: ADDRESS, status: "resolved" },
};

const mount = (
  resolveName: (name: string) => Promise<StarkNameResolutionResponse | null>,
): { form: HTMLFormElement; stages: TransferStage[]; resolvedNames: string[] } => {
  const app = document.createElement("div");
  app.id = "app";
  paint(app, sendFlow(status, account, preferences, [], {}, {}, "usd", [], null));
  document.body.append(app);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) {
    throw new Error("transfer form missing");
  }
  const stages: TransferStage[] = [];
  const resolvedNames: string[] = [];
  bindTransferCompose({
    form,
    goTo: (stage) => stages.push(stage),
    navigate: () => undefined,
    onFields: () => undefined,
    resolveName: (name) => {
      resolvedNames.push(name);
      return resolveName(name);
    },
  });
  return { form, stages, resolvedNames };
};

const type = (form: HTMLFormElement, value: string): void => {
  const field = form.querySelector<HTMLInputElement>("#send-recipient-search");
  if (!field) {
    throw new Error("search field missing");
  }
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

const clickContinue = (form: HTMLFormElement): void => {
  form.querySelector<HTMLButtonElement>("#send-recipient-continue")?.click();
};

const field = (form: HTMLFormElement, name: string): string =>
  form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";

const note = (form: HTMLFormElement): { hidden: boolean; text: string } => {
  const element = form.querySelector<HTMLElement>("#send-recipient-note");
  return { hidden: element?.hasAttribute("hidden") ?? true, text: element?.textContent ?? "" };
};

const continueDisabled = (form: HTMLFormElement): boolean =>
  form.querySelector<HTMLButtonElement>("#send-recipient-continue")?.disabled ?? false;

describe("Send resolves a typed Starknet name", () => {
  test("a well-formed name enables Continue; text that is neither address nor name does not", () => {
    const { form } = mount(async () => null);

    type(form, NAME);
    expect(continueDisabled(form)).toBe(false);

    type(form, "not a name");
    expect(continueDisabled(form)).toBe(true);

    type(form, "");
    expect(continueDisabled(form)).toBe(true);
  });

  test("commits the resolved address with the typed name as its label", async () => {
    const pending = deferred<StarkNameResolutionResponse | null>();
    const { form, stages, resolvedNames } = mount(() => pending.promise);

    type(form, NAME);
    clickContinue(form);

    // The read is in flight: the control is held and the field says so.
    expect(continueDisabled(form)).toBe(true);
    expect(note(form)).toEqual({ hidden: false, text: `Resolving ${NAME}…` });
    expect(field(form, "recipient")).toBe("");

    pending.resolve(resolved);
    await pending.promise;
    await Promise.resolve();

    expect(resolvedNames).toEqual([NAME]);
    expect(field(form, "recipient")).toBe(ADDRESS);
    expect(field(form, "recipientLabel")).toBe(NAME);
    expect(note(form).hidden).toBe(true);
    expect(stages).toEqual(["details"]);
  });

  test("Enter resolves the same way the button does", async () => {
    const { form, stages } = mount(async () => resolved);

    type(form, NAME);
    form
      .querySelector<HTMLInputElement>("#send-recipient-search")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
    await Promise.resolve();
    await Promise.resolve();

    expect(field(form, "recipient")).toBe(ADDRESS);
    expect(stages).toEqual(["details"]);
  });

  test("an unregistered name does not commit a recipient and says why", async () => {
    const { form, stages } = mount(async () => ({ ok: true, resolution: { status: "not-found" } }));

    type(form, NAME);
    clickContinue(form);
    await Promise.resolve();
    await Promise.resolve();

    expect(field(form, "recipient")).toBe("");
    expect(stages).toEqual([]);
    expect(note(form)).toEqual({ hidden: false, text: `No address found for ${NAME}.` });
    // The text is still a valid name, so the step can be retried.
    expect(continueDisabled(form)).toBe(false);
  });

  test("a transport outage says the network could not be reached", async () => {
    const { form } = mount(async () => ({ ok: true, resolution: { status: "unreachable" } }));

    type(form, NAME);
    clickContinue(form);
    await Promise.resolve();
    await Promise.resolve();

    expect(field(form, "recipient")).toBe("");
    expect(note(form).text).toBe(`Could not reach the network to resolve ${NAME}.`);
  });

  test("a network without Starknet ID says names are unavailable there", async () => {
    const { form } = mount(async () => ({
      ok: true,
      resolution: { status: "unsupported-network" },
    }));

    type(form, NAME);
    clickContinue(form);
    await Promise.resolve();
    await Promise.resolve();

    expect(field(form, "recipient")).toBe("");
    expect(note(form).text).toBe("Starknet names are not available on this network.");
  });

  test("a malformed reply fails the field rather than committing an address", async () => {
    const { form } = mount(async () => null);

    type(form, NAME);
    clickContinue(form);
    await Promise.resolve();
    await Promise.resolve();

    expect(field(form, "recipient")).toBe("");
    expect(note(form).text).toBe(`Could not resolve ${NAME}.`);
  });

  test("a typed address still commits without a name lookup", async () => {
    const { form, stages, resolvedNames } = mount(async () => resolved);

    type(form, ADDRESS);
    clickContinue(form);
    await Promise.resolve();

    expect(resolvedNames).toEqual([]);
    expect(field(form, "recipient")).toBe(ADDRESS);
    expect(stages).toEqual(["details"]);
  });

  test("a second Continue while the read is in flight does not resolve twice", async () => {
    const pending = deferred<StarkNameResolutionResponse | null>();
    const { form, resolvedNames, stages } = mount(() => pending.promise);

    type(form, NAME);
    clickContinue(form);
    clickContinue(form);

    pending.resolve(resolved);
    await pending.promise;
    await Promise.resolve();

    expect(resolvedNames).toEqual([NAME]);
    expect(stages).toEqual(["details"]);
  });

  test("a resolution that lands after the form is detached commits nothing", async () => {
    const pending = deferred<StarkNameResolutionResponse | null>();
    const { form, stages } = mount(() => pending.promise);

    type(form, NAME);
    clickContinue(form);
    // The panel repaints (or closes) while the read is in flight.
    form.remove();
    pending.resolve(resolved);
    await pending.promise;
    await Promise.resolve();

    expect(field(form, "recipient")).toBe("");
    expect(stages).toEqual([]);
  });

  test("a resolution whose text was edited since is dropped, not committed", async () => {
    const pending = deferred<StarkNameResolutionResponse | null>();
    const { form, stages } = mount(() => pending.promise);

    type(form, NAME);
    clickContinue(form);
    type(form, "other.braavos.stark");
    pending.resolve(resolved);
    await pending.promise;
    await Promise.resolve();

    expect(field(form, "recipient")).toBe("");
    expect(stages).toEqual([]);
  });
});
