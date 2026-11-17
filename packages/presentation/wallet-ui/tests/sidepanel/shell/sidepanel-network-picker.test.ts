/**
 * Behavioural coverage for bindPickers under happy-dom: the network-switch and
 * error branches not exercised by tests/sidepanel/sidepanel-account-select.test.ts,
 * and the guard that only a button carrying data-network-id is a network picker.
 * The binding is driven against a recording fake wallet with a minimal hand-built
 * DOM carrying exactly the attributes the binder queries, then real clicks are
 * dispatched and both the wallet call and the resulting DOM/toast feedback are
 * asserted. Split from sidepanel-shell-bindings.test.ts, whose dashboard and
 * deploy bindings share the same harness.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import type { WalletView } from "../../../src/sidepanel/app/screens/views";
import { bindPickers, type ShellBindingDeps } from "../../../src/sidepanel/shell/shell-bindings";
import { click, registerDom, status, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (html: string): HTMLElement => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "app";
  container.append(document.createRange().createContextualFragment(html));
  document.body.append(container);
  return container;
};

const errorToasts = (): string[] =>
  Array.from(document.querySelectorAll(".toast.error .toast-text")).map(
    (node) => node.textContent ?? "",
  );

describe("bindPickers", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  const pickerMarkup = `
    <button data-network-id="SN_SEPOLIA" aria-pressed="false" type="button">Sepolia</button>
    <button data-network-id="SN_MAIN" aria-pressed="true" type="button">Mainnet</button>
    <p id="picker-result" role="status"></p>`;

  const makeDeps = (
    container: HTMLElement,
    wallet: Partial<Record<string, unknown>>,
    sinks: { renders: WalletStatus[]; views: WalletView[] },
  ): ShellBindingDeps => ({
    app: container,
    render: async (next) => {
      sinks.renders.push(next);
    },
    setActiveView: (view) => {
      sinks.views.push(view);
    },
    wallet: wallet as unknown as ShellBindingDeps["wallet"],
  });

  test("ignores a non-button carrying the network, and everything inside it", async () => {
    // The Send form carries its own network for the explorer link. Binding on
    // the attribute alone made every click inside it switch network and leave
    // for settings, because the click bubbled to the form.
    const container = mount(`
      <form data-network-id="SN_SEPOLIA">
        <button id="inner" type="button">Choose a recipient</button>
      </form>
      <p id="picker-result" role="status"></p>`);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    const seen: string[] = [];
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async (id: string) => {
            seen.push(id);
            return status;
          },
        },
        sinks,
      ),
    );

    click(container.querySelector("#inner"));
    await tick();
    click(container.querySelector("form"));
    await tick();

    expect(seen).toEqual([]);
    expect(sinks.views).toEqual([]);
  });

  test("switches the network, returns to settings, and re-renders", async () => {
    const container = mount(pickerMarkup);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    const seen: string[] = [];
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async (id: string) => {
            seen.push(id);
            return status;
          },
        },
        sinks,
      ),
    );

    click(container.querySelector('[data-network-id="SN_SEPOLIA"]'));
    await tick();

    expect(seen).toEqual(["SN_SEPOLIA"]);
    expect(sinks.views).toEqual(["settings"]);
    expect(sinks.renders).toEqual([status]);
  });

  test("tapping the already-active network is a no-op", async () => {
    const container = mount(pickerMarkup);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    let called = 0;
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async () => {
            called += 1;
            return status;
          },
        },
        sinks,
      ),
    );

    click(container.querySelector('[data-network-id="SN_MAIN"]'));
    await tick();

    expect(called).toBe(0);
    expect(sinks.views).toEqual([]);
    expect(sinks.renders).toEqual([]);
  });

  test("ignores non-button markup that carries data-network-id", async () => {
    const container = mount(`
      <form data-network-id="SN_SEPOLIA">
        <input id="inside" type="search" />
      </form>`);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    let called = 0;
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async () => {
            called += 1;
            return status;
          },
        },
        sinks,
      ),
    );

    click(container.querySelector("#inside"));
    await tick();

    expect(called).toBe(0);
    expect(sinks.views).toEqual([]);
  });

  test("reports a network switch failure on the picker result line", async () => {
    const container = mount(pickerMarkup);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    const button = container.querySelector<HTMLButtonElement>('[data-network-id="SN_SEPOLIA"]');
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async () => {
            throw new Error("The network switch did not take.");
          },
        },
        sinks,
      ),
    );

    click(button);
    await tick();

    expect(sinks.views).toEqual([]);
    expect(container.querySelector("#picker-result")?.textContent).toBe(
      "The network switch did not take.",
    );
    expect(errorToasts()).toContain("The network switch did not take.");
    expect(button?.disabled).toBe(false);
  });
});
