/**
 * Background message parser checks reject ambiguous runtime command shapes.
 */
import { describe, expect, test } from "bun:test";
import {
  readApprovalIdInput,
  readCreateAccountInput,
  readGetGrantedAccountsInput,
  readGrantOriginInput,
  readRequestAccountsInput,
  readSignHashInput,
  readTypeOnlyInput,
  readUnlockInput,
} from "../src/background/message-inputs";

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
      readGrantOriginInput({
        debug: true,
        origin: "https://example.com",
        type: "wallet.grantOrigin",
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
    expect(
      readRequestAccountsInput({
        debug: true,
        origin: "https://example.com",
        type: "wallet.requestAccounts",
      }),
    ).toBeNull();
    expect(
      readSignHashInput({
        debug: true,
        messageHash: "0x1234",
        type: "wallet.signHash",
        vaultPassphrase,
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
      readGrantOriginInput({
        accountId: "not-an-account",
        origin: "https://example.com",
        type: "wallet.grantOrigin",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readSignHashInput({
        accountId: "not-an-account",
        messageHash: "0x1234",
        type: "wallet.signHash",
        vaultPassphrase,
      }),
    ).toBeNull();
    expect(
      readSignHashInput({
        accountId,
        messageHash: "0x1234",
        type: "wallet.signHash",
        vaultPassphrase,
      }),
    ).toEqual({ accountId, messageHash: "0x1234", vaultPassphrase });
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
      readGrantOriginInput({
        origin: "https://example.com",
        type: "wallet.grantOrigin",
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
    expect(
      readSignHashInput({
        messageHash: "0x1234",
        type: "wallet.signHash",
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
});
