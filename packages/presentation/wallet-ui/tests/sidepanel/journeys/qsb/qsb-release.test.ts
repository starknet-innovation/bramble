/**
 * Releasing a found QSB withdrawal under happy-dom, through the journey: the
 * review shows what the BIP requires (network, deposit, the 15 one-time keys,
 * the full destination, what it receives, the fee and size) under a prominent
 * unverified-binding warning; a review that disagrees with the deposit's own
 * withdrawal offers no release; the wallet passphrase is read once and
 * cleared on submit, on leaving and on repaint; the review's digest is what
 * goes out, once however often it is asked; and each outcome lands where it
 * should.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  deferred,
  flush,
  QSB_VIEWS,
  type QsbScript,
  shownStep,
  submitForm,
  typeInto,
} from "../../../support/qsb-harness";
import { qsbPanel, scriptedPermissions } from "../../../support/qsb-panel";
import {
  DESTINATION,
  DIGEST,
  QSB_ADDRESS,
  reading,
  WITHDRAWAL_TXID,
  withdrawalResult,
  withdrawalReview,
  withdrawingVault,
} from "../../../support/qsb-vault-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

type Panel = ReturnType<typeof qsbPanel>;

const text = (node: Element | null | undefined): string => {
  if (!node) return "";
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const value = next.textContent?.replace(/\s+/g, " ").trim();
    if (value) parts.push(value);
  }
  return parts.join(" ");
};
const find = <T extends Element>(panel: Panel, selector: string): T | null =>
  panel.app().querySelector<T>(selector);
const step = (panel: Panel): string | null => shownStep(panel.app(), "data-qsb-release-step");
const field = (panel: Panel) => find<HTMLInputElement>(panel, 'input[name="walletPassphrase"]');
const releaseButton = (panel: Panel) =>
  find<HTMLButtonElement>(panel, '#qsb-release-form button[type="submit"]');

// Opens the release review of deposit 4 (v 3) of QSB vault 2 from its row.
const release = async (script: QsbScript, granted = true): Promise<Panel> => {
  const panel = qsbPanel(
    {
      list: { resolve: [QSB_VIEWS.ready] },
      vaults: { resolve: reading([withdrawingVault(3, "ready")]) },
      withdrawalReview: { resolve: withdrawalReview(3) },
      ...script,
    },
    scriptedPermissions({ answer: true, granted }),
  );
  panel.journey.openAccount("qsb-2");
  await flush();
  find<HTMLButtonElement>(panel, '[data-qsb-review="3"]')?.click();
  await flush();
  return panel;
};
const send = (panel: Panel, typed = "correct horse battery"): void => {
  typeInto(field(panel), typed);
  submitForm(find<HTMLFormElement>(panel, "#qsb-release-form"));
};

describe("the release review", () => {
  test("states what the BIP requires, under a prominent unverified-binding warning", async () => {
    const panel = await release({});
    expect(panel.visited).toEqual(["qsb-account", "qsb-release"]);
    expect(step(panel)).toBe("review");
    expect(panel.calls.withdrawalReview).toEqual([["qsb-2", 3]]);
    expect(find(panel, "#qsb-release-vault")?.textContent).toBe("QSB vault 2 · Deposit 4");
    // Both inputs the release spends, as the Withdraw summary summed them.
    expect(text(find(panel, "#qsb-release-review"))).toBe(
      "Network Bitcoin mainnet Releases 15 one-time keys Deposit 0.00100000 BTC " +
        "From your balance + 0.00010000 BTC Network fee − 0.00000900 BTC " +
        `You receive 0.00109100 BTC To ${DESTINATION} Size 1180 vB`,
    );
    const warning = find(panel, "#qsb-binding-warning");
    expect(text(warning)).toBe(
      "Unverified: Bramble cannot independently confirm that these 15 keys allow only this withdrawal.",
    );
    // Prominent: first shown in the review, in the warning style, never a hint.
    // Only the custody warning of an emergency review may sit above it, and
    // the writer's review hides that one.
    expect(warning?.classList.contains("qsb-binding-warning")).toBe(true);
    const custody = warning?.previousElementSibling as HTMLElement | null | undefined;
    expect([custody?.id, custody?.hidden]).toEqual(["qsb-custody-warning", true]);
    expect(custody?.previousElementSibling ?? null).toBe(null);
    expect(text(find(panel, '[data-qsb-release-step="review"]'))).not.toMatch(
      /verified signature/i,
    );
    expect(field(panel)?.closest("label")?.querySelector("span")?.textContent).toBe(
      "Wallet passphrase",
    );
    expect(field(panel)?.type).toBe("password");
    expect(releaseButton(panel)?.disabled).toBe(true);
    typeInto(field(panel), "x");
    expect(releaseButton(panel)?.disabled).toBe(false);
  });

  test("a review that disagrees with the deposit's withdrawal offers no release", async () => {
    for (const review of [
      { ...withdrawalReview(3), destination: QSB_ADDRESS },
      { ...withdrawalReview(3), feeSat: 1_000, outputSat: 109_000 },
    ]) {
      const panel = await release({ withdrawalReview: { resolve: review } });
      expect(step(panel)).toBe("unavailable");
      expect(find(panel, "#qsb-release-error")?.textContent).toBe(
        "This withdrawal doesn't check out, so Bramble released nothing.",
      );
      expect(find<HTMLButtonElement>(panel, "#qsb-release-retry")?.hidden).toBe(true);
    }
  });

  test("a withdrawal that isn't ready, or a grant not given, says so", async () => {
    const searching = qsbPanel({
      list: { resolve: [QSB_VIEWS.ready] },
      vaults: { resolve: reading([withdrawingVault(3, "searching")]) },
    });
    searching.journey.openRelease("qsb-2", 3);
    await flush();
    expect(find(searching, "#qsb-release-error")?.textContent).toBe(
      "This withdrawal isn't ready to release yet.",
    );
    expect(searching.calls.withdrawalReview).toEqual([]);
    const ungranted = qsbPanel(
      {
        list: { resolve: [QSB_VIEWS.ready] },
        vaults: { resolve: reading([withdrawingVault(3, "ready")]) },
        withdrawalReview: { resolve: withdrawalReview(3) },
      },
      scriptedPermissions({ granted: false }),
    );
    ungranted.journey.openRelease("qsb-2", 3);
    await flush();
    expect(find(ungranted, "#qsb-release-error")?.textContent).toBe(
      "Bramble needs access to the QSB service.",
    );
    find<HTMLButtonElement>(ungranted, "#qsb-release-allow")?.click();
    expect(ungranted.permissions.asked).toHaveLength(1);
    await flush();
    await flush();
    expect(step(ungranted)).toBe("review");
  });
});

describe("releasing", () => {
  test("sends the review's digest and the typed passphrase once, clearing the field", async () => {
    const released = deferred<ReturnType<typeof withdrawalResult>>();
    const panel = await release({ release: { wait: released.promise } });
    send(panel, "correct horse battery");
    expect(field(panel)?.value).toBe("");
    send(panel, "a second try");
    expect(step(panel)).toBe("sending");
    // Leaving and coming back reattaches to the same release.
    panel.paint("qsb-release");
    expect(step(panel)).toBe("sending");
    expect(panel.calls.release).toEqual([["qsb-2", 3, DIGEST, "correct horse battery", false]]);
    released.resolve(withdrawalResult(3, "submitted"));
    await flush();
    expect(step(panel)).toBe("outcome");
    expect(text(find(panel, "#qsb-release-title"))).toBe("Withdrawal sent");
    expect(text(find(panel, "#qsb-release-line"))).toBe("It shows as withdrawn once it's mined.");
    const link = find<HTMLAnchorElement>(panel, "#qsb-release-tx");
    expect(link?.hidden).toBe(false);
    expect(link?.getAttribute("href")).toBe(`https://mempool.space/tx/${WITHDRAWAL_TXID}`);
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(find<HTMLButtonElement>(panel, "#qsb-release-resend")?.hidden).toBe(true);
  });

  test("the passphrase is cleared on leaving and on repaint", async () => {
    const panel = await release({});
    const typed = field(panel);
    typeInto(typed, "half typed");
    panel.journey.bind(null);
    expect(typed?.value).toBe("");
    const again = await release({});
    const second = field(again);
    typeInto(second, "half typed");
    again.paint("qsb-release");
    expect(second?.value).toBe("");
  });

  test("not confirmed yet offers Resend, which resends the same withdrawal", async () => {
    const panel = await release({ release: { resolve: withdrawalResult(3, "uncertain") } });
    send(panel);
    await flush();
    expect(text(find(panel, "#qsb-release-title"))).toBe("Not confirmed yet");
    expect(text(find(panel, "#qsb-release-line"))).toBe("Resend sends the same withdrawal again.");
    panel.script.withdrawalResend = { resolve: withdrawalResult(3, "confirmed") };
    find<HTMLButtonElement>(panel, "#qsb-release-resend")?.click();
    await flush();
    expect(panel.calls.withdrawalResend).toEqual([["qsb-2", 3]]);
    expect(text(find(panel, "#qsb-release-title"))).toBe("Withdrawn");
  });

  test("a conflict says the deposit was spent elsewhere, and offers no Resend", async () => {
    const panel = await release({ release: { resolve: withdrawalResult(3, "conflict") } });
    send(panel);
    await flush();
    expect(text(find(panel, "#qsb-release-title"))).toBe("Spent elsewhere");
    expect(text(find(panel, "#qsb-release-line"))).toBe("Another transaction spent this deposit.");
    expect(find<HTMLButtonElement>(panel, "#qsb-release-resend")?.hidden).toBe(true);
  });

  test("a changed review is fetched again and shown again", async () => {
    const panel = await release({
      release: { reject: new Error(QSB_WITHDRAWAL_REFUSALS.reviewChanged) },
    });
    send(panel);
    await flush();
    await flush();
    expect(panel.calls.withdrawalReview).toHaveLength(2);
    expect(step(panel)).toBe("review");
    expect(find(panel, "#qsb-release-result")?.textContent).toBe(
      "The withdrawal changed. Review it again.",
    );
    expect(field(panel)?.value).toBe("");
  });

  test("a refusal released nothing and keeps the review; a lost reply is status unknown", async () => {
    const refused = await release({ release: { reject: new Error("passphrase is wrong") } });
    send(refused);
    await flush();
    expect(step(refused)).toBe("review");
    expect(find(refused, "#qsb-release-result")?.classList.contains("is-invalid")).toBe(true);
    expect(field(refused)?.value).toBe("");
    const lost = await release({ release: { reject: new SubmissionUnknownError("lost", null) } });
    send(lost);
    await flush();
    expect(step(lost)).toBe("outcome");
    expect(text(find(lost, "#qsb-release-title"))).toBe("Withdrawal status unknown");
    expect(text(find(lost, "#qsb-release-line"))).toBe(
      "Bramble couldn't confirm this finished. Refresh before trying again.",
    );
    expect(find<HTMLButtonElement>(lost, "#qsb-release-resend")?.hidden).toBe(true);
  });

  test("a grant withdrawn since the review is asked for in the Release click", async () => {
    const panel = await release({
      release: { reject: new Error("qsb coordinator access not granted") },
    });
    send(panel);
    await flush();
    expect(find(panel, "#qsb-release-result")?.textContent).toBe(
      "Allow Bramble to reach the QSB service to continue.",
    );
    panel.permissions.state.answer = false;
    send(panel);
    expect(panel.permissions.asked).toHaveLength(1);
    await flush();
    expect(panel.calls.release).toHaveLength(1);
  });
});
