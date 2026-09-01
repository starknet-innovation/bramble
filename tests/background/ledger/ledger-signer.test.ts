/**
 * The background Ledger StarkHashSigner must hand the device the account's exact
 * stored path and the intent the prompt will show, verify the returned signature
 * against the account's publicKeyX, and fail closed (throw, nothing returned)
 * when the device returns a signature that does not verify — the last gate
 * before a transaction is broadcast.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import { ec } from "starknet";
import {
  type LedgerSignRequest,
  ledgerStarkHashSigner,
} from "../../../apps/extension/src/background/ledger/ledger-signer";

const { starkCurve } = ec;
const PRIVATE_KEY = "0x1234567890abcdef";
const publicKeyX = starkCurve.getStarkKey(PRIVATE_KEY);

const account: LedgerAccountRef = {
  accountContractType: "openzeppelin",
  address: "0xabc111111",
  classHash: "0x111111",
  derivation: {
    accountIndex: 3,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(3),
  },
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN",
  publicKeyX,
};

const deviceSignOf = (privateKey: string) => async (request: LedgerSignRequest) => {
  const sig = starkCurve.sign(request.messageHash, privateKey);
  return { r: `0x${sig.r.toString(16)}`, s: `0x${sig.s.toString(16)}` };
};

describe("ledgerStarkHashSigner", () => {
  test("hands the device the stored path and returns the verified signature", async () => {
    const seen: LedgerSignRequest[] = [];
    const sign = ledgerStarkHashSigner(account, "send-token", async (request) => {
      seen.push(request);
      return deviceSignOf(PRIVATE_KEY)(request);
    });

    const signature = await sign("0x1e240");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      accountId: account.id,
      intent: "send-token",
      messageHash: "0x1e240",
      path: ledgerAccountPath(3),
      publicKeyX,
    });
    expect(signature.publicKey).toBe(publicKeyX);
    expect(
      starkCurve.verify(
        new starkCurve.Signature(BigInt(signature.r), BigInt(signature.s)),
        "0x1e240",
        starkCurve.getPublicKey(PRIVATE_KEY),
      ),
    ).toBe(true);
  });

  test("fails closed when the device signs with the wrong key", async () => {
    const sign = ledgerStarkHashSigner(account, "send-token", deviceSignOf("0xdeadbeef"));
    await expect(sign("0x1e240")).rejects.toThrow("Ledger signature verification failed");
  });

  test("fails closed when the device returns a signature of a different hash", async () => {
    const sign = ledgerStarkHashSigner(account, "send-token", async () =>
      deviceSignOf(PRIVATE_KEY)({
        accountId: account.id,
        intent: "send-token",
        messageHash: "0xdead",
        path: account.derivation.path,
        publicKeyX,
      }),
    );
    await expect(sign("0x1e240")).rejects.toThrow("Ledger signature verification failed");
  });
});
