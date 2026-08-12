/**
 * Krusty KMS WASM adapter. Wallet cryptography must enter through this boundary.
 */
import { WalletError } from "@mc-wallet/core/errors";
import type { KmsPort } from "@mc-wallet/vault/kms-port";
import { isDerivationIndex } from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarkPrivateKey,
} from "@mc-wallet/wallet-model/networks";

type Callable = (...args: unknown[]) => unknown;
/**
 * The counterfactual-address salt every account this wallet derives was created
 * with. Held here, not left to the KMS, because a deployed address cannot change.
 */
const ZERO_SALT = "0x0";
const MNEMONIC_WORD_COUNTS = [12, 15, 18, 21, 24] as const;
const KRUSTY_RESULT_CLASSES = new Set(["WasmKeypair", "WasmStarkSignature"]);

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    throw new WalletError("Krusty KMS module did not load as an object");
  }
  return value as Record<string, unknown>;
};

const ownValue = (record: Record<string, unknown>, field: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
};

const krustyResultValue = (record: Record<string, unknown>, field: string): unknown => {
  const value = ownValue(record, field);
  if (value !== undefined) {
    return value;
  }

  const prototype = Object.getPrototypeOf(record);
  const prototypeConstructor = prototype
    ? Object.getOwnPropertyDescriptor(prototype, "constructor")?.value
    : null;
  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, field) : null;
  return typeof prototypeConstructor === "function" &&
    KRUSTY_RESULT_CLASSES.has(prototypeConstructor.name) &&
    typeof descriptor?.get === "function"
    ? descriptor.get.call(record)
    : undefined;
};

const requireFunction = (module: Record<string, unknown>, name: string): Callable => {
  const value = ownValue(module, name);
  if (typeof value !== "function") {
    throw new WalletError(`Krusty KMS export missing: ${name}`);
  }
  return value as Callable;
};

const requireStringField = (value: unknown, field: string): string => {
  const record = asRecord(value);
  const fieldValue = krustyResultValue(record, field);
  if (typeof fieldValue !== "string") {
    throw new WalletError(`Krusty KMS result missing string field: ${field}`);
  }
  return fieldValue;
};

const requireFieldElementField = (value: unknown, field: string): string => {
  const fieldValue = requireStringField(value, field);
  if (!isStarkFieldElement(fieldValue)) {
    throw new WalletError(`Krusty KMS result missing field element: ${field}`);
  }
  return fieldValue;
};

const requirePrivateKeyField = (value: unknown, field: string): string => {
  const fieldValue = requireFieldElementField(value, field);
  if (!isNonZeroStarkFieldElement(fieldValue)) {
    throw new WalletError(`Krusty KMS result missing non-zero private key: ${field}`);
  }
  return fieldValue;
};

const requireNonZeroFieldElementField = (value: unknown, field: string): string => {
  const fieldValue = requireFieldElementField(value, field);
  if (!isNonZeroStarkFieldElement(fieldValue)) {
    throw new WalletError(`Krusty KMS result missing non-zero field element: ${field}`);
  }
  return fieldValue;
};

const isMnemonicWordCount = (value: number): boolean =>
  Number.isSafeInteger(value) && MNEMONIC_WORD_COUNTS.some((count) => count === value);
const isMnemonicText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Wraps an unknown WASM module and validates required Krusty exports.
 */
