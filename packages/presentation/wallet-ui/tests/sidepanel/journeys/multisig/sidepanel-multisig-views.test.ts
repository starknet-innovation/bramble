/**
 * Multisig screen templates: settings entry, list/add/deploy affordances,
 * detail lifecycle actions, and the declare-first deploy gate.
 */
import { describe, expect, test } from "bun:test";
import type { MultisigProposalRecord, MultisigRecord } from "@mc-wallet/multisig/repository";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { MultisigClassState } from "../../../../src/popup/responses/multisig-responses";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
  multisigWatchFlow,
} from "../../../../src/sidepanel/journeys/multisig/multisig-management-views";
import {
  multisigDeployFlow,
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "../../../../src/sidepanel/journeys/multisig/multisig-views";

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
  confirmedBySigner: true,
  confirmedBySignerAddress: account.address,
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
  declared: MultisigClassState | "error" | null = null,
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
    view === "home" ? null : multisig.id,
    declared,
  );

describe("multisig views", () => {
  test("Add account separates new deployment from verified existing membership", () => {
    const html = render("multisig-add");
    expect(html).toBe(multisigAddFlow(status, account));
    expect(html).toContain("Create a new multisig");
    expect(html).toContain('data-view="multisig-deploy"');
    expect(html).toContain("Add an existing multisig");
    expect(html).toContain('data-view="multisig-watch"');
    expect(html).toContain("does not change its signers");
  });

  test("settings links to the multisigs screen", () => {
    expect(render("settings")).toContain('data-view="security"');
    expect(render("security")).toContain('data-view="multisigs"');
  });

  test("shows multisigs as first-class identities in account management", () => {
    const html = render("account");
    expect(html).toContain(`data-multisig-open="${multisig.id}"`);
    expect(html).toContain("Treasury");
    expect(html).toContain("Multisig · 2 of 2 signers");
    expect(html).toContain('class="option-avatar"');
    expect(html).toContain(`data-multisig-open="${multisig.id}" type="button" aria-pressed="true"`);
    expect(html).toContain(`data-account-id="${account.id}" type="button" aria-pressed="false"`);
    expect(html).toContain("Current signer");
  });

  test("lists watched multisigs with focused watch and deploy entries", () => {
    const html = render("multisigs");
    expect(html).toContain("Treasury");
    expect(html).toContain("2 of 2 signers");
    expect(html).toContain(`data-multisig-open="${multisig.id}"`);
    expect(html).toContain('data-view="multisig-watch"');
    expect(html).toContain('data-view="multisig-deploy"');
    expect(multisigWatchFlow(status, account)).toContain('id="multisig-add-form"');
    expect(html).toContain("data-nav-back");
  });

  test("surfaces shared accounts in the account drawer and opens a dedicated home", () => {
    const drawer = render("home", [multisig], [proposal]);
    expect(drawer).not.toContain("Shared accounts");
    expect(drawer).toContain("Multisig · 2 of 2 signers required · 1 open");
    expect(drawer).toContain(`data-multisig-select="${multisig.id}"`);
    expect(drawer).toContain(
      `data-multisig-select="${multisig.id}" type="button" aria-pressed="false"`,
    );

    const home = render("multisig-home", [multisig], [proposal]);
    expect(home).toContain('id="account-trigger"');
    expect(home).toContain("Treasury");
    expect(home).toContain("Multisig 2 of 2");
    expect(home).toContain('class="avatar"');
    expect(home).toContain('class="drawer-root"');
    expect(home).toContain(
      `data-multisig-select="${multisig.id}" type="button" aria-pressed="true"`,
    );
    expect(home).toContain(
      `data-active-signer="true" data-selected-multisig-signer="true" type="button" aria-pressed="false"`,
    );
    expect(home).not.toContain("data-nav-back");
    expect(home).toContain('data-view="multisig-home"');
    expect(home).toContain('aria-label="Wallet screens"');
    expect(home).toContain('id="wallet-screen-multisig-home"');
    expect(home).toContain('class="hero multisig-portfolio-hero"');
    expect(home).toContain(">Tokens</button>");
    expect(home).toContain(">Collectibles</button>");
    expect(home).toContain("Proposals<span");
    expect(home).not.toContain("Join MC Terminal");
    expect(home).not.toContain("Copy multisig address");
    expect(home).not.toContain('id="multisig-refresh"');
    expect(home).not.toContain("Synced from chain");
    expect(home).toContain('data-view="multisig-propose"');
    expect(home).toContain('data-view="multisig-receive"');
    expect(home).toContain('data-ms-home-tab="proposals"');
  });

  test("retains shared identity through Activity and Settings dock navigation", () => {
    const activity = render("activity");
    expect(activity).toContain("Treasury");
    expect(activity).toContain(`data-activity-account-id="${multisig.id}"`);
    expect(activity).toContain('data-view="multisig-home"');
    expect(activity).toContain('aria-label="Home"');

    const settings = render("settings");
    expect(settings).toContain("Multisig 2 of 2");
    expect(settings).toContain('data-view="multisig-home"');
    expect(settings).toContain('aria-label="Settings"');
  });

  test("detail shows lifecycle actions and routes signer and tracking tasks", () => {
    const html = render("multisig-detail", [multisig], [proposal]);
    expect(html).toContain("Pay vendor");
    expect(html).toContain("Ready to execute");
    expect(html).toContain("This proposal will");
    expect(html).toContain("Call details");
    expect(html).toContain("Verify elsewhere");
    expect(html).toContain(`data-ms-confirm-open="${proposal.id}"`);
    expect(html).toContain(`data-ms-execute="${proposal.id}"`);
    expect(html).toContain(`data-ms-signer-id="${account.id}"`);
    expect(html).toContain('class="allowance-row proposal-row"');
    expect(html).toContain('class="proposal-actions"');
    expect(html).toContain('class="proposal-head"');
    expect(html).toMatch(
      /data-ms-action-allowed="false"[^>]*data-ms-confirm-open="[^"]+"[^>]*disabled/,
    );
    expect(html).toMatch(/data-ms-revoke="[^"]+"[^>]*data-ms-action-allowed="true"/);
    expect(html).not.toContain("data-ms-requires-ack");
    expect(html).toContain('data-view="multisig-signers"');
    expect(html).toContain('data-view="multisig-track"');
    const signers = multisigSignersFlow(status, account, multisig);
    expect(signers).toContain(account.address);
    expect(signers).toContain(`data-multisig-remove="${multisig.id}"`);
    expect(multisigTrackFlow(status, multisig)).toContain('id="multisig-track-form"');
    expect(html).toContain('data-view="multisig-propose"');
    expect(html).not.toContain(`data-multisig-remove="${multisig.id}"`);
  });

  test("receive encodes the shared address and stale management routes fail visibly", () => {
    const receive = multisigReceiveFlow(status, multisig);
    expect(receive).toContain("QR code for multisig address");
    expect(receive).toContain("Copy multisig address");
    expect(receive).toContain("2-of-2 approval rule");
    expect(receive).toContain('class="stack receive-address-view"');
    expect(receive).toContain('class="qr-card"');
    expect(receive).not.toContain('class="section receive-card"');

    expect(multisigReceiveFlow(status, null)).toContain("no longer watched");
    expect(multisigSignersFlow(status, account, null)).toContain("no longer watched");
    expect(multisigTrackFlow(status, null)).toContain("no longer watched");
  });

  test("gates confirmation actions from fresh signer-specific chain state", () => {
    const pending = {
      ...proposal,
      confirmations: 0,
      confirmedBySigner: false,
      state: "pending" as const,
    };
    const allowed = render("multisig-detail", [multisig], [pending]);
    expect(allowed).toMatch(/data-ms-action-allowed="true"[^>]*data-ms-confirm-open="[^"]+"/);
    expect(allowed).toMatch(
      /data-ms-revoke="[^"]+"[^>]*data-ms-action-allowed="false"[^>]*disabled/,
    );

    const foreign = { ...multisig, signers: [multisig.signers[1] ?? "0x4"] };
    const blocked = render("multisig-detail", [foreign], [{ ...pending, multisigId: foreign.id }]);
    expect(blocked.match(/data-ms-action-allowed="false"/g)).toHaveLength(2);

    const staleSignerSnapshot = render(
      "multisig-detail",
      [multisig],
      [{ ...pending, confirmedBySignerAddress: multisig.signers[1] ?? "0x4" }],
    );
    expect(staleSignerSnapshot).toMatch(
      /data-ms-action-allowed="true"[^>]*data-ms-confirm-open="[^"]+"/,
    );
  });

  test("detail hides execute for proposals tracked by id only", () => {
    const html = render("multisig-detail", [multisig], [{ ...proposal, call: null }]);
    expect(html).not.toContain("data-ms-execute");
    expect(html).toContain("Execute from the proposing wallet");
    expect(html).toContain("data-ms-requires-ack");
    expect(html).toContain("data-ms-ack");
    expect(html).toContain("does not include its call");
  });

  test("executed proposals render without lifecycle actions", () => {
    const html = render("multisig-detail", [multisig], [{ ...proposal, state: "executed" }]);
    expect(html).not.toContain("data-ms-confirm");
    expect(html).toContain("Executed");
  });

  test("propose screen renders the single-call form", () => {
    const html = render("multisig-propose");
    expect(html).toContain('id="multisig-propose-form"');
    expect(html).toContain("Who should receive it?");
    expect(html).toContain("Build an advanced contract call");
    expect(html).toContain("Proposal options");
    expect(html).toContain("Choose a token and amount");
    expect(html).toContain("Proposal signer");
    expect(html).toContain(`data-signer-account-id="${account.id}"`);
  });

  test("enables proposing when an owned signer is not the active portfolio account", () => {
    const nonSigner: AccountRef = {
      ...account,
      address: "0x777",
      derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" },
      id: "SN_MAIN:0x777",
      publicKeyX: "0x778",
      publicKeyY: "0x779",
    };
    const inactiveSignerStatus: WalletStatus = {
      ...status,
      accountCount: 2,
      accounts: [nonSigner, account],
      activeAccountId: nonSigner.id,
    };
    const home = multisigDetailFlow(
      inactiveSignerStatus,
      nonSigner,
      multisig,
      [],
      false,
      null,
      null,
      "multisig-home",
    );
    expect(home).toMatch(/data-view="multisig-propose"(?![^>]*disabled)/);
    const propose = multisigProposeFlow(inactiveSignerStatus, multisig);
    expect(propose).toContain(`data-signer-account-id="${account.id}"`);
    expect(propose).not.toContain("does not own a current signer");
  });

  test("deploy screen gates on the declared class", () => {
    const gated = render("multisig-deploy", [], [], {
      declarationPending: false,
      declared: false,
    });
    expect(gated).toContain('id="multisig-declare"');
    expect(gated).toContain("disabled");
    const ready = render("multisig-deploy", [], [], {
      declarationPending: false,
      declared: true,
    });
    expect(ready).not.toContain('id="multisig-declare"');
    expect(ready).toContain('id="multisig-deploy-form"');
    // Deploy is enabled once the class is confirmed declared.
    expect(ready).not.toContain("disabled");
  });

  test("deploy screen offers a retry and stays disabled when status errors", () => {
    const errored = render("multisig-deploy", [], [], "error");
    expect(errored).toContain('id="multisig-class-retry"');
    expect(errored).not.toContain("Checking whether");
    expect(errored).not.toContain('id="multisig-declare"');
    // The truthy "error" string must not slip past the enable check.
    expect(errored).toContain("disabled");
  });

  test("deploy screen preserves a pending declaration across refreshes", () => {
    const pending = render("multisig-deploy", [], [], {
      declarationPending: true,
      declared: false,
      transactionHash: "0xdec",
    });
    expect(pending).toContain("Declaration in progress");
    expect(pending).toContain("Waiting for confirmation");
    expect(pending).toContain("0xdec");
    expect(pending).not.toContain('id="multisig-declare"');
    expect(pending).toContain("disabled");
  });

  test("deploy screen shows the loading state before the status resolves", () => {
    const loading = render("multisig-deploy", [], [], null);
    expect(loading).toContain("Checking whether");
    expect(loading).toContain("disabled");
    expect(loading).not.toContain('id="multisig-class-retry"');
  });

  test("deploy form no longer collects a name", () => {
    expect(
      render("multisig-deploy", [], [], { declarationPending: false, declared: true }),
    ).not.toContain('name="name"');
  });

  test("deploy explains the missing-account state instead of showing a silent disabled form", () => {
    const noAccount = { ...status, accountCount: 0, accounts: [], activeAccountId: null };
    const html = multisigDeployFlow(noAccount, null, {
      declarationPending: false,
      declared: true,
    });
    expect(html).toContain("No account on Starknet");
    expect(html).not.toContain('id="multisig-deploy-form"');
  });

  test("list and detail render an explicit retry instead of false empty state on load errors", () => {
    const list = multisigsFlow(status, account, [], [], true, "background-unavailable");
    expect(list).toContain("MC-MS-REGISTRY");
    expect(list).toContain('id="multisig-list-retry"');
    const detail = multisigDetailFlow(status, account, null, [], true, "background-unavailable");
    expect(detail).toContain("wallet background could not load");
    expect(detail).not.toContain("no longer watched");
  });

  test("distinguishes config, proposal status, and bounded discovery health", () => {
    expect(
      multisigDetailFlow(status, account, multisig, [], false, "configuration-unavailable"),
    ).toContain("MC-MS-CONFIG-RPC");
    expect(
      multisigDetailFlow(status, account, multisig, [], false, "proposal-refresh-incomplete"),
    ).toContain("MC-MS-PROPOSALS-RPC");
    const recent = multisigDetailFlow(
      status,
      account,
      multisig,
      [],
      false,
      "proposal-discovery-recent",
    );
    expect(recent).toContain("About proposal search coverage");
    expect(recent).toContain("To review an older proposal, add its proposal id.");
    expect(recent).not.toContain("Account state is current");
    expect(recent).not.toContain("Cached data may be stale");
  });
});
