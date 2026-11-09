/**
 * Recovering a read-only QSB vault's deposits, and releasing a recovered one,
 * under happy-dom through the journey. A read-only QSB vault offers Recover
 * deposits (the main action while it shows none), behind a step that says it
 * is outside custody conformance before anything is sent; the recovery runs
 * once and its reply is the QSB vault read again. A recovered deposit whose
 * withdrawal is ready offers Review; any other unknown deposit still says
 * Unavailable. Its release review carries a second warning above the
 * unverified one, and only such a review sends `emergency: true`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
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
import { qsbPanel } from "../../../support/qsb-panel";
import {
  DIGEST,
  depositedVault,
  reading,
  recoveredVault,
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
const accountStep = (panel: Panel) => shownStep(panel.app(), "data-qsb-account-step");
const releaseStep = (panel: Panel) => shownStep(panel.app(), "data-qsb-release-step");
const row = (panel: Panel, v: number) => find(panel, `[data-qsb-vault="${v}"]`);

const RECOVER_WARNING =
  "Outside custody conformance: Bramble cannot know whether another install already released keys for these deposits. Recover only if the install that created this QSB vault is gone.";

// Opens QSB vault `account` showing `vaults`.
const opened = async (
  script: QsbScript,
  account: (typeof QSB_VIEWS)[keyof typeof QSB_VIEWS] = QSB_VIEWS.readOnly,
): Promise<Panel> => {
  const panel = qsbPanel({ list: { resolve: [account] }, ...script });
  panel.journey.openAccount(account.id);
  await flush();
  return panel;
};

describe("Recover deposits", () => {
  test("is a read-only QSB vault's main action while it shows no deposits", async () => {
    const empty = await opened({ vaults: { resolve: reading([]) } });
    const control = find<HTMLButtonElement>(empty, "#qsb-recover-open");
    expect(control?.textContent).toBe("Recover deposits");
    expect(control?.classList.contains("secondary")).toBe(false);
    const listed = await opened({ vaults: { resolve: reading([recoveredVault(0, "none")]) } });
    expect(find(listed, "#qsb-recover-open")?.classList.contains("secondary")).toBe(true);
    for (const account of [QSB_VIEWS.ready, QSB_VIEWS.backupNeeded, QSB_VIEWS.historyUnavailable]) {
      const other = await opened({ vaults: { resolve: reading([]) } }, account);
      expect(find(other, "#qsb-recover-open")).toBe(null);
    }
  });

  test("says it is outside custody conformance before anything is sent; Cancel goes back", async () => {
    const panel = await opened({ vaults: { resolve: reading([]) } });
    find<HTMLButtonElement>(panel, "#qsb-recover-open")?.click();
    expect(accountStep(panel)).toBe("recover");
    const section = find(panel, '[data-qsb-account-step="recover"]');
    expect(section?.querySelector("h2")?.textContent).toBe("Recover deposits");
    const warning = section?.querySelector(".qsb-binding-warning");
    expect(warning?.getAttribute("role")).toBe("note");
    expect(text(warning)).toBe(RECOVER_WARNING);
    expect(panel.calls.recover).toEqual([]);
    find<HTMLButtonElement>(panel, "#qsb-recover-cancel")?.click();
    expect(accountStep(panel)).toBe("detail");
    expect(panel.calls.recover).toEqual([]);
  });

  test("recovers once, shows Recovering…, and returns to the QSB vault read again", async () => {
    const recovered = deferred<ReturnType<typeof reading>>();
    const panel = await opened({
      recover: { wait: recovered.promise },
      vaults: { resolve: reading([]) },
    });
    find<HTMLButtonElement>(panel, "#qsb-recover-open")?.click();
    find<HTMLButtonElement>(panel, "#qsb-recover-start")?.click();
    find<HTMLButtonElement>(panel, "#qsb-recover-start")?.click();
    await flush();
    expect(accountStep(panel)).toBe("recovering");
    expect(text(find(panel, '[data-qsb-account-step="recovering"]'))).toBe("Recovering…");
    expect(panel.calls.recover).toEqual(["qsb-3"]);
    recovered.resolve(reading([recoveredVault(0, "ready"), recoveredVault(1, "none")]));
    await flush();
    expect(accountStep(panel)).toBe("detail");
    expect(text(row(panel, 0))).toBe(
      "Deposit 1 Ready to release 0.00100000 BTC 4a5e1e…a33b Review",
    );
    expect(text(row(panel, 1))).toBe("Deposit 2 Unavailable 0.00100000 BTC 4a5e1e…a33b");
  });

  test("a refusal lands as its line on the QSB vault screen", async () => {
    const panel = await opened({
      recover: { reject: new Error(QSB_VAULT_REFUSALS.recoveryNotNeeded) },
      vaults: { resolve: reading([]) },
    });
    find<HTMLButtonElement>(panel, "#qsb-recover-open")?.click();
    find<HTMLButtonElement>(panel, "#qsb-recover-start")?.click();
    await flush();
    expect(accountStep(panel)).toBe("detail");
    expect(find(panel, "#qsb-vault-result")?.textContent).toBe(
      "This QSB vault's deposits don't need recovering.",
    );
  });
});

describe("recovered deposits", () => {
  test("a read-only QSB vault reviews only a recovered withdrawal; the writer never an unknown one", async () => {
    const vaults = [
      recoveredVault(0, "ready"),
      recoveredVault(1, "submitted"),
      depositedVault(2, "confirmed"),
    ];
    const readOnly = await opened({ vaults: { resolve: reading(vaults) } });
    expect(find(readOnly, '[data-qsb-review="0"]')?.textContent).toBe("Review");
    expect(text(row(readOnly, 1))).toContain("Withdrawal sent");
    expect(find(readOnly, "[data-qsb-withdraw]")).toBe(null);
    const writer = await opened(
      { vaults: { resolve: reading([recoveredVault(0, "ready"), withdrawingVault(1, "ready")]) } },
      QSB_VIEWS.ready,
    );
    expect(find(writer, '[data-qsb-review="0"]')).toBe(null);
    expect(find(writer, '[data-qsb-review="1"]')).not.toBe(null);
  });
});

describe("the emergency release review", () => {
  const review = async (custody: "conformant" | "emergency") => {
    const account = custody === "emergency" ? QSB_VIEWS.readOnly : QSB_VIEWS.ready;
    const vault =
      custody === "emergency" ? recoveredVault(0, "ready") : withdrawingVault(0, "ready");
    const panel = await opened(
      {
        release: { resolve: withdrawalResult(0, "submitted") },
        vaults: { resolve: reading([vault]) },
        withdrawalReview: { resolve: withdrawalReview(0, custody) },
      },
      account,
    );
    find<HTMLButtonElement>(panel, '[data-qsb-review="0"]')?.click();
    await flush();
    return panel;
  };

  test("states it is outside custody conformance above the unverified warning", async () => {
    const panel = await review("emergency");
    expect(releaseStep(panel)).toBe("review");
    const custody = find<HTMLElement>(panel, "#qsb-custody-warning");
    expect(custody?.hidden).toBe(false);
    expect(text(custody)).toBe(
      "Outside custody conformance: Bramble cannot confirm that no other install released keys for this deposit.",
    );
    expect(custody?.nextElementSibling?.id).toBe("qsb-binding-warning");
    expect(custody?.parentElement?.firstElementChild).toBe(custody ?? null);
    expect(
      find<HTMLButtonElement>(panel, '#qsb-release-form button[type="submit"]')?.textContent,
    ).toBe("Release and send");
  });

  test("only an emergency review sends emergency: true", async () => {
    for (const custody of ["emergency", "conformant"] as const) {
      const panel = await review(custody);
      expect(find<HTMLElement>(panel, "#qsb-custody-warning")?.hidden).toBe(
        custody !== "emergency",
      );
      typeInto(find<HTMLInputElement>(panel, 'input[name="walletPassphrase"]'), "correct horse");
      submitForm(find<HTMLFormElement>(panel, "#qsb-release-form"));
      await flush();
      const id = custody === "emergency" ? "qsb-3" : "qsb-2";
      expect(panel.calls.release).toEqual([
        [id, 0, DIGEST, "correct horse", custody === "emergency"],
      ]);
    }
  });
});
