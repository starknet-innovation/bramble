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

  test("loadStatus falls back to emptyStatus when no runtime is injected", async () => {
    // sendMessage resolves undefined (runtime?.sendMessage short-circuits), so
    // every guard fails and the fallbacks fire.
    const wallet = createSidepanelRuntime();
    expect(await wallet.loadStatus()).toEqual(emptyStatus());
    expect(await wallet.loadBalances()).toEqual({ error: "balances unavailable" });
    expect(await wallet.connectedSites()).toEqual([]);
    await expect(wallet.generateMnemonic()).rejects.toThrow("wallet unavailable");
  });
});

describe("account lifecycle wrappers", () => {
  test("addAccount returns the created account id and sends the network", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    expect(await wallet.addAccount("SN_MAIN")).toBe(account.id);
    expect(sent[0]).toEqual({ networkId: "SN_MAIN", type: "wallet.addAccount" });
  });

  test("addAccount throws on an error envelope", async () => {
    await expect(runtimeReturning(errorEnvelope).addAccount("SN_MAIN")).rejects.toThrow("boom");
  });

  test("addAccount throws its fallback when the reply is unrecognised", async () => {
    await expect(runtimeReturning({ ok: true }).addAccount("SN_MAIN")).rejects.toThrow(
      "add account failed",
    );
  });

  test("addAccount carries an explicit HD index when restoring", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    expect(await wallet.addAccount("SN_MAIN", 7)).toBe(account.id);
    // Without the index the background takes the lowest free position, which
    // would land a restored account at the wrong address.
    expect(sent[0]).toEqual({ accountIndex: 7, networkId: "SN_MAIN", type: "wallet.addAccount" });
  });

  test("scanSeedAccounts returns the candidates and carries no payload", async () => {
    const candidates = [
      {
        accountIndex: 3,
        address: "0xabc",
        alreadyAdded: false,
        deployed: true,
        funded: false,
      },
    ];
    const { sent, wallet } = captureRuntime({ candidates, ok: true });
    expect(await wallet.scanSeedAccounts()).toEqual(candidates);
    // The network and passphrase come from wallet state, so the request carries
    // nothing a caller could redirect.
    expect(sent[0]).toEqual({ type: "wallet.scanSeedAccounts" });
  });

  test("scanSeedAccounts rejects a malformed candidate rather than offering it", async () => {
    // An address that is not a field element cannot be derived, so offering to
    // restore it would produce an account the wallet cannot reach.
    await expect(
      runtimeReturning({
        candidates: [
          { accountIndex: 0, address: "nope", alreadyAdded: false, deployed: true, funded: false },
        ],
        ok: true,
      }).scanSeedAccounts(),
    ).rejects.toThrow("Could not scan for accounts");
  });

  test("scanSeedAccounts throws on an error envelope", async () => {
    await expect(runtimeReturning(errorEnvelope).scanSeedAccounts()).rejects.toThrow("boom");
  });

  test("importAccount returns the imported id and carries the raw key only in the request", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    expect(await wallet.importAccount("SN_MAIN", "0xdeadbeef")).toBe(account.id);
    expect(sent[0]).toEqual({
      networkId: "SN_MAIN",
      privateKey: "0xdeadbeef",
      type: "wallet.importAccount",
    });
  });

  test("importAccount throws on failure", async () => {
    await expect(runtimeReturning(errorEnvelope).importAccount("SN_MAIN", "0x1")).rejects.toThrow(
      "boom",
    );
  });

  test("createAccount resolves void on success and forwards the vault passphrase", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    await expect(wallet.createAccount("seed words", "SN_MAIN", "pass")).resolves.toBeUndefined();
    expect(sent[0]).toEqual({
      mnemonic: "seed words",
      networkId: "SN_MAIN",
      type: "wallet.createAccount",
      vaultPassphrase: "pass",
    });
  });

  test("createAccount throws 'wallet unavailable' when the reply fails the guard", async () => {
    await expect(runtimeReturning({}).createAccount("s", "SN_MAIN", "p")).rejects.toThrow(
      "wallet unavailable",
    );
  });

  test("previewAccount returns public metadata and pins the first derivation index", async () => {
    const { sent, wallet } = captureRuntime(createAccountResponse);
    await expect(wallet.previewAccount("seed words", "SN_SEPOLIA")).resolves.toEqual(account);
    expect(sent[0]).toEqual({
      accountIndex: 0,
      mnemonic: "seed words",
      networkId: "SN_SEPOLIA",
      type: "wallet.previewAccount",
    });
    await expect(runtimeReturning({}).previewAccount("seed", "SN_MAIN")).rejects.toThrow(
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
        theme: "dark",
      }),
    ).resolves.toBeUndefined();
    expect(sent[0]).toEqual({
      approvalSurface: "popup",
      displayCurrency: "eur",
      theme: "dark",
      type: "wallet.setDisplay",
    });
    await expect(runtimeReturning({}).setDisplay({ theme: "light" })).rejects.toThrow(
      "display update failed",
    );
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
