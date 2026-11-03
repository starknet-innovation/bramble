/**
 * In-memory multisig viewing-key methods for the Argent multisig harness.
 * The fixed key is the fake Krusty output, so a test can assert it never
 * leaves a response.
 */

import { WalletError } from "@bramble/core/errors";
import {
  acceptMultisigStrk20Key,
  canonicalMultisigStrk20Scope,
  forgetMultisigStrk20Key,
  forgetMultisigStrk20Keys,
  MAX_MULTISIG_STRK20_VIEWING_KEYS,
  MULTISIG_STRK20_VIEWING_KEY_SCHEME,
  type MultisigStrk20KeyLedger,
  type MultisigStrk20KeyScope,
  multisigStrk20KeyPackageContent,
  multisigStrk20KeyState,
  multisigStrk20ViewingKeyFor,
} from "@bramble/vault/multisig-strk20-key";
import { MULTISIG_STRK20_KEY_LIMIT } from "@bramble/vault/service";
import { canonicalFelt, isStarkPrivateKey } from "@bramble/wallet-model/networks";

const FIXED_KEY = "0x654321";

type ScopeInput = {
  readonly chainId: string;
  readonly isAuthorized?: () => boolean;
  readonly key?: string;
  readonly multisigId: string;
  readonly poolAddress: string;
};

const authorize = (input: { readonly isAuthorized?: () => boolean }): void => {
  if (input.isAuthorized && !input.isAuthorized()) throw new WalletError("wallet locked");
};

const scopeOf = (
  input: ScopeInput,
): { readonly key: string; readonly scope: MultisigStrk20KeyScope } => {
  const scope = canonicalMultisigStrk20Scope(input.multisigId, input.chainId, input.poolAddress);
  const key = input.key === undefined ? FIXED_KEY : canonicalFelt(input.key);
  if (!scope || !key || !isStarkPrivateKey(key)) {
    throw new Error("Invalid multisig STRK20 key");
  }
  return { key, scope };
};

/**
 * Wallet methods that keep one harness's viewing keys in memory.
 */
export const multisigStrk20WalletMethods = (maxKeys = MAX_MULTISIG_STRK20_VIEWING_KEYS) => {
  let ledger: MultisigStrk20KeyLedger = { conflicts: [], keys: [] };
  return {
    async acceptMultisigStrk20Key(input: ScopeInput & { readonly key: string }) {
      authorize(input);
      const { key, scope } = scopeOf(input);
      if (!multisigStrk20ViewingKeyFor(ledger.keys, scope) && ledger.keys.length >= maxKeys) {
        throw new WalletError(MULTISIG_STRK20_KEY_LIMIT);
      }
      const next = acceptMultisigStrk20Key(ledger, {
        ...scope,
        scheme: MULTISIG_STRK20_VIEWING_KEY_SCHEME,
        viewingKey: key,
      });
      if (!next) throw new WalletError(MULTISIG_STRK20_KEY_LIMIT);
      ledger = next.ledger;
      return next.result;
    },
    async createMultisigStrk20Key(input: ScopeInput) {
      authorize(input);
      const { scope } = scopeOf(input);
      if (multisigStrk20ViewingKeyFor(ledger.keys, scope)) return "held" as const;
      if (ledger.keys.length >= maxKeys) throw new WalletError(MULTISIG_STRK20_KEY_LIMIT);
      const next = acceptMultisigStrk20Key(ledger, {
        ...scope,
        scheme: MULTISIG_STRK20_VIEWING_KEY_SCHEME,
        viewingKey: FIXED_KEY,
      });
      if (!next) throw new WalletError(MULTISIG_STRK20_KEY_LIMIT);
      ledger = next.ledger;
      return "created" as const;
    },
    async forgetMultisigStrk20Key(input: ScopeInput) {
      authorize(input);
      const { scope } = scopeOf(input);
      const next = forgetMultisigStrk20Key(ledger, scope);
      if (!next) throw new WalletError("Invalid multisig STRK20 key");
      ledger = next.ledger;
      return next.removed;
    },
    async forgetMultisigStrk20Keys(input: {
      readonly isAuthorized?: () => boolean;
      readonly multisigId: string;
    }) {
      authorize(input);
      const next = forgetMultisigStrk20Keys(ledger, input.multisigId);
      if (!next) throw new WalletError("Invalid multisig STRK20 key");
      ledger = next.ledger;
      return next.removed;
    },
    async multisigStrk20KeyStatus(input: ScopeInput) {
      const { scope } = scopeOf(input);
      const state = multisigStrk20KeyState(ledger, scope);
      if (!state) throw new Error("Invalid multisig STRK20 key");
      return state;
    },
    async packageMultisigStrk20Key(input: ScopeInput) {
      const { scope } = scopeOf(input);
      const viewingKey = multisigStrk20ViewingKeyFor(ledger.keys, scope);
      return viewingKey
        ? multisigStrk20KeyPackageContent({
            ...scope,
            scheme: MULTISIG_STRK20_VIEWING_KEY_SCHEME,
            viewingKey,
          })
        : null;
    },
  };
};
