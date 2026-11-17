/**
 * Signs a fixed SNIP-12 message in the wallet and checks the signature with
 * the account contract's is_valid_signature. The call is a read; it does not
 * submit a transaction.
 */

import { isRecord } from "@bramble/core/json";
import { expect, test } from "../../e2e/fixtures";
import { resolveConnectionApproval, resolvePendingApproval } from "../../e2e/wallet-helpers";
import { requireLocalMainnetAccount } from "../local-mainnet-account";
import {
  isValidSignatureResult,
  mainnetToken,
  readIsValidSignature,
  signMessageHash,
} from "../local-mainnet-chain";
import { selfTransferRaw } from "../local-mainnet-limits";
import { resolvedOutput, startWalletDapp } from "./dapp";
import { openFundedWallet } from "./session";

const account = await requireLocalMainnetAccount();

test("signs a SNIP-12 message that the account accepts", async ({ extension }) => {
  const sidepanel = await openFundedWallet(extension, account);
  const server = await startWalletDapp(
    mainnetToken("STRK").address,
    account.address,
    selfTransferRaw(18),
  );
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(server.url);
    await expect(dapp.locator('[data-testid="provider-status"]')).not.toHaveText("missing");
    await dapp.locator('[data-testid="connect"]').click();
    await resolveConnectionApproval(sidepanel, server.origin, "approve");
    await resolvedOutput(dapp, "connect-result");
    await dapp.locator('[data-testid="sign"]').click();
    await resolvePendingApproval(sidepanel, "Sign request", server.origin, "approve");
    const signed = await resolvedOutput(dapp, "sign-result");
    if (!isRecord(signed) || !Array.isArray(signed["result"])) {
      throw new Error("The dapp did not receive a signature.");
    }
    const signature = signed["result"].filter((item): item is string => typeof item === "string");
    expect(signature.length).toBeGreaterThanOrEqual(2);
    const felts = await readIsValidSignature(
      account.rpcUrl,
      account.address,
      signMessageHash(account.address),
      signature,
    );
    expect(isValidSignatureResult(felts)).toBe(true);
  } finally {
    await server.close();
  }
});
