/**
 * A connection-card choice is shown only after the presented account is stored.
 */
import { describe, expect, test } from "bun:test";
import {
  adoptStoredMultisig,
  connectAccountHandler,
  persistChoice,
} from "../../../src/sidepanel/app/screens/connect-account";
import { multisigNav } from "../../../src/sidepanel/app/screens/multisig-nav";

const deferred = () => {
  let settle: (saved: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};

describe("connect account choice", () => {
  test("does not repaint until the selection write succeeds", async () => {
    const pending = deferred();
    let rendered = false;
    const handler = connectAccountHandler({
      activeAccountId: () => "SN_MAIN:0x1",
      remember: () => pending.promise,
      render: () => {
        rendered = true;
      },
      showMultisig: () => undefined,
      switchAccount: () => Promise.resolve(),
    });
    handler("SN_MAIN:0x2", "multisig");
    expect(rendered).toBe(false);
    pending.settle(true);
    await pending.promise;
    await Promise.resolve();
    expect(rendered).toBe(true);
  });

  test("leaves the card unchanged when the selection write fails", async () => {
    let rendered = false;
    const handler = connectAccountHandler({
      activeAccountId: () => "SN_MAIN:0x1",
      remember: () => Promise.resolve(false),
      render: () => {
        rendered = true;
      },
      showMultisig: () => undefined,
      switchAccount: () => Promise.resolve(),
    });
    handler("SN_MAIN:0x2", "multisig");
    await Promise.resolve();
    expect(rendered).toBe(false);
  });
});

describe("presented account persistence", () => {
  test("updates local selection only after the write resolves", async () => {
    const assigned = { id: null as string | null };
    let notified = false;
    let release: () => void = () => undefined;
    const write = new Promise<void>((resolve) => {
      release = resolve;
    });
    const remember = persistChoice({
      assign: (id) => {
        assigned.id = id;
      },
      notify: () => {
        notified = true;
      },
      write: () => write,
    });
    const saving = remember("SN_MAIN:0x123");
    expect(assigned.id).toBeNull();
    release();
    await expect(saving).resolves.toBe(true);
    expect(assigned.id).toBe("SN_MAIN:0x123");
    expect(notified).toBe(false);
  });

  test("keeps the previous selection when the write fails", async () => {
    const assigned = { id: "previous" };
    let notified = false;
    const remember = persistChoice({
      assign: (id) => {
        assigned.id = id ?? "";
      },
      notify: () => {
        notified = true;
      },
      write: () => Promise.reject(new Error("storage")),
    });
    await expect(remember("SN_MAIN:0x123")).resolves.toBe(false);
    expect(assigned.id).toBe("previous");
    expect(notified).toBe(true);
  });

  test("opens a multisig only after its selection is stored", async () => {
    let release: (saved: boolean) => void = () => undefined;
    const remember = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    let view = "";
    const nav = multisigNav({
      currentId: () => null,
      navigate: (next) => {
        view = next;
      },
      remember: () => remember,
      setActiveAccount: () => Promise.resolve(),
      setIntent: () => undefined,
      setIntentId: () => undefined,
    });
    nav.openDetail("SN_MAIN:0x123", "multisig-detail");
    expect(view).toBe("");
    release(true);
    await remember;
    await Promise.resolve();
    expect(view).toBe("multisig-detail");
  });

  test("stays on the current screen when selection cannot be stored", async () => {
    let view = "home";
    const nav = multisigNav({
      currentId: () => null,
      navigate: (next) => {
        view = next;
      },
      remember: () => Promise.resolve(false),
      setActiveAccount: () => Promise.resolve(),
      setIntent: () => undefined,
      setIntentId: () => undefined,
    });
    nav.openList();
    await Promise.resolve();
    expect(view).toBe("home");
  });
});

describe("stored multisig hydration", () => {
  test("retries after a failed preference read", () => {
    const selection = { hydrated: false, id: null as string | null };
    const missed = adoptStoredMultisig(selection, "SN_MAIN", undefined, "home");
    expect(missed).toEqual({ hydrated: false, id: null, view: "home" });
    const adopted = adoptStoredMultisig(
      { hydrated: missed.hydrated, id: missed.id },
      "SN_MAIN",
      { selectedMultisigId: "SN_MAIN:0x123" },
      "home",
    );
    expect(adopted).toEqual({ hydrated: true, id: "SN_MAIN:0x123", view: "multisig-home" });
  });
});
