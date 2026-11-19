/**
 * The Ready key notice: shown only for an affected account that has not
 * dismissed it, states the consequence once, offers Move funds (Send) before
 * the key backup (reveal), and hides per account once dismissed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { account, secondAccount } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { homeScreen } from "../../../../src/sidepanel/journeys/portfolio/home-view";
import {
  type ReadyKeyNoticeInput,
  readyKeyNotice,
} from "../../../../src/sidepanel/journeys/portfolio/ready-key-notice";
import { bindReadyKeyNotice } from "../../../../src/sidepanel/journeys/portfolio/ready-key-notice-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const affected: ReadyKeyNoticeInput = {
  accountId: account.id,
  affected: true,
  canMoveFunds: true,
  dismissed: false,
};

describe("Ready key notice", () => {
  test("renders nothing for an unaffected account or a dismissed notice", () => {
    expect(readyKeyNotice({ ...affected, affected: false })).toBe("");
    expect(readyKeyNotice({ ...affected, dismissed: true })).toBe("");
  });

  test("states the consequence, moves funds first, then backs up the key", () => {
    const markup = readyKeyNotice(affected);
    expect(markup).toContain("Back up this account's key");
    expect(markup).toContain(
      "Restoring your phrase won't find this account. Keep its private key, or move its funds to another account.",
    );
    const move = markup.indexOf(">Move funds</button>");
    expect(move).toBeGreaterThan(-1);
    expect(move).toBeLessThan(markup.indexOf(">Back up key</button>"));
    expect(markup).toMatch(/<button type="button" data-view="send">Move funds<\/button>/);
    expect(markup).toMatch(
      /<button class="secondary" type="button" data-view="reveal">Back up key<\/button>/,
    );
    expect(markup).toContain(`data-account-id="${account.id}"`);
    expect(markup).toContain(">Don't show again</button>");
  });

  test("a read-only account is offered only the key backup", () => {
    const markup = readyKeyNotice({ ...affected, canMoveFunds: false });
    expect(markup).not.toContain("Move funds");
    expect(markup).toContain(">Back up key</button>");
    expect(markup).toContain(">Don't show again</button>");
  });

  test("escapes the account id on the dismiss control", () => {
    expect(readyKeyNotice({ ...affected, accountId: '"><b>' })).not.toContain('"><b>');
  });
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (fails: boolean) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  document.body.append(app);
  app.innerHTML = readyKeyNotice(affected);
  const writes: unknown[] = [];
  const renders: unknown[] = [];
  bindReadyKeyNotice({
    app,
    render: async (status, reason) => {
      renders.push([status, reason]);
    },
    wallet: {
      loadStatus: async () => ({ unlocked: true }) as never,
      setDisplay: async (input) => {
        writes.push(input);
        if (fails) throw new Error("storage unavailable");
      },
    },
  });
  const hide = app.querySelector<HTMLButtonElement>("#ready-key-notice-hide");
  if (!hide) throw new Error("dismiss control missing");
  return { app, hide, renders, writes };
};

describe("bindReadyKeyNotice", () => {
  test("Don't show again dismisses the named account and re-renders Home", async () => {
    const { hide, renders, writes } = mount(false);
    hide.click();
    await tick();
    await tick();
    expect(writes).toEqual([{ readyKeyNoticeDismissed: account.id }]);
    expect(renders).toEqual([[{ unlocked: true }, "action"]]);
  });

  test("a failed write keeps the notice and re-enables the control", async () => {
    const { app, hide, renders, writes } = mount(true);
    hide.click();
    await tick();
    await tick();
    expect(writes).toHaveLength(1);
    expect(renders).toHaveLength(0);
    expect(hide.disabled).toBe(false);
    expect(app.querySelector("[data-ready-key-notice]")).not.toBeNull();
  });

  test("does nothing when the notice is not on screen", () => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    const writes: unknown[] = [];
    bindReadyKeyNotice({
      app,
      render: async () => {},
      wallet: {
        loadStatus: async () => ({}) as never,
        setDisplay: async (input) => {
          writes.push(input);
        },
      },
    });
    expect(writes).toHaveLength(0);
  });
});

describe("Home Ready key notice", () => {
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
  const render = (
    active: typeof account,
    dismissed: readonly string[],
    signability: Parameters<typeof homeScreen>[10],
  ) =>
    homeScreen(
      { ...status, activeAccountId: active.id },
      active,
      { balances: [] },
      0,
      true,
      { ...defaultWalletPreferences(), readyKeyNoticeDismissedIds: dismissed },
      {},
      {},
      "usd",
      { error: null, loading: false, value: null },
      signability,
    );
  const flagged = { preFixReadyKey: true as const, readOnly: false as const };

  test("a dismissed account hides its notice while another affected account keeps it", () => {
    expect(render(account, [account.id], flagged)).not.toContain("data-ready-key-notice");
    const other = render(secondAccount, [account.id], flagged);
    expect(other).toContain("data-ready-key-notice");
    expect(other).toContain(`data-account-id="${secondAccount.id}"`);
  });

  test("an unaffected account never shows it", () => {
    expect(render(account, [], { readOnly: false })).not.toContain("data-ready-key-notice");
    expect(render(account, [], null)).not.toContain("data-ready-key-notice");
  });

  test("a read-only affected account gets the notice without Move funds", () => {
    const markup = render(account, [], {
      preFixReadyKey: true,
      readOnly: true,
      reason: "guardian",
    });
    expect(markup).toContain("data-ready-key-notice");
    expect(markup).not.toContain("Move funds");
  });
});
