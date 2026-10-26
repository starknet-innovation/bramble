/**
 * Wallet pages answer presence probes only while visible, so a panel Arc has
 * loaded but never drawn stays silent (#690).
 */
import { describe, expect, test } from "bun:test";
import {
  readSurfacePresenceMessage,
  reportSurfacePresence,
  type SurfacePresenceMessage,
} from "../src/provider/surface-presence";

const page = (visibilityState: string) => {
  const sent: SurfacePresenceMessage[] = [];
  let onMessage: ((event: { readonly data: unknown }) => void) | undefined;
  let onVisibility: (() => void) | undefined;
  const document = {
    addEventListener: (_type: "visibilitychange", listener: () => void) => {
      onVisibility = listener;
    },
    visibilityState,
  };
  reportSurfacePresence(
    {
      addEventListener: (_type, listener) => {
        onMessage = listener;
      },
      close: () => undefined,
      postMessage: (message) => sent.push(message),
      removeEventListener: () => undefined,
    },
    document,
  );
  return {
    document,
    probe: (data: unknown = { type: "probe" }) => onMessage?.({ data }),
    sent,
    show: () => {
      document.visibilityState = "visible";
      onVisibility?.();
    },
  };
};

describe("surface presence", () => {
  test("a visible page announces itself and answers probes", () => {
    const visible = page("visible");
    visible.probe();

    expect(visible.sent).toEqual([{ type: "visible" }, { type: "visible" }]);
  });

  test("a loaded page that is never drawn stays silent", () => {
    const hidden = page("hidden");
    hidden.probe();

    expect(hidden.sent).toEqual([]);
  });

  test("a page announces itself once it becomes visible", () => {
    const later = page("hidden");
    later.show();

    expect(later.sent).toEqual([{ type: "visible" }]);
  });

  test("ignores anything that is not an exact probe", () => {
    const visible = page("visible");
    visible.probe({ type: "visible" });
    visible.probe({ extra: 1, type: "probe" });
    visible.probe("probe");
    visible.probe(null);

    expect(visible.sent).toEqual([{ type: "visible" }]);
  });

  test("parses only the two message shapes", () => {
    expect(readSurfacePresenceMessage({ type: "probe" })).toEqual({ type: "probe" });
    expect(readSurfacePresenceMessage({ type: "visible" })).toEqual({ type: "visible" });
    expect(readSurfacePresenceMessage({ type: "other" })).toBeNull();
    expect(readSurfacePresenceMessage([])).toBeNull();
    expect(readSurfacePresenceMessage(undefined)).toBeNull();
  });
});
