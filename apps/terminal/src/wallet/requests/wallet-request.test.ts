import { describe, expect, it } from "vitest";
import { WalletError } from "../../protocols/support/errors";
import { walletRequestError } from "./wallet-request";

const DECLINED = "The request was declined in the wallet. Nothing was submitted.";

describe("walletRequestError", () => {
  it("reports a wallet's own rejection as a decline", () => {
    expect(walletRequestError(new Error("User rejected request"))).toBe(DECLINED);
    expect(walletRequestError(Object.assign(new Error("x"), { code: 113 }))).toBe(DECLINED);
  });

  // Issue 652: the terminal's own checks run before the wallet sees anything, so
  // their words are never read as the reader declining in the wallet.
  it("never reports the terminal's own refusal as a decline", () => {
    const refusal = "Private swap service returned a substituted route; refused";
    expect(walletRequestError(new WalletError(refusal))).toBe(refusal);
    expect(walletRequestError(new WalletError("The terminal refused an empty wallet request."))).toBe(
      "The wallet could not complete this request. You can safely try again.",
    );
  });

  it("hides terminal plumbing and keeps facts and wallet errors", () => {
    expect(walletRequestError(new WalletError("Could not quote Vesu wind route"))).toBe(
      "The wallet could not complete this request. You can safely try again.",
    );
    expect(walletRequestError(new Error("Wallet returned an invalid transaction hash."))).toBe(
      "Wallet returned an invalid transaction hash.",
    );
    expect(walletRequestError(new Error("Ledger device: Locked device (0x5515)"))).toBe(
      "Ledger device: Locked device (0x5515)",
    );
  });
});
