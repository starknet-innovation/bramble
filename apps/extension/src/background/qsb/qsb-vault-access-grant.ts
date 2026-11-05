/**
 * Whether the user has granted Bramble the QSB coordinator's origin.
 *
 * The coordinator is not a required host permission: adding one would be a
 * privilege increase that disables the installed wallet on update until the
 * user re-approves (issue 772). It sits under the manifest's optional
 * all-HTTPS pattern instead, the UI requests exactly
 * `QSB_COORDINATOR_PERMISSION`, and the background asks the browser before
 * any coordinator request. Its API allows no other CORS origin, so without
 * the grant no request could succeed anyway; asking first means none is sent.
 *
 * Fails closed: a browser without the permissions API, or one whose answer
 * fails, reads as not granted.
 */
import { QSB_COORDINATOR_PERMISSION } from "@bramble/wallet-model/qsb-vaults";

/** The slice of `permissions` this check uses; absent where the browser lacks it. */
export type QsbHostPermissions = {
  readonly contains?: (permissions: { readonly origins: readonly string[] }) => Promise<boolean>;
};

/** Asks whether the coordinator's origin is granted now. */
export type QsbCoordinatorAccess = () => Promise<boolean>;

/** The access check over the browser's permissions API. */
export const qsbCoordinatorAccess =
  (permissions: QsbHostPermissions | undefined): QsbCoordinatorAccess =>
  async () => {
    const contains = permissions?.contains;
    if (!contains) return false;
    try {
      return (await contains({ origins: [QSB_COORDINATOR_PERMISSION] })) === true;
    } catch {
      return false;
    }
  };
