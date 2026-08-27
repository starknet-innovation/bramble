/**
 * The background paired-phone AccountHashSigner must hand the device the account's
 * enrolled key and device id, verify the returned signature against that key for
 * the exact hash handed out, and fail closed (throw, nothing returned) when it
 * does not verify — the last gate before a transaction is broadcast. Driven with
 * real ML-DSA-65 material, because a stub verifier would pass a wrong signature.
 */
import { describe, expect, test } from "bun:test";
import { mlDsa65Fixture } from "@mc-wallet/testkit/ml-dsa-fixtures";
import type { MobilePqAccountRef } from "@mc-wallet/wallet-model/accounts";
import { ML_DSA_65_SIGNATURE_BYTES } from "@mc-wallet/wallet-model/signing";
import {
  type MobilePqSignRequest,
  mobilePqHashSigner,
} from "../../../apps/extension/src/background/devices/mobile-pq-signer";

const HASH = "0x1e240";
const enrolled = mlDsa65Fixture(3);
const impostor = mlDsa65Fixture(4);

const account: MobilePqAccountRef = {
  accountContractType: "ml-dsa",
  mlDsaKind: "const",
  address: "0xabc111111",
  classHash: "0x111111",
  derivation: { deviceId: "phone-1", kind: "mobile-pq", transport: { kind: "clipboard" } },
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN",
  publicKey: enrolled.publicKey,
  publicKeyX: "0x456",
};

describe("mobilePqHashSigner", () => {
  test("hands the phone the enrolled key and device id, and tags the scheme", async () => {
    const seen: MobilePqSignRequest[] = [];
    const sign = mobilePqHashSigner(account, async (request) => {
      seen.push(request);
      return { signature: enrolled.sign(request.messageHash) };
    });

    const signature = await sign(HASH);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      accountId: account.id,
      deviceId: "phone-1",
      messageHash: HASH,
      publicKey: account.publicKey,
    });
    expect(signature.kind).toBe("ml-dsa-65");
    expect(signature.publicKey).toBe(account.publicKey);
    if (signature.kind !== "ml-dsa-65") {
      throw new Error("unreachable");
    }
    expect(signature.signature.length).toBe(2 + 2 * ML_DSA_65_SIGNATURE_BYTES);
  });

  test("fails closed when the phone signs with a key the account never enrolled", async () => {
    const sign = mobilePqHashSigner(account, async (request) => ({
      signature: impostor.sign(request.messageHash),
    }));
    await expect(sign(HASH)).rejects.toThrow("Mobile signature verification failed");
  });

  test("fails closed when the phone returns a signature of a different hash", async () => {
    const sign = mobilePqHashSigner(account, async () => ({ signature: enrolled.sign("0xdead") }));
    await expect(sign(HASH)).rejects.toThrow("Mobile signature verification failed");
  });

  test("fails closed on a domain-separated signature", async () => {
    // The wire contract fixes an empty FIPS 204 context on both sides. A phone
    // that applied one would produce signatures nothing on chain can validate.
    const sign = mobilePqHashSigner(account, async (request) => ({
      signature: enrolled.sign(request.messageHash, Uint8Array.from([1])),
    }));
    await expect(sign(HASH)).rejects.toThrow("Mobile signature verification failed");
  });

  test("fails closed on a malformed or empty device response", async () => {
    for (const signature of ["", "0x", "0xzz", enrolled.publicKey]) {
      const sign = mobilePqHashSigner(account, async () => ({ signature }));
      await expect(sign(HASH)).rejects.toThrow("Mobile signature verification failed");
    }
  });

  test("a device rejection propagates instead of resolving an empty signature", async () => {
    const sign = mobilePqHashSigner(account, async () => {
      throw new Error("user declined on device");
    });
    await expect(sign(HASH)).rejects.toThrow("user declined on device");
  });
});
