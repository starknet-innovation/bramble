/**
 * Multisig screen templates: settings entry, list/add/deploy affordances,
 * detail lifecycle actions, and the declare-first deploy gate.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { dashboard } from "../src/sidepanel/views";
import type { MultisigProposalRecord, MultisigRecord } from "../src/storage/multisig-store";
import type { AccountRef } from "../src/storage/vault-schema";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

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

const multisig: MultisigRecord = {
  address: "0x333333333333333333333333333333333333333333333333333333333333333",
  id: "SN_MAIN:0x333333333333333333333333333333333333333333333333333333333333333",
  name: "Treasury",
  networkId: "SN_MAIN",
  quorum: 2,
  signers: [account.address, "0x444444444444444444444444444444444444444444444444444444444444444"],
};

const proposal: MultisigProposalRecord = {
  call: {
    calldata: ["0x5"],
    contractAddress: "0x555555555555555555555555555555555555555555555555555555555555555",
    entrypoint: "transfer",
    salt: "0x0",
  },
  confirmations: 2,
  id: `${multisig.id}:0xabc`,
  multisigId: multisig.id,
  state: "confirmed",
  summary: "Pay vendor",
  txId: "0xabc",
};

const render = (
  view: Parameters<typeof dashboard>[0],
  multisigs: readonly MultisigRecord[] = [multisig],
  proposals: readonly MultisigProposalRecord[] = [],
  declared: boolean | null = null,
): string =>
  dashboard(
    view,
    status,
    [],
    null,
    { balances: [] },
    null,
    [],
    [],
    {},
    [],
    null,
    [],
    null,
    {},
    multisigs,
    proposals,
    multisig.id,
    declared,
  );

describe("multisig views", () => {
  test("settings links to the multisigs screen", () => {
    expect(render("settings")).toContain('data-view="multisigs"');
  });

  test("lists watched multisigs with add and deploy entries", () => {
    const html = render("multisigs");
    expect(html).toContain("Treasury");
    expect(html).toContain("2 of 2 signers");
    expect(html).toContain(`data-multisig-open="${multisig.id}"`);
    expect(html).toContain('id="multisig-add-form"');
    expect(html).toContain('data-view="multisig-deploy"');
    expect(html).toContain('data-view="settings"');
  });

  test("detail shows signers, lifecycle actions, and the track form", () => {
    const html = render("multisig-detail", [multisig], [proposal]);
    expect(html).toContain("Pay vendor");
    expect(html).toContain("Ready to execute");
    expect(html).toContain(`data-ms-confirm="${proposal.id}"`);
    expect(html).toContain(`data-ms-execute="${proposal.id}"`);
    expect(html).toContain('id="multisig-track-form"');
    expect(html).toContain('data-view="multisig-propose"');
    expect(html).toContain('data-multisig-remove="' + multisig.id + '"');
  });

  test("detail hides execute for proposals tracked by id only", () => {
    const html = render("multisig-detail", [multisig], [{ ...proposal, call: null }]);
    expect(html).not.toContain("data-ms-execute");
    expect(html).toContain("Execute from the wallet that proposed it");
  });

  test("executed proposals render without lifecycle actions", () => {
    const html = render("multisig-detail", [multisig], [{ ...proposal, state: "executed" }]);
    expect(html).not.toContain("data-ms-confirm");
    expect(html).toContain("Executed");
  });

  test("propose screen renders the single-call form", () => {
    const html = render("multisig-propose");
    expect(html).toContain('id="multisig-propose-form"');
    expect(html).toContain("different salt");
  });

  test("deploy screen gates on the declared class", () => {
    const gated = render("multisig-deploy", [], [], false);
    expect(gated).toContain('id="multisig-declare"');
    expect(gated).toContain("disabled");
    const ready = render("multisig-deploy", [], [], true);
    expect(ready).not.toContain('id="multisig-declare"');
    expect(ready).toContain('id="multisig-deploy-form"');
  });
});
