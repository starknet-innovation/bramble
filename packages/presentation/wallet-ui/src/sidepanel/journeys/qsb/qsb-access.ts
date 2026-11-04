/**
 * Runtime access to the Quantum-safe Bitcoin coordinator. Its origin is not a
 * manifest host permission (adding one would disable the wallet on update,
 * issue 772); the user grants it at runtime under the manifest's optional
 * all-HTTPS pattern, as with a custom endpoint, and the background refuses
 * every coordinator write with `accessNeeded` until they have.
 *
 * Only `QSB_COORDINATOR_PERMISSION` is ever checked or requested. Without the
 * browser's permission API, or when it throws or answers anything but `true`,
 * access reads as missing and a request as denied: nothing that needs the
 * coordinator is sent.
 */
import { QSB_COORDINATOR_PERMISSION, QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import type { HostPermissionApi } from "../../runtime/runtime-global";

/** The coordinator grant, checked or asked for. */
export type QsbAccess = {
  /** Whether the grant is held now. Never prompts. */
  readonly check: () => Promise<boolean>;
  /**
   * Prompts for the grant. The browser honours it only inside a user gesture,
   * so callers invoke it in the click itself, before any `await`.
   */
  readonly request: () => Promise<boolean>;
};

// Calls the browser at once (a prompt must stay inside its click) and reads
// anything but a plain `true`, a throw included, as no.
const answer = (call: () => Promise<boolean>): Promise<boolean> => {
  try {
    return call().then(
      (granted) => granted === true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
};

/** The coordinator grant over the injected permission API, or none. */
export const createQsbAccess = (permissions: HostPermissionApi | null): QsbAccess => ({
  check: () =>
    permissions === null
      ? Promise.resolve(false)
      : answer(() => permissions.contains({ origins: [QSB_COORDINATOR_PERMISSION] })),
  request: () =>
    permissions === null
      ? Promise.resolve(false)
      : answer(() => permissions.request({ origins: [QSB_COORDINATOR_PERMISSION] })),
});

/** Whether a rejected coordinator call was refused for want of the grant. */
export const isQsbAccessNeeded = (error: unknown): boolean =>
  error instanceof Error && error.message === QSB_VAULT_REFUSALS.accessNeeded;

/**
 * Sends `send` once access is held. When `held` (the last check) is false,
 * the prompt is shown first, synchronously inside the caller's click; a
 * denial rejects with the `accessNeeded` refusal and sends nothing.
 */
export const withQsbAccess = <T>(
  access: QsbAccess,
  held: boolean,
  send: () => Promise<T>,
): Promise<T> =>
  held
    ? send()
    : access
        .request()
        .then((granted) =>
          granted ? send() : Promise.reject(new Error(QSB_VAULT_REFUSALS.accessNeeded)),
        );
