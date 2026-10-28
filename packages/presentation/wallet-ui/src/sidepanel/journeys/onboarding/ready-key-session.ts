/**
 * Binds a Ready-key discovery and its picker to the inputs it was run for
 * (issue 776). A picker lists the accounts one key, salt, and network control,
 * so its ticks mean nothing for any other key, salt, or network. Every request
 * takes a generation; an answer that arrives after a newer request or an input
 * change is dropped, and the ticks are only handed out while the inputs still
 * match the snapshot the picker was built from. At most one picker is mounted.
 *
 * A discovery that ended for the inputs as they are also binds the address
 * finder (issue 779): a lookup runs for that discovery's snapshot, and a found
 * account replaces the picker with its one row, so the import names it by
 * address instead of by release.
 */

import { ADDRESS_IMPORT_REFUSALS, type KeyAddressCandidate } from "@bramble/wallet-model/recovery";
import type { ReadyKeyCandidate } from "../../../popup/responses/responses-onboarding";
import type { ReadyKeyPick } from "../../runtime/runtime-accounts";
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
  /**
   * Looks up a pasted address for the snapshot of the last discovery, which
   * must have ended for the inputs as they are now (refused otherwise). A
   * found account replaces the picker with its row; an answer that arrives
   * after an input change, a newer discovery, or a newer lookup is dropped
   * (null).
   */
  readonly findByAddress: (
    request: (inputs: ReadyKeyInputs) => Promise<KeyAddressCandidate>,
    mount: (candidate: KeyAddressCandidate) => ReadyKeyPicker | null,
  ) => Promise<KeyAddressCandidate | null>;
  /** Drops the picker, the finder's snapshot, and any answer still in flight. */
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

/**
 * What an import sends: the picker's own snapshot and its ticks, plus the
 * address when the picker shows an account found by its address.
 */
type ReadyKeySelection = {
  readonly address?: string;
  readonly classHashes: readonly string[];
  readonly inputs: ReadyKeyInputs;
};

/**
 * The pick an import names for a selection: the ticked releases, or the one
 * account found by address with its recorded class. Null when nothing is ticked.
 */
export const readyKeyPick = (selection: ReadyKeySelection): ReadyKeyPick | null => {
  const [classHash] = selection.classHashes;
  if (classHash === undefined) return null;
  return selection.address === undefined
    ? selection.classHashes
    : { address: selection.address, classHash };
};

const sameInputs = (left: ReadyKeyInputs, right: ReadyKeyInputs): boolean =>
  left.key === right.key && left.networkId === right.networkId && left.salt === right.salt;

/** Creates the session for one form; `current` reads its inputs as they are now. */
export const readyKeySession = (current: () => ReadyKeyInputs): ReadyKeySession => {
  let generation = 0;
  let mounted: {
    readonly address?: string;
    readonly inputs: ReadyKeyInputs;
    readonly picker: ReadyKeyPicker;
  } | null = null;
  // The inputs of the discovery that ended last, for the address finder.
  let discovered: { readonly generation: number; readonly inputs: ReadyKeyInputs } | null = null;
  // Each lookup takes a number; only the latest one may mount its answer.
  let lookups = 0;

  const invalidate = (): void => {
    generation += 1;
    mounted?.picker.remove();
    mounted = null;
    discovered = null;
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
        discovered = { generation: mine, inputs };
        throw error;
      }
      const dropped = stale();
      if (dropped) return dropped;
      discovered = { generation: mine, inputs };
      const picker = mount(candidates);
      if (picker) mounted = { inputs, picker };
      return "mounted";
    },
    findByAddress: async (request, mount) => {
      const ticket = discovered;
      lookups += 1;
      const lookup = lookups;
      const isCurrent = (): boolean =>
        ticket !== null &&
        ticket.generation === generation &&
        lookup === lookups &&
        sameInputs(ticket.inputs, current());
      if (ticket === null || !isCurrent()) {
        throw new Error(ADDRESS_IMPORT_REFUSALS.stale);
      }
      const candidate = await request(ticket.inputs);
      if (!isCurrent()) return null;
      mounted?.picker.remove();
      mounted = null;
      const picker = mount(candidate);
      if (picker) mounted = { address: candidate.address, inputs: ticket.inputs, picker };
      return candidate;
    },
    invalidate,
    matches,
    picked: () => (mounted !== null && matches() ? mounted.picker.picked() : null),
    selection: () =>
      mounted !== null && matches()
        ? {
            ...(mounted.address === undefined ? {} : { address: mounted.address }),
            classHashes: mounted.picker.picked(),
            inputs: mounted.inputs,
          }
        : null,
  };
};