export const createKrustyKms = (moduleValue: unknown): KmsPort => {
  const module = asRecord(moduleValue);
  const init = ownValue(module, "default");
  const ready =
    typeof init === "function" ? Promise.resolve((init as Callable)()) : Promise.resolve();

  const deriveOzAccountAddress = requireFunction(module, "deriveOzAccountAddress");
  // The scoped derivation, deliberately not the unscoped `deriveStrk20ViewingKey`
  // the KMS also exports — see KmsPort.deriveScopedStrk20ViewingKey.
  const deriveScopedStrk20ViewingKey = requireFunction(module, "deriveScopedStrk20ViewingKey");
  const foldStrk20ViewingKey = requireFunction(module, "foldStrk20ViewingKey");
  const strk20ViewingKeyMessageHash = requireFunction(module, "strk20ViewingKeyMessageHash");
  const deriveStarknetKeypair = requireFunction(module, "deriveStarknetKeypair");
  const generateMnemonic = requireFunction(module, "generateMnemonic");
  const getAccountClassHashes = requireFunction(module, "getAccountClassHashes");
  const signStarkHash = requireFunction(module, "signStarkHash");
  const validateMnemonic = requireFunction(module, "validateMnemonic");

  return {
    async deriveOzAccountAddress(publicKeyX, classHash, salt) {
      await ready;
      if (
        !isStarkFieldElement(publicKeyX) ||
        !isStarkFieldElement(classHash) ||
        (salt !== undefined && !isStarkFieldElement(salt))
      ) {
        throw new WalletError("Invalid Stark address derivation input");
      }

      // Salt 0 explicitly, never the KMS's default. An account's address is
      // immutable once deployed, so the salt that produced it is a wallet
      // invariant and cannot be inherited from a library default: upstream
      // changed that default from 0 to the public key in 0.6.0 — same signature,
      // different address — which silently re-derived every account to an
      // address that had never been deployed. Callers that need another salt pass
      // it; nobody may rely on what the KMS would have chosen.
      const result = await deriveOzAccountAddress(publicKeyX, classHash, salt ?? ZERO_SALT);
      if (typeof result !== "string" || !isStarkFieldElement(result)) {
        throw new WalletError("Krusty KMS returned an invalid account address");
      }
      return result;
    },
    async deriveScopedStrk20ViewingKey(privateKey, chainId, poolAddress) {
      await ready;
      if (
        !isNonZeroStarkFieldElement(privateKey) ||
        !isNonZeroStarkFieldElement(chainId) ||
        !isNonZeroStarkFieldElement(poolAddress)
      ) {
        throw new WalletError("Invalid STRK20 viewing-key input");
      }
      const result = await deriveScopedStrk20ViewingKey(privateKey, chainId, poolAddress);
      if (typeof result !== "string" || !isNonZeroStarkFieldElement(result)) {
        throw new WalletError("Krusty KMS returned an invalid STRK20 viewing key");
      }
      return result;
    },
    async foldStrk20ViewingKey(publicKey, messageHash, r, s) {
      await ready;
      // (r, s) arrive from a device the wallet does not control, and the KMS
      // verifies them against publicKey/messageHash, so all four are checked as
      // field elements before crossing into WASM.
      if (
        !isNonZeroStarkFieldElement(publicKey) ||
        !isStarkFieldElement(messageHash) ||
        !isStarkFieldElement(r) ||
        !isStarkFieldElement(s)
      ) {
        throw new WalletError("Invalid STRK20 viewing-key signature input");
      }
      const result = await foldStrk20ViewingKey(publicKey, messageHash, r, s);
      // The fold promises a key in [1, n/2]; isStarkPrivateKey pins the range
      // this wallet will accept, so a WASM build that broke that guarantee
      // fails closed here instead of registering an unusable key with the pool.
      if (typeof result !== "string" || !isStarkPrivateKey(result)) {
        throw new WalletError("Krusty KMS returned an invalid STRK20 viewing key");
      }
      return result;
    },
    async strk20ViewingKeyMessageHash(chainId, poolAddress) {
      await ready;
      if (
        !isNonZeroStarkFieldElement(chainId) ||
        !isNonZeroStarkFieldElement(poolAddress) ||
        canonicalFelt(chainId) !== chainId ||
        canonicalFelt(poolAddress) !== poolAddress
      ) {
        throw new WalletError("Invalid STRK20 viewing-key scope");
      }
      const result = await strk20ViewingKeyMessageHash(chainId, poolAddress);
      if (typeof result !== "string" || !isNonZeroStarkFieldElement(result)) {
        throw new WalletError("Krusty KMS returned an invalid STRK20 message hash");
      }
      return result;
    },
    async deriveStarknetKeypair(mnemonic, addressIndex, accountIndex, passphrase) {
      await ready;
      if (
        !isMnemonicText(mnemonic) ||
        !isDerivationIndex(addressIndex) ||
        !isDerivationIndex(accountIndex)
      ) {
        throw new WalletError("Invalid Stark derivation input");
      }

      const result = await deriveStarknetKeypair(mnemonic, addressIndex, accountIndex, passphrase);
      return {
        privateKey: requirePrivateKeyField(result, "private_key"),
        publicKeyX: requireFieldElementField(result, "public_key_x"),
        publicKeyY: requireFieldElementField(result, "public_key_y"),
      };
    },
    async generateMnemonic(wordCount = 12) {
      if (!isMnemonicWordCount(wordCount)) {
        throw new WalletError("Invalid mnemonic word count");
      }

      await ready;
      const result = await generateMnemonic(wordCount);
      if (typeof result !== "string" || result.trim().length === 0) {
        throw new WalletError("Krusty KMS returned an invalid mnemonic");
      }
      return result;
    },
    async getAccountClassHashes() {
      await ready;
      const result = await getAccountClassHashes();
      if (typeof result !== "string") {
        throw new WalletError("Krusty KMS returned invalid class hashes");
      }
      return result;
    },
    async signStarkHash(privateKey, messageHash) {
      await ready;
      if (!isNonZeroStarkFieldElement(privateKey) || !isStarkFieldElement(messageHash)) {
        throw new WalletError("Invalid Stark signing input");
      }

      const result = await signStarkHash(privateKey, messageHash);
      return {
        publicKey: requireNonZeroFieldElementField(result, "publicKey"),
        r: requireNonZeroFieldElementField(result, "r"),
        s: requireNonZeroFieldElementField(result, "s"),
      };
    },
    async validateMnemonic(mnemonic) {
      if (!isMnemonicText(mnemonic)) {
        throw new WalletError("Invalid mnemonic");
      }

      await ready;
      const result = await validateMnemonic(mnemonic);
      if (typeof result !== "boolean") {
        throw new WalletError("Krusty KMS returned an invalid mnemonic validation result");
      }
      return result;
    },
  };
};
