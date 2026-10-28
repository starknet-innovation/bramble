/**
 * Binds a Ready-key discovery and its picker to the inputs it was run for
 * (issue 776). A picker lists the accounts one key, salt, and network control,
 * so its ticks mean nothing for any other key, salt, or network. Every request
 * takes a generation; an answer that arrives after a newer request or an input
 * change is dropped, and the ticks are only handed out while the inputs still
 * match the snapshot the picker was built from. At most one picker is mounted.
 */

import type { ReadyKeyCandidate } from "../../../popup/responses/responses-onboarding";
import type { ReadyKeyPicker } from "./ready-key-picker";

/** What a discovery was run for. The key stays in its form field otherwise. */
export type ReadyKeyInputs = {
  readonly key: string;
  readonly networkId: string;
  readonly salt: string | undefined;
};

/**
 * How a discovery ended: its picker is up, a newer request or an input edit
 * superseded it (whoever did that owns the form now), or the inputs changed
 * without an edit event, such as the network, and the session was invalidated.
 */
type ReadyKeyDiscovery = "mounted" | "superseded" | "changed";

/** The discovery/picker lifecycle a key-import form drives. */
export type ReadyKeySession = {
  /**
   * Runs a discovery for the inputs as they are now. A stale answer, or a
   * stale failure, is dropped rather than mounted or thrown; a current
   * failure rejects.
   */
  readonly discover: (
    request: (inputs: ReadyKeyInputs) => Promise<readonly ReadyKeyCandidate[]>,
    mount: (candidates: readonly ReadyKeyCandidate[]) => ReadyKeyPicker | null,
  ) => Promise<ReadyKeyDiscovery>;
  /** Drops the picker and any answer still in flight. */
  readonly invalidate: () => void;
  /** Whether a picker is mounted for the inputs as they are now. */
  readonly matches: () => boolean;
  /** The ticked classes, or `null` when no picker matches the inputs now. */
  readonly picked: () => readonly string[] | null;
  /**
   * The ticks together with the exact inputs the picker was built from, or
   * `null` when no picker matches the inputs now. An import sends these
   * inputs, never ones re-read from the form.
   */
  readonly selection: () => ReadyKeySelection | null;
};

/** What an import sends: the picker's own snapshot and its ticks. */
type ReadyKeySelection = {
  readonly classHashes: readonly string[];
  readonly inputs: ReadyKeyInputs;
};

const sameInputs = (left: ReadyKeyInputs, right: ReadyKeyInputs): boolean =>
  left.key === right.key && left.networkId === right.networkId && left.salt === right.salt;

/** Creates the session for one form; `current` reads its inputs as they are now. */
export const readyKeySession = (current: () => ReadyKeyInputs): ReadyKeySession => {
  let generation = 0;
  let mounted: { readonly picker: ReadyKeyPicker; readonly inputs: ReadyKeyInputs } | null = null;

  const invalidate = (): void => {
    generation += 1;
    mounted?.picker.remove();
    mounted = null;
  };
  const matches = (): boolean => mounted !== null && sameInputs(mounted.inputs, current());

  return {
    discover: async (request, mount) => {
      invalidate();
      const mine = generation;
      const inputs = current();
      // The network has no edit event, so the inputs are compared as well.
      const stale = (): ReadyKeyDiscovery | null => {
        if (mine !== generation) return "superseded";
        if (sameInputs(inputs, current())) return null;
        invalidate();
        return "changed";
      };
      let candidates: readonly ReadyKeyCandidate[];
      try {
        candidates = await request(inputs);
      } catch (error) {
        const dropped = stale();
        if (dropped) return dropped;
        throw error;
      }
      const dropped = stale();
      if (dropped) return dropped;
      const picker = mount(candidates);
      if (picker) mounted = { inputs, picker };
      return "mounted";
    },
    invalidate,
    matches,
    picked: () => (mounted !== null && matches() ? mounted.picker.picked() : null),
    selection: () =>
      mounted !== null && matches()
        ? { classHashes: mounted.picker.picked(), inputs: mounted.inputs }
        : null,
  };
};
