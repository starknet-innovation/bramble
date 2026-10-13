/**
 * The reviewed recipient is shown truncated, so the review fact carries a copy
 * control for the full canonical address. The review summary is painted after
 * the shell's copy binding ran, so the transfer renderer binds it itself —
 * exactly once, with the shared clipboard feedback.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { accountLabel } from "../../../../src/sidepanel/shared/parts";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  paint,
  TRANSFER_RECIPIENT as RECIPIENT,
  setTransferField as setField,
  submitTransferForm as submit,
  transferPreferences,
  transferPublicBalance,
  walletStatus,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;
// The composed recipient is canonicalised as it leaves the form; that spelling
// is what the background signs, so it is the one the control copies.
const CANONICAL = canonicalFelt(RECIPIENT) ?? RECIPIENT;

beforeEach(() => {
  document.body.replaceChildren();
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
});

const review = async (): Promise<HTMLElement> => {
  const { app, deps } = mount();
  bindTransfer(deps);
  setField(app, "recipient", RECIPIENT);
  setField(app, "amount", "1");
  submit(app);
  await flush();
  return app;
};

describe("send review recipient copy", () => {
  test("shows the recipient truncated and copies it in full", async () => {
    const app = await review();
    const fact = app
      .querySelector("#send-review-summary [data-copy]")
      ?.closest(".send-review-address");
    const code = fact?.querySelector("code");
    const copy = fact?.querySelector<HTMLButtonElement>("[data-copy]");

    expect(CANONICAL).not.toBe(RECIPIENT);
    expect(code?.textContent).toBe(accountLabel(CANONICAL));
    expect(code?.textContent).not.toBe(CANONICAL);
    expect(code?.getAttribute("title")).toBe(CANONICAL);
    expect(copy?.dataset["copy"]).toBe(CANONICAL);
    expect(copy?.getAttribute("aria-label")).toBe("Copy recipient address");
    expect(copy?.classList.contains("copy-inline")).toBe(true);
    // Never nested inside another control.
    expect(copy?.closest("button:not([data-copy]), a")).toBeNull();
  });

  test("names the reviewed network and reveals each full address in place", async () => {
    const app = await review();
    const summary = app.querySelector<HTMLElement>("#send-review-summary");
    const form = app.querySelector<HTMLFormElement>("#transfer-form");
    if (!summary || !form) throw new Error("review summary missing");
    const sender = form.dataset["sender"] ?? "";

    // The network the transfer travels on is named beside the parties.
    expect([...summary.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([
      "From",
      "To",
      "Network",
      "Amount",
    ]);
    expect(
      [...summary.querySelectorAll("dt")].find((dt) => dt.textContent === "Network")
        ?.nextElementSibling?.textContent,
    ).toBe("Starknet Mainnet");

    // Each party's complete address is one disclosure away, keyboard reachable.
    expect(sender).not.toBe("");
    const reveals = [...summary.querySelectorAll<HTMLDetailsElement>(".address-reveal")];
    expect(reveals.map((entry) => entry.querySelector("summary")?.textContent)).toEqual([
      "Show full sender address",
      "Show full recipient address",
    ]);
    expect(reveals[0]?.querySelector("code")?.textContent).toBe(sender);
    expect(reveals[1]?.querySelector("code")?.textContent).toBe(CANONICAL);
    // Closed by default: the confirm face still reads as a summary first.
    expect(reveals.every((entry) => entry.open === false)).toBe(true);
  });

  test("writes the full address to the clipboard once and confirms", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });
    const app = await review();
    const copy = app.querySelector<HTMLButtonElement>("#send-review-summary [data-copy]");
    if (!copy) throw new Error("copy control missing");

    // This suite runs timers immediately, so the toast is dismissed as soon as
    // it lands; record what was shown rather than what remains.
    const shown: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const node of records.flatMap((record) => [...record.addedNodes])) {
        if (node instanceof HTMLElement && node.matches(".toast.success")) {
          shown.push(node.querySelector(".toast-text")?.textContent ?? "");
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    copy.click();
    await flush();
    observer.disconnect();

    expect(copied).toEqual([CANONICAL]);
    // The screen's result line is an error alert, so feedback goes to one
    // success toast rather than showing "Copied" in the danger tone.
    expect(app.querySelector("#transfer-result")?.textContent).toBe("");
    expect(shown).toEqual(["Copied"]);
    // The working stage is a live-region container in the same section; the
    // feedback must never have replaced its markup.
    expect(app.querySelector("#send-working-title")?.textContent).toBe("Sending your transaction…");
  });

  test("a network change mid-review discards the review rather than leaving a stale network", async () => {
    const { app, deps } = mount();
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");
    submit(app);
    await flush();

    const networkFact = (): string | null | undefined =>
      [...(app.querySelectorAll("#send-review-summary dt") ?? [])].find(
        (dt) => dt.textContent === "Network",
      )?.nextElementSibling?.textContent;

    // The reviewed transfer names the network it travels on, read from the
    // form, which is what keeps it aligned with the fields the review holds.
    expect(networkFact()).toBe("Starknet Mainnet");

    // A network change repaints the panel, so the form (and its label) and the
    // account id it carries are rebuilt for the new network. The reviewed
    // account no longer matches, so the journey resets instead of keeping a
    // review whose label would now describe a different network.
    const sepoliaAccount: DerivedAccountRef = {
      ...account,
      id: `SN_SEPOLIA:${account.address}`,
      networkId: "SN_SEPOLIA",
    };
    const sepoliaStatus: WalletStatus = {
      ...walletStatus,
      accounts: [sepoliaAccount],
      activeAccountId: sepoliaAccount.id,
      network: "Starknet Sepolia",
      networkId: "SN_SEPOLIA",
      networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
    };
    const sepoliaPreferences: WalletPreferences = {
      ...transferPreferences,
      activeNetworkId: "SN_SEPOLIA",
      tokens: transferPreferences.tokens.map((token) => ({
        ...token,
        id: token.id.replace("SN_MAIN", "SN_SEPOLIA"),
        networkId: "SN_SEPOLIA",
      })),
    };
    paint(
      app,
      sendFlow(sepoliaStatus, sepoliaAccount, sepoliaPreferences, [transferPublicBalance]),
    );
    expect(app.querySelector("#transfer-form")?.getAttribute("data-send-network-label")).toBe(
      "Starknet Sepolia",
    );
    bindTransfer(deps);
    await flush();

    expect(app.querySelector("#send-review-summary")?.innerHTML ?? "").toBe("");
    expect(networkFact()).toBeUndefined();
  });
});
