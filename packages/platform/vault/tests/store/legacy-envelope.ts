/**
 * A version-2 encrypted envelope, as written before 0.9.2, shared by the store
 * suites that read or replay one, and the vault content such an install held.
 */

/**
 * Builds an envelope at the pre-bump legacy strength with raw Web Crypto,
 * independent of the store's own encryptJson, to prove compatibility with
 * envelopes produced before the KDF iteration raise.
 */
export const legacyEnvelope = async (value: unknown, passphrase: string, scope: string) => {
  const encoder = new TextEncoder();
  const iterations = 310_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { hash: "SHA-256", iterations, name: "PBKDF2", salt: salt.slice().buffer },
    baseKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const data = await crypto.subtle.encrypt(
    {
      additionalData: encoder.encode(scope).slice().buffer,
      iv: iv.slice().buffer,
      name: "AES-GCM",
    },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return {
    cipher: "AES-256-GCM",
    data: toBase64(new Uint8Array(data)),
    iterations,
    iv: toBase64(iv),
    kdf: "PBKDF2-SHA-256",
    salt: toBase64(salt),
    scope,
    version: 2,
  };
};

/** The one account in {@link vaultV3}. */
export const account = {
  address: "0x123",
  classHash: "0xabc",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x456",
  publicKeyY: "0x789",
};
/** A schema-3 vault, as a pre-0.9.2 install would hold, for the unlock path. */
export const vaultV3 = {
  accounts: [account],
  activeAccountId: account.id,
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  originGrants: [],
  schemaVersion: 3 as const,
  signingKeys: [{ accountId: account.id, privateKey: "0x654321" }],
};
