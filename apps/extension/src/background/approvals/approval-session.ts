/** Session view held by a claimed approval through every deferred executor. */
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";

/**
 * Captures claim-time authority. Later credential reads cannot adopt a new
 * unlock, including inside a queued coordinator callback. Non-secret approvals
 * may start locked but cannot cross a session transition. Never renews on capture.
 */
export const approvalSession = (
  session: UnlockSession,
): { readonly isCurrent: () => boolean; readonly session: UnlockSession } => {
  const authorized = captureSessionAuthorization(session);
  const initiallyUnlocked = authorized.isCurrent();
  const isCurrent = (): boolean =>
    initiallyUnlocked ? authorized.isCurrent() : session.generation() === authorized.generation;
  return {
    isCurrent,
    session: {
      ...session,
      getPassphrase: () => (isCurrent() ? session.getPassphrase() : null),
      isUnlocked: () => isCurrent() && session.isUnlocked(),
      peekPassphrase: () => (isCurrent() ? session.peekPassphrase() : null),
    },
  };
};
