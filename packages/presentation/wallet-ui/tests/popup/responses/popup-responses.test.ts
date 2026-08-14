/** Popup response validators reject malformed background data before rendering. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import {
  isAccountsResponse,
  isApprovalDecisionResponse,
  isBalancesResponse,
  isCreateAccountResponse,
  isErrorResponse,
  isGenerateMnemonicResponse,
  isPendingApprovalsResponse,
  isPreferencesResponse,
  isRevealSecretsResponse,
  isTransferResponse,
  isWalletStatus,
} from "../../../src/popup/responses/responses";

describe("popup response validators", () => {
  const approvalId = "123e4567-e89b-42d3-a456-426614174000";
  const account = {
    accountContractType: "openzeppelin" as const,
    address: "0x123",
    classHash: "0xabc",
    derivation: {
      accountIndex: 0,
      addressIndex: 0,
      kind: "starknet-bip44" as const,
    },
    id: "SN_SEPOLIA:0x123",
    networkId: "SN_SEPOLIA" as const,
    publicKeyX: "0xabc",
    publicKeyY: "0xdef",
  };
  const networks = [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }];

  test("validates wallet status shape", () => {
    const hiddenDebug = {
      accountCount: 1,
      activeAccountId: account.id,
      accounts: [account],
      hasVault: true,
      locked: false,
      network: "Starknet Sepolia",
      networkId: "SN_SEPOLIA",
      networks,
      ready: true,
    };
    Object.defineProperty(hiddenDebug, "debug", { value: true });

    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: account.id,
        accounts: [account],
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(true);
    expect(isWalletStatus({ accountCount: -1 })).toBe(false);
    expect(isWalletStatus({ accountCount: Number.NaN })).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: "not-an-account",
        accounts: [account],
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
    expect(isWalletStatus(hiddenDebug)).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 0,
        activeAccountId: account.id,
        accounts: [],
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: null,
        accounts: [account],
        hasVault: false,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: account.id,
        accounts: [account],
        debug: true,
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: null,
        accounts: [account],
        hasVault: true,
        locked: false,
        network: "",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
  });

  test("validates account and error responses", () => {
    expect(isCreateAccountResponse({ account, ok: true })).toBe(true);
    expect(isCreateAccountResponse({ account: null, ok: true })).toBe(false);
    expect(isCreateAccountResponse({ account: { ...account, address: "not-hex" }, ok: true })).toBe(
      false,
    );
    expect(
      isCreateAccountResponse({ account: { ...account, privateKey: "0x456" }, ok: true }),
    ).toBe(false);
    expect(isErrorResponse({ error: "bad passphrase" })).toBe(true);
    expect(isErrorResponse({ code: "bad", error: "bad passphrase" })).toBe(false);
    expect(isErrorResponse({ error: 1 })).toBe(false);
    expect(isErrorResponse({ error: "" })).toBe(false);
  });

  test("validates generated mnemonic responses", () => {
    const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";

    expect(isGenerateMnemonicResponse({ mnemonic, ok: true })).toBe(true);
    expect(isGenerateMnemonicResponse({ mnemonic: "too short", ok: true })).toBe(false);
    expect(isGenerateMnemonicResponse({ mnemonic, ok: false })).toBe(false);
    expect(isGenerateMnemonicResponse({ debug: true, mnemonic, ok: true })).toBe(false);
  });

  test("validates reveal-secrets responses", () => {
    const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
    const privateKey = "0x123456";

    expect(isRevealSecretsResponse({ mnemonic, ok: true, privateKey })).toBe(true);
    expect(isRevealSecretsResponse({ mnemonic: null, ok: true, privateKey })).toBe(true);
    expect(isRevealSecretsResponse({ mnemonic: "too short", ok: true, privateKey })).toBe(false);
    expect(isRevealSecretsResponse({ mnemonic, ok: true, privateKey: "nope" })).toBe(false);
    expect(isRevealSecretsResponse({ mnemonic, ok: false, privateKey })).toBe(false);
    expect(isRevealSecretsResponse({ debug: true, mnemonic, ok: true, privateKey })).toBe(false);
  });

  test("validates pending approval items before popup rendering", () => {
    const sparsePending = new Array<unknown>(1);
    const approval = { id: approvalId, kind: "connect", origin: "https://example.com" };

    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [approval],
      }),
    ).toBe(true);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ ...approval, label: "unexpected" }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [approval, { ...approval, origin: "https://other.example" }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [approval, { ...approval, id: "123e4567-e89b-42d3-a456-426614174001" }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        debug: true,
        ok: true,
        pending: [approval],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({ ok: true, pending: [{ id: approvalId, kind: "connect" }] }),
    ).toBe(false);
    expect(isPendingApprovalsResponse({ ok: true, pending: sparsePending })).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ ...approval, id: "" }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ ...approval, origin: "http://example.com" }],
      }),
    ).toBe(false);
    expect(isPendingApprovalsResponse({ ok: true, pending: [null] })).toBe(false);
  });

  test("requires an account/network/payload binding on STRK20 disclosure approvals", () => {
    const context = {
      accountId: account.id,
      chainId: "0x534e5f5345504f4c4941",
      networkId: "SN_SEPOLIA",
      payloadDigest: `sha256:${"a".repeat(64)}`,
    };
    for (const kind of [
      "strk20-balances",
      "strk20-prepare",
      "strk20-register",
      "strk20-subaccount",
    ] as const) {
      const actionReviews =
        kind === "strk20-prepare"
          ? [{ calldata: ["0x1"], contract: "0x2", type: "invoke" }]
          : undefined;
      expect(
        isPendingApprovalsResponse({
          ok: true,
          pending: [
            {
              ...(actionReviews ? { actionReviews } : {}),
              context,
              id: approvalId,
              kind,
              origin: "https://example.com",
            },
          ],
        }),
      ).toBe(true);
      expect(
        isPendingApprovalsResponse({
          ok: true,
          pending: [{ id: approvalId, kind, origin: "https://example.com" }],
        }),
      ).toBe(false);
    }
  });

  test("requires exact action parameters on STRK20 proof and invoke reviews", () => {
    const context = {
      accountId: account.id,
      chainId: "0x534e5f5345504f4c4941",
      networkId: "SN_SEPOLIA",
      payloadDigest: `sha256:${"a".repeat(64)}`,
    };
    const actionReviews = [{ calldata: ["0x1"], contract: "0x2", type: "invoke" }];
    for (const kind of ["strk20-invoke", "strk20-prepare"] as const) {
      expect(
        isPendingApprovalsResponse({
          ok: true,
          pending: [
            { actionReviews, context, id: approvalId, kind, origin: "https://example.com" },
          ],
        }),
      ).toBe(true);
      expect(
        isPendingApprovalsResponse({
          ok: true,
          pending: [{ context, id: approvalId, kind, origin: "https://example.com" }],
        }),
      ).toBe(false);
    }
  });

  test("accepts only an exact withdrawal as the private relay fee review", () => {
    const base = {
      actionReviews: [{ calldata: ["0x1"], contract: "0x2", type: "invoke" }],
      context: {
        accountId: account.id,
        chainId: "0x534e5f5345504f4c4941",
        networkId: "SN_SEPOLIA",
        payloadDigest: `sha256:${"a".repeat(64)}`,
      },
      id: approvalId,
      kind: "strk20-invoke",
      origin: "https://example.com",
    };
    const relayFeeAction = {
      amount: "0x1",
      recipient: "0x2",
      token: "0x3",
      type: "withdraw",
    };

    expect(isPendingApprovalsResponse({ ok: true, pending: [{ ...base, relayFeeAction }] })).toBe(
      true,
    );
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ ...base, relayFeeAction: { ...relayFeeAction, type: "transfer" } }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ ...base, relayFeeAction: { ...relayFeeAction, recipient: "not-a-felt" } }],
      }),
    ).toBe(false);
  });

  test("validates watch-asset pending approvals and shared-origin prompts", () => {
    const token = {
      address: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      decimals: 6,
      name: "USD Coin",
      networkId: "SN_MAIN",
      symbol: "USDC",
    };

    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ id: approvalId, kind: "watch-asset", origin: "https://example.com", token }],
      }),
    ).toBe(true);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          { id: approvalId, kind: "connect", origin: "https://example.com" },
          {
            id: "123e4567-e89b-42d3-a456-426614174001",
            kind: "watch-asset",
            origin: "https://example.com",
            token,
          },
        ],
      }),
    ).toBe(true);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ id: approvalId, kind: "watch-asset", origin: "https://example.com" }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          { id: approvalId, kind: "connect", origin: "https://example.com" },
          {
            id: "123e4567-e89b-42d3-a456-426614174001",
            kind: "connect",
            origin: "https://example.com",
          },
        ],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          {
            id: approvalId,
            kind: "watch-asset",
            origin: "https://example.com",
            token: { ...token, symbol: "bad symbol" },
          },
        ],
      }),
    ).toBe(false);
  });

  test("validates declaration review fees and rejects incomplete declaration data", () => {
    const context = {
      accountId: "SN_MAIN:0x1",
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN",
      payloadDigest: `sha256:${"a".repeat(64)}`,
    };
    const declaration = {
      abiEntryCount: 14,
      accountDeployment: "deployed",
      classHash: "0x5abc",
      compiledClassHash: "0x6def",
      deploymentFee: null,
      deploymentFeeEstimateFailed: false,
      entryPointCount: 9,
      fee: { overallFee: "2500000000000000", unit: "FRI" },
      feeEstimateFailed: false,
      sierraProgramLength: 4_321,
    };
    const pending = (review: unknown) => ({
      ok: true,
      pending: [
        {
          context,
          declaration: review,
          id: approvalId,
          kind: "declare",
          origin: "https://example.com",
        },
      ],
    });

    expect(isPendingApprovalsResponse(pending(declaration))).toBe(true);
    expect(isPendingApprovalsResponse(pending({ ...declaration, fee: null }))).toBe(false);
    expect(
      isPendingApprovalsResponse(pending({ ...declaration, fee: null, feeEstimateFailed: true })),
    ).toBe(true);
    expect(
      isPendingApprovalsResponse(
        pending({ ...declaration, fee: { overallFee: "1", unit: "ETH" } }),
      ),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ context, id: approvalId, kind: "declare", origin: "https://example.com" }],
      }),
    ).toBe(false);
  });

  test("validates approval decision responses before popup state updates", () => {
    const sparseAccounts = new Array<unknown>(1);

    expect(isAccountsResponse({ accounts: [account], ok: true })).toBe(true);
    expect(isAccountsResponse({ accounts: [account, account], ok: true })).toBe(false);
    expect(isAccountsResponse({ accounts: sparseAccounts, ok: true })).toBe(false);
    expect(isAccountsResponse({ accounts: [{ ...account, privateKey: "0x456" }], ok: true })).toBe(
      false,
    );
    expect(
      isApprovalDecisionResponse({
        ok: true,
        pending: [{ id: approvalId, origin: "https://example.com" }],
      }),
    ).toBe(true);
    expect(isApprovalDecisionResponse({ chainId: "0x534e5f4d41494e", ok: true, pending: [] })).toBe(
      true,
    );
    expect(isApprovalDecisionResponse({ chainId: "SN_MAIN", ok: true, pending: [] })).toBe(false);
    expect(isApprovalDecisionResponse({ ok: true })).toBe(false);
  });

  test("validates preferences, balance, and transfer responses", () => {
    const preferences = defaultWalletPreferences();
    const token = preferences.tokens.find((candidate) => candidate.networkId === "SN_SEPOLIA");
    if (!token) {
      throw new Error("Sepolia token fixture unavailable");
    }

    expect(isPreferencesResponse({ ok: true, preferences })).toBe(true);
    expect(isPreferencesResponse({ ok: true, preferences: { schemaVersion: 1 } })).toBe(false);
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [{ ...token, balance: "100", formatted: "0.0000000000000001" }],
        networkId: "SN_SEPOLIA",
        ok: true,
      }),
    ).toBe(true);
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [{ ...token, balance: "-1", formatted: "0" }],
        networkId: "SN_SEPOLIA",
        ok: true,
      }),
    ).toBe(false);
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [{ ...token, balance: "100", formatted: "0.0000000000000001" }],
        networkId: "SN_MAIN",
        ok: true,
      }),
    ).toBe(false);
    expect(isTransferResponse({ ok: true, transactionHash: "not-hex" })).toBe(false);
  });
});
