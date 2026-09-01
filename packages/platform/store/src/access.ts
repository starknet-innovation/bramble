/**
 * Deny-by-default storage capability checks for extension actors.
 */
import { WalletError } from "@bramble/core/errors";

/**
 * Extension actor identities used for store access checks.
 */
export type StoreActor = "background" | "popup";
/**
 * Named storage scopes with separate access rules.
 */
export type StoreScope = "preferences" | "vault";

const STORE_PERMISSIONS: Readonly<Record<StoreScope, readonly StoreActor[]>> = {
  preferences: ["background", "popup"],
  vault: ["background"],
};

const isStoreScope = (scope: unknown): scope is StoreScope =>
  typeof scope === "string" && Object.hasOwn(STORE_PERMISSIONS, scope);

const isStoreActor = (actor: unknown): actor is StoreActor =>
  actor === "background" || actor === "popup";

/**
 * Throws when an actor attempts to access a denied storage scope.
 */
export const assertStoreAccess = (scope: unknown, actor: unknown): void => {
  if (!canAccessStore(scope, actor)) {
    throw new WalletError("Storage access denied");
  }
};

/**
 * Returns whether an actor may access a storage scope.
 */
export const canAccessStore = (scope: unknown, actor: unknown): boolean =>
  isStoreScope(scope) && isStoreActor(actor) && STORE_PERMISSIONS[scope].includes(actor);
