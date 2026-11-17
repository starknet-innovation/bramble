/**
 * The deploy screen's "Cost" box holds fee information only (mc-wallet #476,
 * docs/COPY_STYLE.md rule 7). A failed quote is why there is no fee, so it
 * stays in the box; a failed submission (RPC, nonce, revert) is not, so the
 * box empties and the reason goes to the status line and toast.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bindDeploy, type ShellBindingDeps } from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const deployMarkup = `<section class="section">
    <section id="deploy-review-stage">
      <button id="deploy-button" type="button">Deploy</button>
      <div id="deploy-review"></div>
      <p role="status"></p>
    </section>
  </section>`;

const mount = (): HTMLElement => {
  const container = document.createElement("div");
  container.id = "app";
  container.append(document.createRange().createContextualFragment(deployMarkup));
  document.body.replaceChildren(container);
  return container;
};

const click = (element: Element | null): void => {
  if (!(element instanceof window.HTMLElement)) {
    throw new Error("click target missing");
  }
  element.click();
};

const errorToasts = (): string[] =>
  Array.from(document.querySelectorAll(".toast.error .toast-text")).map(
    (node) => node.textContent ?? "",
  );

describe("deploy Cost box", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("a failed quote says why there is no fee inside the Cost box", async () => {
    const container = mount();
    bindDeploy({
      app: container,
      render: async () => undefined,
      setActiveView: () => undefined,
      wallet: {
        deployAccount: async () => {
          throw new Error("Fee estimation is unavailable.");
        },
      } as unknown as ShellBindingDeps["wallet"],
    });
    await tick();
    const box = container.querySelector("#deploy-review section");
    expect(box?.getAttribute("aria-label")).toBe("Cost");
    expect(box?.textContent).toContain("Fee estimation is unavailable.");
  });

  test("a failed submission is not shown as cost", async () => {
    const container = mount();
    const quote = { overallFee: "1000000000000000", unit: "FRI" as const };
    bindDeploy({
      app: container,
      render: async () => undefined,
      setActiveView: () => undefined,
      wallet: {
        deployAccount: async (fee?: typeof quote) => {
          if (!fee) return quote;
          throw new Error("Nonce too old");
        },
      } as unknown as ShellBindingDeps["wallet"],
    });
    await tick();
    expect(container.querySelector("#deploy-review")?.textContent).toContain("Maximum network fee");

    click(container.querySelector("#deploy-button"));
    await tick();
    // The spent quote is gone and the RPC error is not fee information, so
    // the Cost box empties and the reason goes to the status line.
    expect(container.querySelector("#deploy-review")?.textContent?.trim()).toBe("");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Nonce too old");
    expect(errorToasts()).toContain("Nonce too old");
  });
});
