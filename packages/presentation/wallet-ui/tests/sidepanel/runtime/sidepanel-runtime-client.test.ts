/**
 * Side-panel runtime message client (part 1 — lifecycle, approvals, secrets,
 * activity, tokens/preferences): exercises the wallet-method wrappers on
 * createSidepanelRuntime. Each method sends a typed request over the injected
 * RuntimeApi and parses the reply through its isXResponse guard — so these
 * tests drive both the request envelope it builds and the two arms of every
 * wrapper: the happy path (a canned valid response shape, mirrored from
 * tests/popup/popup-responses.test.ts) and the failure path (an error envelope or a
 * shape that fails the guard). No DOM is needed; the runtime is a plain fake.
 * Shared fixtures live in tests/support/runtime-client-fixtures.ts; the
 * remaining wrappers are covered in sidepanel-runtime-client-assets.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createSidepanelRuntime, emptyStatus } from "../../../src/sidepanel/runtime/runtime";
import { unavailableStatus } from "../../../src/sidepanel/runtime/runtime-status";
import {
  APPROVAL_ID,
  account,
  accountsResponse,
  activityEntry,
  captureRuntime,
  classHashResponse,
  connectedSitesResponse,
  createAccountResponse,
  deploymentStatusResponse,
  detectTokensResponse,
  errorEnvelope,
  generateMnemonicResponse,
  pendingApprovalsResponse,
  preferencesResponse,
  revealSecretsResponse,
  runtimeReturning,
  transferResponse,
} from "../../support/runtime-client-fixtures";

describe("createSidepanelRuntime — emptyStatus and no-runtime fallback", () => {
  test("emptyStatus is a locked, account-less mainnet shell", () => {
    const status = emptyStatus();
    expect(status.locked).toBe(true);
    expect(status.ready).toBe(false);
    expect(status.accountCount).toBe(0);
    expect(status.accounts).toEqual([]);
    expect(status.activeAccountId).toBeNull();
    expect(status.network).toBe("Unavailable");
  });

  test("loadStatus falls back to the unavailable status when no runtime is injected", async () => {
    // sendMessage resolves undefined (runtime?.sendMessage short-circuits), so
    // every guard fails and the fallbacks fire. An unanswered status read is a
    // fault, not evidence of a fresh browser: it must not paint the first-run
    // screen (MCW-V09-126).
    const wallet = createSidepanelRuntime();
    expect(await wallet.loadStatus()).toEqual(unavailableStatus());
    expect((await wallet.loadStatus()).hasVault).toBe(true);
    expect(await wallet.loadBalances()).toEqual({ error: "balances unavailable" });
    expect(await wallet.connectedSites()).toEqual([]);
    await expect(wallet.generateMnemonic()).rejects.toThrow("wallet unavailable");
  });
});

describe("account lifecycle wrappers", () => {
  test("addAccount returns the created account id and sends the network", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    expect(await wallet.addAccount("SN_SEPOLIA", "openzeppelin")).toBe(account.id);
    expect(sent[0]).toEqual({
      accountContractType: "openzeppelin",
      networkId: "SN_SEPOLIA",
      type: "wallet.addAccount",
    });
  });

  test("addAccount throws on an error envelope", async () => {
    await expect(
      runtimeReturning(errorEnvelope).addAccount("SN_MAIN", "openzeppelin"),
    ).rejects.toThrow("boom");
  });

  test("addAccount throws its fallback when the reply is unrecognised", async () => {
    await expect(
      runtimeReturning({ ok: true }).addAccount("SN_MAIN", "openzeppelin"),
    ).rejects.toThrow("add account failed");
  });

  test("importAccount returns the imported id and carries the raw key only in the request", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    expect(await wallet.importAccount("SN_SEPOLIA", "0xdeadbeef", "openzeppelin")).toBe(account.id);
    expect(sent[0]).toEqual({
      accountContractType: "openzeppelin",
      networkId: "SN_SEPOLIA",
      privateKey: "0xdeadbeef",
      type: "wallet.importAccount",
    });
  });

  test("importAccount throws on failure", async () => {
    await expect(
      runtimeReturning(errorEnvelope).importAccount("SN_MAIN", "0x1", "openzeppelin"),
    ).rejects.toThrow("boom");
  });

  test("createAccount resolves void on success and forwards the vault passphrase", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    await expect(
      wallet.createAccount("seed words", "SN_SEPOLIA", "pass", "openzeppelin"),
    ).resolves.toBeUndefined();
    expect(sent[0]).toEqual({
      accountContractType: "openzeppelin",
      mnemonic: "seed words",
      networkId: "SN_SEPOLIA",
      type: "wallet.createAccount",
      vaultPassphrase: "pass",
    });
  });

  test("createAccount throws 'wallet unavailable' when the reply fails the guard", async () => {
    await expect(
      runtimeReturning({}).createAccount("s", "SN_MAIN", "p", "openzeppelin"),
    ).rejects.toThrow("wallet unavailable");
  });

  test("previewAccount returns public metadata and pins the first derivation index", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    await expect(
      wallet.previewAccount("seed words", "SN_SEPOLIA", "openzeppelin"),
    ).resolves.toEqual(account);
    expect(sent[0]).toEqual({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      mnemonic: "seed words",
      networkId: "SN_SEPOLIA",
      type: "wallet.previewAccount",
    });
    await expect(
      runtimeReturning({}).previewAccount("seed", "SN_MAIN", "openzeppelin"),
    ).rejects.toThrow("account preview unavailable");
  });

  test("discovers and restores an exact confirmed recovery selection", async () => {
    const discovery = {
      candidates: [{ account, deployed: true, funded: false }],
      complete: false,
      nextIndex: 4,
      ok: true as const,
    };
    const discovered = captureRuntime(discovery);
    await expect(
      discovered.wallet.discoverRecoveryAccounts("seed words", "SN_SEPOLIA", 12),
    ).resolves.toEqual(discovery);
    expect(discovered.sent[0]).toEqual({
      manualIndex: 12,
      mnemonic: "seed words",
      networkId: "SN_SEPOLIA",
      type: "wallet.discoverRecoveryAccounts",
    });

    const restored = captureRuntime({ accounts: [account], ok: true });
    const selections = [{ accountContractType: "openzeppelin" as const, accountIndex: 0 }];
    await expect(
      restored.wallet.recoverAccounts("seed words", "SN_SEPOLIA", "pass", selections),
    ).resolves.toEqual([account]);
    expect(restored.sent[0]).toEqual({
      mnemonic: "seed words",
      networkId: "SN_SEPOLIA",
      selections,
      type: "wallet.recoverAccounts",
      vaultPassphrase: "pass",
    });
    await expect(runtimeReturning({}).discoverRecoveryAccounts("seed", "SN_MAIN")).rejects.toThrow(
      "account discovery unavailable",
    );
  });

  test("rejects account replies outside the requested network or contract", async () => {
    const wallet = runtimeReturning(createAccountResponse);
    await expect(wallet.addAccount("SN_MAIN", "openzeppelin")).rejects.toThrow(
      "add account failed",
    );
    await expect(
      wallet.createAccount("seed words", "SN_SEPOLIA", "pass", "argent"),
    ).rejects.toThrow("wallet unavailable");
    await expect(wallet.importAccount("SN_MAIN", "0xdeadbeef", "openzeppelin")).rejects.toThrow(
      "import account failed",
    );
    await expect(wallet.previewAccount("seed words", "SN_SEPOLIA", "argent")).rejects.toThrow(
      "account preview unavailable",
    );
  });

  test("setActiveAccount resolves on a create-account echo and throws otherwise", async () => {
    await expect(
      runtimeReturning(createAccountResponse).setActiveAccount(account.id),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning(errorEnvelope).setActiveAccount(account.id)).rejects.toThrow(
      "boom",
    );
  });

  test("setAccountLabel resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).setAccountLabel(account.id, "Main"),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).setAccountLabel(account.id, "Main")).rejects.toThrow(
      "label update failed",
    );
  });
});

describe("deployment and class-hash verification", () => {
  test("deployAccount returns the transaction hash", async () => {
    expect(await runtimeReturning(transferResponse).deployAccount()).toBe("0x123");
  });

  test("deployAccount throws on failure", async () => {
    await expect(runtimeReturning(errorEnvelope).deployAccount()).rejects.toThrow("boom");
  });

  test("loadDeploymentStatus returns the parsed response or null", async () => {
    expect(await runtimeReturning(deploymentStatusResponse).loadDeploymentStatus()).toEqual(
      deploymentStatusResponse,
    );
    expect(await runtimeReturning(errorEnvelope).loadDeploymentStatus()).toBeNull();
  });

  test("loadClassHashVerification returns the full response or null", async () => {
    expect(await runtimeReturning(classHashResponse).loadClassHashVerification()).toEqual(
      classHashResponse,
    );
    expect(await runtimeReturning({ ok: true }).loadClassHashVerification()).toBeNull();
  });
});

describe("approvals and connected sites", () => {
  test("decideApproval approves via approveOrigin", async () => {
    const { sent, wallet } = captureRuntime(accountsResponse);
    await expect(wallet.decideApproval(APPROVAL_ID, true)).resolves.toBeUndefined();
    expect(sent[0]).toEqual({ id: APPROVAL_ID, type: "wallet.approveOrigin" });
  });

  // The reviewed figure the card was painting travels with the approval, so the
  // background can hold the submission to it and refuse if its own copy moved
  // after the paint. A denial commits to no fee, so it carries none.
  test("decideApproval carries the card's reviewed fee on an approval only", async () => {
    const reviewedFee = { overallFee: "1000", unit: "FRI" } as const;
    const approving = captureRuntime(accountsResponse);
    await expect(
      approving.wallet.decideApproval(APPROVAL_ID, true, reviewedFee),
    ).resolves.toBeUndefined();
    expect(approving.sent[0]).toEqual({
      id: APPROVAL_ID,
      reviewedFee,
      type: "wallet.approveOrigin",
    });

    const denying = captureRuntime(pendingApprovalsResponse);
    await expect(
      denying.wallet.decideApproval(APPROVAL_ID, false, reviewedFee),
    ).resolves.toBeUndefined();
    expect(denying.sent[0]).toEqual({ id: APPROVAL_ID, type: "wallet.denyOrigin" });
  });

  test("decideApproval denies via denyOrigin and accepts a pending-list echo", async () => {
    const { sent, wallet } = captureRuntime(pendingApprovalsResponse);
    await expect(wallet.decideApproval(APPROVAL_ID, false)).resolves.toBeUndefined();
    expect(sent[0]).toEqual({ id: APPROVAL_ID, type: "wallet.denyOrigin" });
  });

  test("decideApproval throws when neither accounts nor pending shape returns", async () => {
    await expect(runtimeReturning(errorEnvelope).decideApproval(APPROVAL_ID, true)).rejects.toThrow(
      "boom",
    );
  });

  test("connectedSites returns the sites, or [] when the guard fails", async () => {
    expect(await runtimeReturning(connectedSitesResponse).connectedSites()).toEqual(
      connectedSitesResponse.sites,
    );
    expect(await runtimeReturning(errorEnvelope).connectedSites()).toEqual([]);
  });

  test("revokeOrigin returns the remaining sites and throws on failure", async () => {
    expect(
      await runtimeReturning(connectedSitesResponse).revokeOrigin("https://example.com"),
    ).toEqual(connectedSitesResponse.sites);
    await expect(runtimeReturning({}).revokeOrigin("https://x.com")).rejects.toThrow(
      "revoke failed",
    );
  });

  test("loadPendingApprovals returns pending or []", async () => {
    expect(await runtimeReturning(pendingApprovalsResponse).loadPendingApprovals()).toEqual(
      pendingApprovalsResponse.pending,
    );
    expect(await runtimeReturning({}).loadPendingApprovals()).toEqual([]);
  });
});

describe("secret and mnemonic flows", () => {
  test("generateMnemonic returns the phrase and throws otherwise", async () => {
    expect(await runtimeReturning(generateMnemonicResponse).generateMnemonic()).toBe(
      generateMnemonicResponse.mnemonic,
    );
    await expect(runtimeReturning({}).generateMnemonic()).rejects.toThrow("wallet unavailable");
  });

  test("validateMnemonic returns the Krusty verdict and throws otherwise", async () => {
    const { sent, wallet } = captureRuntime({ ok: true, valid: true });
    await expect(wallet.validateMnemonic("seed words")).resolves.toBe(true);
    expect(sent[0]).toEqual({ mnemonic: "seed words", type: "wallet.validateMnemonic" });
    await expect(
      runtimeReturning({ ok: true, valid: false }).validateMnemonic("bad"),
    ).resolves.toBe(false);
    await expect(runtimeReturning({}).validateMnemonic("seed")).rejects.toThrow(
      "mnemonic validation unavailable",
    );
  });

  test("revealSecrets returns the whole reveal response and throws on failure", async () => {
    const { sent, wallet } = captureRuntime(revealSecretsResponse);
    expect(await wallet.revealSecrets("pass")).toEqual(revealSecretsResponse);
    expect(sent[0]).toEqual({ type: "wallet.revealSecrets", vaultPassphrase: "pass" });
    await expect(runtimeReturning({}).revealSecrets("pass")).rejects.toThrow("reveal failed");
  });
});

describe("activity feed", () => {
  test("loadActivity surfaces entries and the historyUnavailable flag", async () => {
    expect(
      await runtimeReturning({
        activity: [activityEntry],
        historyUnavailable: true,
        ok: true,
      }).loadActivity(),
    ).toEqual({ entries: [activityEntry], historyUnavailable: true });
  });

  test("loadActivity carries an explicit shared-account scope", async () => {
    const { sent, wallet } = captureRuntime({ activity: [activityEntry], ok: true });
    await wallet.loadActivity("SN_MAIN:0x999");
    expect(sent[0]).toEqual({ accountId: "SN_MAIN:0x999", type: "wallet.activity" });
  });

  test("loadActivity can force an explicit history refresh", async () => {
    const { sent, wallet } = captureRuntime({ activity: [activityEntry], ok: true });
    await wallet.loadActivity(undefined, false, true, true);
    expect(sent[0]).toEqual({ forceHistory: true, refreshHistory: true, type: "wallet.activity" });
  });

  test("loadActivity defaults historyUnavailable to false when omitted", async () => {
    expect(await runtimeReturning({ activity: [activityEntry], ok: true }).loadActivity()).toEqual({
      entries: [activityEntry],
      historyUnavailable: false,
    });
  });

  test("loadActivity returns an empty, non-degraded feed when the guard fails", async () => {
    expect(await runtimeReturning(errorEnvelope).loadActivity()).toEqual({
      entries: [],
      historyUnavailable: false,
    });
  });
});

describe("token and preference wrappers", () => {
  test("addToken resolves on preferences and throws otherwise", async () => {
    const { sent, wallet } = captureRuntime(preferencesResponse);
    await expect(wallet.addToken("0x49d3657")).resolves.toBeUndefined();
    expect(sent[0]).toEqual({ address: "0x49d3657", type: "wallet.addToken" });
    await expect(runtimeReturning({}).addToken("0x1")).rejects.toThrow("add token failed");
  });

  test("setTokenHidden resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).setTokenHidden("SN_MAIN:0x1", true),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).setTokenHidden("SN_MAIN:0x1", true)).rejects.toThrow(
      "token visibility update failed",
    );
  });

  test("detectTokens returns the suggestions and throws on failure", async () => {
    expect(await runtimeReturning(detectTokensResponse).detectTokens()).toEqual(
      detectTokensResponse.suggestions,
    );
    await expect(runtimeReturning({}).detectTokens()).rejects.toThrow("token detection failed");
  });

  test("loadPreferences returns preferences and throws when unavailable", async () => {
    expect(await runtimeReturning(preferencesResponse).loadPreferences()).toEqual(
      preferencesResponse.preferences,
    );
    await expect(runtimeReturning({}).loadPreferences()).rejects.toThrow("preferences unavailable");
  });

  test("importPreferences resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).importPreferences({}),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({ ok: false }).importPreferences({})).rejects.toThrow(
      "backup import failed",
    );
  });

  test("setDisplay forwards the display input and resolves", async () => {
    const { sent, wallet } = captureRuntime(preferencesResponse);
    await expect(
      wallet.setDisplay({
        approvalSurface: "popup",
        displayCurrency: "eur",
        reliabilityDiagnostics: true,
        theme: "dark",
      }),
    ).resolves.toBeUndefined();
    expect(sent[0]).toEqual({
      approvalSurface: "popup",
      displayCurrency: "eur",
      reliabilityDiagnostics: true,
      theme: "dark",
      type: "wallet.setDisplay",
    });
    await expect(runtimeReturning({}).setDisplay({ theme: "light" })).rejects.toThrow(
      "display update failed",
    );
  });

  test("loadDiagnostics accepts only the sanitized report shape", async () => {
    const diagnostics = {
      accountCount: 2,
      collectionEnabled: true,
      explorer: [{ count: 1, latencyMs: 30, outcome: "ok", service: "starkscan" }],
      hasVault: true,
      locked: false,
      networkId: "SN_MAIN",
      ready: true,
      rpc: [{ count: 3, endpoint: "wallet-gateway", latencyMs: 42, outcome: "ok" }],
    } as const;
    await expect(runtimeReturning({ diagnostics, ok: true }).loadDiagnostics()).resolves.toEqual(
      diagnostics,
    );
    await expect(
      runtimeReturning({
        diagnostics: { ...diagnostics, address: "0x123" },
        ok: true,
      }).loadDiagnostics(),
    ).rejects.toThrow("diagnostic export failed");
  });

  test("setRpcOverride resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).setRpcOverride("SN_MAIN", "https://rpc.example"),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).setRpcOverride("SN_MAIN", "https://x")).rejects.toThrow(
      "rpc endpoint update failed",
    );
  });

  test("setStrk20NetworkConfig resolves on preferences and throws otherwise", async () => {
    const config = {
      discoveryUrl: "https://discovery.example",
      poolAddress: "0x1",
      proverUrl: "https://prover.example",
      subaccountAnonymizerAddress: "0x2",
    };
    await expect(
      runtimeReturning(preferencesResponse).setStrk20NetworkConfig("SN_MAIN", config),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).setStrk20NetworkConfig("SN_MAIN", config)).rejects.toThrow(
      "privacy service configuration failed",
    );
  });

  test("setNftIndexerUrl resolves on preferences and throws otherwise", async () => {
    await expect(
      runtimeReturning(preferencesResponse).setNftIndexerUrl("https://idx"),
    ).resolves.toBeUndefined();
    await expect(runtimeReturning({}).setNftIndexerUrl("https://idx")).rejects.toThrow(
      "indexer endpoint update failed",
    );
  });
});
