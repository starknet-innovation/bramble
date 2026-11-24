/**
 * Connected-sites rows expand to the accounts each site was given: every
 * vault account and multisig by the name the wallet shows elsewhere and its
 * short address, each with a Disconnect carrying exactly that id, and a
 * site-wide "Disconnect all" once there is more than one.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import { addressLabel } from "@bramble/wallet-model/networks";
import type { ConnectedSite, WalletStatus } from "../../../../src/popup/responses/responses";
import { connectedSitesFlow } from "../../../../src/sidepanel/app/screens/support-flows";
import { friendlyAccountName } from "../../../../src/sidepanel/shared/parts";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { captureRuntime, connectedSitesResponse } from "../../../support/runtime-client-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);

const ORIGIN = "https://dapp.example";
const GONE = "SN_MAIN:0x777";
const multisig: ArgentMultisigRecord = {
  accountContractType: "argent-multisig",
  address: "0x0abc",
  classHash: "0x1",
  id: "SN_MAIN:0xabc",
  name: "Treasury",
  networkId: "SN_MAIN",
};
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
const labelled = { ...preferences, accountLabels: { [account.id]: "Main <b>" } };

const site = (
  accountIds: readonly string[],
  multisigIds: readonly string[] = [],
): ConnectedSite => ({
  accountCount: accountIds.length + multisigIds.length,
  accountIds,
  multisigIds,
  origin: ORIGIN,
});

const render = (sites: readonly ConnectedSite[]): HTMLElement => {
  const host = document.createElement("div");
  host.replaceChildren(
    document
      .createRange()
      .createContextualFragment(connectedSitesFlow(status, sites, labelled, [multisig])),
  );
  return host;
};

const entries = (screen: HTMLElement) =>
  [...screen.querySelectorAll(".connected-site .disclosure-body li")].map((row) => ({
    address: row.querySelector("code")?.textContent,
    button: row.querySelector("button")?.getAttribute("aria-label"),
    id: row.querySelector("button")?.getAttribute("data-revoke-account"),
    name: row.querySelector("strong")?.textContent,
    origin: row.querySelector("button")?.getAttribute("data-revoke-origin"),
  }));

describe("connected-site account list", () => {
  test("lists each shared account by name and short address, with its own Disconnect", () => {
    const screen = render([site([account.id, secondAccount.id], [multisig.id])]);
    const second = friendlyAccountName(secondAccount.address);
    expect(entries(screen)).toEqual([
      {
        address: addressLabel(account.address),
        button: `Disconnect Main <b> from ${ORIGIN}`,
        id: account.id,
        name: "Main <b>",
        origin: ORIGIN,
      },
      {
        address: addressLabel(secondAccount.address),
        button: `Disconnect ${second} from ${ORIGIN}`,
        id: secondAccount.id,
        name: second,
        origin: ORIGIN,
      },
      {
        address: addressLabel(multisig.address),
        button: `Disconnect Treasury from ${ORIGIN}`,
        id: multisig.id,
        name: "Treasury",
        origin: ORIGIN,
      },
    ]);
    // A label is text, never markup.
    expect(screen.querySelector(".connected-site b")).toBeNull();
  });

  test("is a disclosure whose summary carries the origin and the plural count", () => {
    const screen = render([site([account.id, secondAccount.id])]);
    const details = screen.querySelector<HTMLDetailsElement>("details.connected-site");
    expect(details?.dataset["disclosure"]).toBe(`site:${ORIGIN}`);
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain(ORIGIN);
    expect(details?.querySelector("summary")?.textContent).toContain("2 accounts shared");
    expect(details?.querySelector("summary button")).toBeNull();
  });

  test("offers Disconnect all for the site once it has more than one account", () => {
    const screen = render([site([account.id], [multisig.id])]);
    const all = screen.querySelector<HTMLButtonElement>(
      ".connected-site .disclosure-body > button[data-revoke-origin]",
    );
    expect(all?.textContent).toBe("Disconnect all");
    expect(all?.getAttribute("aria-label")).toBe(`Disconnect ${ORIGIN}`);
    expect(all?.hasAttribute("data-revoke-account")).toBe(false);
  });

  test("a single-account site says so and offers only that account's Disconnect", () => {
    const screen = render([site([account.id])]);
    expect(screen.textContent).toContain("1 account shared");
    expect(screen.textContent).not.toContain("1 accounts");
    expect(screen.textContent).not.toContain("Disconnect all");
    expect(screen.querySelectorAll("[data-revoke-origin]")).toHaveLength(1);
  });

  test("an id the wallet no longer holds still shows its address and can be disconnected", () => {
    const screen = render([site([GONE], ["SN_MAIN:0xdef"])]);
    expect(entries(screen)).toEqual([
      {
        address: "0x0000…0777",
        button: `Disconnect Account no longer in this wallet from ${ORIGIN}`,
        id: GONE,
        name: "Account no longer in this wallet",
        origin: ORIGIN,
      },
      {
        address: "0x0000…0def",
        button: `Disconnect Multisig account from ${ORIGIN}`,
        id: "SN_MAIN:0xdef",
        name: "Multisig account",
        origin: ORIGIN,
      },
    ]);
  });
});

describe("disconnect request", () => {
  test("sends the account id only when disconnecting one account", async () => {
    const { sent, wallet } = captureRuntime(connectedSitesResponse);
    await wallet.revokeOrigin(ORIGIN);
    await wallet.revokeOrigin(ORIGIN, account.id);
    expect(sent).toEqual([
      { origin: ORIGIN, type: "wallet.revokeOrigin" },
      { accountId: account.id, origin: ORIGIN, type: "wallet.revokeOrigin" },
    ]);
  });
});
