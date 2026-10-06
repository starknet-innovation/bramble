/**
 * The reviewed recipient is shown truncated, so the review fact carries a copy
 * control for the full canonical address. The review summary is painted after
 * the shell's copy binding ran, so the transfer renderer binds it itself —
 * exactly once, with the shared clipboard feedback.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { accountLabel } from "../../../../src/sidepanel/shared/parts";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  TRANSFER_RECIPIENT as RECIPIENT,
  setTransferField as setField,
  submitTransferForm as submit,
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
});

// A name-resolved recipient is the one case where the review shows the whole
// address rather than a shortened form: the name is not the thing being sent
// to, so the address it resolved to is what the reader has to check.
const reviewResolvedName = async (recipient: string, label: string): Promise<HTMLElement> => {
  const { app, deps } = mount();
  bindTransfer(deps);
  setField(app, "recipient", recipient);
  setField(app, "recipientLabel", label);
  setField(app, "recipientResolvedFrom", "stark-name");
  setField(app, "amount", "1");
  submit(app);
  await flush();
  return app;
};

describe("send review of a name-resolved recipient", () => {
  test("shows the full address, its provenance, and a new-recipient warning", async () => {
    const app = await reviewResolvedName(RECIPIENT, "stranger.braavos.stark");
    const fact = app
      .querySelector("#send-review-summary [data-copy]")
      ?.closest(".send-review-address");

    // The full canonical address, not the shortened label the other facts use.
    expect(fact?.classList.contains("send-review-address-full")).toBe(true);
    expect(fact?.querySelector("code")?.textContent).toBe(CANONICAL);
    expect(app.querySelector("#send-review-summary .send-review-source")?.textContent).toBe(
      "Resolved from Starknet ID",
    );
    // The recipient is on no row on this network, so the wallet says so.
    const risks = app.querySelector("#send-review-risks");
    expect(risks?.hasAttribute("hidden")).toBe(false);
    expect(risks?.textContent).toContain("New recipient. Check the full address before you send.");
  });

  test("shows the provenance without the warning for a recipient already listed", async () => {
    const app = await reviewResolvedName(account.address, "my own account");
    const fact = app
      .querySelector("#send-review-summary [data-copy]")
      ?.closest(".send-review-address");

    expect(fact?.querySelector("code")?.textContent).toBe(
      canonicalFelt(account.address) ?? account.address,
    );
    expect(app.querySelector("#send-review-summary .send-review-source")?.textContent).toBe(
      "Resolved from Starknet ID",
    );
    // The address is the user's own account, which the recipient screen lists,
    // so there is nothing new to warn about.
    expect(app.querySelector("#send-review-risks")?.textContent ?? "").not.toContain(
      "New recipient.",
    );
  });
});
