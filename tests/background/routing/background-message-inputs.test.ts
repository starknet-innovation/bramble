/**
 * Background message parser checks reject ambiguous runtime command shapes.
 */
import { describe, expect, test } from "bun:test";
import {
  readPreviewAccountInput,
  readValidateMnemonicInput,
} from "../../../apps/extension/src/background/accounts/account-creation-inputs";
import {
  readAddAccountInput,
  readAddInvokeTransactionInput,
  readApprovalIdInput,
  readCreateAccountInput,
  readGetGrantedAccountsInput,
  readRequestAccountsInput,
  readRevealSecretsInput,
  readRevokeOriginInput,
  readSaveAddressInput,
  readSetActiveAccountInput,
  readSetActiveNetworkInput,
  readSwitchChainInput,
  readTransferInput,
  readTypeOnlyInput,
  readUnlockInput,
} from "../../../apps/extension/src/background/routing/message-inputs";

const approvalId = "123e4567-e89b-42d3-a456-426614174000";
const accountId = "SN_SEPOLIA:0x123";
const vaultPassphrase = "correct horse battery staple";

describe("background message parsers", () => {
  test("reads exact no-payload messages", () => {
    expect(readTypeOnlyInput({ type: "wallet.status" }, "wallet.status")).toBe(true);
    expect(readTypeOnlyInput({ debug: true, type: "wallet.status" }, "wallet.status")).toBe(false);
    expect(readTypeOnlyInput({ type: "wallet.lock" }, "wallet.status")).toBe(false);
  });

  test("reject extra fields in runtime messages", () => {
    expect(
      readCreateAccountInput({
        debug: true,
        mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readGetGrantedAccountsInput({
        debug: true,
        origin: "https://example.com",
        type: "wallet.getGrantedAccounts",
      }),
    ).toBeNull();
    expect(
      readApprovalIdInput({ debug: true, id: approvalId, type: "wallet.denyOrigin" }),
    ).toBeNull();
    // The reviewed-fee echo is optional, validated by the shared fee grammar,
    // and refuses the whole decision when malformed — a dropped ceiling would be
    // an unbound submission that looks bound.
    expect(
      readApprovalIdInput({
        id: approvalId,
        reviewedFee: { overallFee: "1000", unit: "FRI" },
        type: "wallet.approveOrigin",
      }),
    ).toEqual({ id: approvalId, reviewedFee: { overallFee: "1000", unit: "FRI" } });
    expect(
      readApprovalIdInput({
        id: approvalId,
        reviewedFee: { overallFee: "1000", unit: "DOGE" },
        type: "wallet.approveOrigin",
      }),
    ).toBeNull();
    expect(readApprovalIdInput({ id: approvalId, type: "wallet.approveOrigin" })).toEqual({
      id: approvalId,
    });
    expect(
      readRequestAccountsInput({
        debug: true,
        origin: "https://example.com",
        type: "wallet.requestAccounts",
      }),
    ).toBeNull();
    expect(
      readRequestAccountsInput({
        origin: "https://example.com",
        silent: true,
        type: "wallet.requestAccounts",
      }),
    ).toEqual({ origin: "https://example.com", silent: true });
    expect(
      readSetActiveAccountInput({
        accountId,
        debug: true,
        type: "wallet.setActiveAccount",
      }),
    ).toBeNull();
    expect(
      readSetActiveNetworkInput({
        debug: true,
        networkId: "SN_MAIN",
        type: "wallet.setActiveNetwork",
      }),
    ).toBeNull();
    expect(
      readSwitchChainInput({
        chainId: "0x534e5f4d41494e",
        debug: true,
        origin: "https://example.com",
        type: "wallet.switchChain",
      }),
    ).toBeNull();
    expect(
      readTransferInput({
        accountId,
        amount: "1",
        debug: true,
        recipient: "0x456",
        tokenId: "SN_SEPOLIA:ETH:0x123",
        type: "wallet.transfer",
      }),
    ).toBeNull();
    expect(
      readAddInvokeTransactionInput({
        calls: [{ calldata: [], contractAddress: "0x123", entrypoint: "transfer" }],
        debug: true,
        origin: "https://example.com",
        type: "wallet.addInvokeTransaction",
      }),
    ).toBeNull();
    expect(readUnlockInput({ debug: true, type: "wallet.unlock", vaultPassphrase })).toBeNull();
  });

  test("reject malformed account ids before service calls", () => {
    expect(
      readCreateAccountInput({
        mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
        networkId: "toString",
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readSetActiveAccountInput({
        accountId: "not-an-account",
        type: "wallet.setActiveAccount",
      }),
    ).toBeNull();
    expect(readSetActiveAccountInput({ accountId, type: "wallet.setActiveAccount" })).toEqual({
      accountId,
    });
    expect(
      readSetActiveNetworkInput({ networkId: "SN_DEVNET", type: "wallet.setActiveNetwork" }),
    ).toEqual({
      networkId: "SN_DEVNET",
    });
    expect(
      readSetActiveNetworkInput({ networkId: "toString", type: "wallet.setActiveNetwork" }),
    ).toBeNull();
    expect(
      readSwitchChainInput({
        chainId: "0x534e5f4d41494e",
        origin: "https://example.com",
        type: "wallet.switchChain",
      }),
    ).toEqual({
      chainId: "0x534e5f4d41494e",
      origin: "https://example.com",
    });
    expect(
      readSwitchChainInput({
        chainId: "SN_MAIN",
        origin: "https://example.com",
        type: "wallet.switchChain",
      }),
    ).toBeNull();
    expect(
      readTransferInput({
        accountId,
        amount: "1.25",
        recipient: "0x456",
        tokenId: "SN_SEPOLIA:ETH:0x123",
        type: "wallet.transfer",
      }),
    ).toEqual({
      accountId,
      amount: "1.25",
      recipient: "0x456",
      speed: "standard",
      tokenId: "SN_SEPOLIA:ETH:0x123",
    });
    expect(
      readSaveAddressInput({
        address: "0x456",
        label: "Treasury",
        networkId: "SN_SEPOLIA",
        publicKeyX: "0x789",
        type: "wallet.saveAddress",
      }),
    ).toEqual({
      address: "0x456",
      label: "Treasury",
      networkId: "SN_SEPOLIA",
      publicKeyX: "0x789",
    });
    expect(
      readSaveAddressInput({
        address: "0x456",
        label: "Treasury",
        networkId: "SN_SEPOLIA",
        publicKeyX: "0x0",
        type: "wallet.saveAddress",
      }),
    ).toBeNull();
    expect(
      readAddInvokeTransactionInput({
        calls: [{ calldata: ["0x1", "2"], contractAddress: "0x123", entrypoint: "transfer" }],
        origin: "https://example.com",
        type: "wallet.addInvokeTransaction",
      }),
    ).toEqual({
      calls: [{ calldata: ["0x1", "2"], contractAddress: "0x123", entrypoint: "transfer" }],
      origin: "https://example.com",
    });
    expect(
      readAddInvokeTransactionInput({
        calls: [{ calldata: ["-1"], contractAddress: "0x123", entrypoint: "transfer" }],
        origin: "https://example.com",
        type: "wallet.addInvokeTransaction",
      }),
    ).toBeNull();
    expect(
      readTransferInput({
        accountId,
        amount: "1e3",
        recipient: "0x456",
        tokenId: "SN_SEPOLIA:ETH:0x123",
        type: "wallet.transfer",
      }),
    ).toBeNull();
  });

  test("reject short vault passphrases before service calls", () => {
    const shortPassphrase = "too short";

    expect(
      readCreateAccountInput({
        mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
        type: "wallet.createAccount",
        vaultPassphrase: shortPassphrase,
      }),
    ).toBeNull();
    expect(
      readGetGrantedAccountsInput({
        origin: "https://example.com",
        type: "wallet.getGrantedAccounts",
        vaultPassphrase: shortPassphrase,
      }),
    ).toBeNull();
    expect(readUnlockInput({ type: "wallet.unlock", vaultPassphrase: shortPassphrase })).toBeNull();
  });

  test("reject blank mnemonics before service calls", () => {
    expect(
      readCreateAccountInput({
        mnemonic: "   ",
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
  });

  test("reads add-account messages carrying only a network", () => {
    expect(
      readAddAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        type: "wallet.addAccount",
      }),
    ).toEqual({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
    });
    expect(readAddAccountInput({ networkId: "SN_BAD", type: "wallet.addAccount" })).toBeNull();
    expect(readAddAccountInput({ type: "wallet.addAccount" })).toBeNull();
    expect(
      readAddAccountInput({ networkId: "SN_MAIN", type: "wallet.addAccount", vaultPassphrase }),
    ).toBeNull();
  });

  test("rejects create-account messages with an out-of-range derivation index", () => {
    // A negative or non-safe-integer index is normalized to null and rejected
    // before the input reaches the vault service.
    expect(
      readCreateAccountInput({
        accountIndex: -1,
        mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readCreateAccountInput({
        addressIndex: 1.5,
        mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
  });

  test("rejects create-account messages with a non-string mnemonic passphrase", () => {
    expect(
      readCreateAccountInput({
        mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
        mnemonicPassphrase: 1234,
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readCreateAccountInput({
        mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
        mnemonicPassphrase: "x".repeat(1_025),
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readCreateAccountInput({
        mnemonic: "x".repeat(513),
        type: "wallet.createAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
  });

  test("reads exact account previews without accepting a vault passphrase", () => {
    const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
    expect(
      readPreviewAccountInput({
        accountContractType: "openzeppelin",
        accountIndex: 0,
        mnemonic,
        networkId: "SN_SEPOLIA",
        type: "wallet.previewAccount",
      }),
    ).toEqual({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      mnemonic,
      networkId: "SN_SEPOLIA",
    });
    expect(
      readPreviewAccountInput({
        mnemonic,
        networkId: "SN_SEPOLIA",
        type: "wallet.previewAccount",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readPreviewAccountInput({
        accountIndex: -1,
        mnemonic,
        type: "wallet.previewAccount",
      }),
    ).toBeNull();
    expect(readPreviewAccountInput({ mnemonic: "  ", type: "wallet.previewAccount" })).toBeNull();
  });

  test("reads exact mnemonic validation without accepting extra fields", () => {
    const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
    expect(readValidateMnemonicInput({ mnemonic, type: "wallet.validateMnemonic" })).toEqual({
      mnemonic,
    });
    expect(
      readValidateMnemonicInput({
        mnemonic,
        type: "wallet.validateMnemonic",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readValidateMnemonicInput({ mnemonic: "  ", type: "wallet.validateMnemonic" }),
    ).toBeNull();
    expect(readValidateMnemonicInput({ mnemonic, type: "wallet.previewAccount" })).toBeNull();
  });

  test("reads and rejects origin-revocation messages", () => {
    expect(
      readRevokeOriginInput({ origin: "https://example.com", type: "wallet.revokeOrigin" }),
    ).toEqual({ origin: "https://example.com" });
    expect(
      readRevokeOriginInput({ origin: "https://example.com", type: "wallet.unlock" }),
    ).toBeNull();
    expect(
      readRevokeOriginInput({
        debug: true,
        origin: "https://example.com",
        type: "wallet.revokeOrigin",
      }),
    ).toBeNull();
    expect(readRevokeOriginInput({ origin: "not-a-url", type: "wallet.revokeOrigin" })).toBeNull();
  });

  test("reads reveal-secrets messages requiring a re-entered passphrase", () => {
    expect(readRevealSecretsInput({ type: "wallet.revealSecrets", vaultPassphrase })).toEqual({
      vaultPassphrase,
    });
    expect(
      readRevealSecretsInput({ type: "wallet.revealSecrets", vaultPassphrase: "too short" }),
    ).toBeNull();
    expect(readRevealSecretsInput({ type: "wallet.revealSecrets" })).toBeNull();
    expect(readRevealSecretsInput({ type: "wallet.unlock", vaultPassphrase })).toBeNull();
  });
});
