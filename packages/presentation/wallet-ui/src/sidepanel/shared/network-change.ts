/**
 * Tells bound forms that the active network changed. A repaint only replaces
 * the markup when it differs, so a form whose markup does not name the network
 * survives a switch with whatever it was showing for the old one. A form that
 * holds network-scoped state, such as the Ready-key account picker, listens
 * here and drops that state the moment the network moves.
 */

const NETWORK_CHANGED_EVENT = "bramble:network-changed";

/**
 * Returns the reporter the paint loop calls with each status's network. The
 * first network seen is the starting point, not a change; every later
 * different one dispatches a change on `app`. A null `app` reports nothing.
 */
export const networkChangeAnnouncer = (app: Element | null): ((networkId: string) => void) => {
  let last: string | null = null;
  return (networkId) => {
    const changed = last !== null && last !== networkId;
    last = networkId;
    if (changed) app?.dispatchEvent(new Event(NETWORK_CHANGED_EVENT));
  };
};

/**
 * Runs `listener` on every network change while `owner` is still mounted.
 * A repaint that replaced `owner` leaves the listener on the long-lived `app`,
 * so it detaches itself on the first change after `owner` is gone.
 */
export const onNetworkChange = (
  app: Element | null,
  owner: Element | null,
  listener: () => void,
): void => {
  if (!app || !owner) return;
  const handle = (): void => {
    if (!owner.isConnected) {
      app.removeEventListener(NETWORK_CHANGED_EVENT, handle);
      return;
    }
    listener();
  };
  app.addEventListener(NETWORK_CHANGED_EVENT, handle);
};
