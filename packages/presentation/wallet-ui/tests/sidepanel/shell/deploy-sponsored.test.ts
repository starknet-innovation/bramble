/**
 * The deploy screen under a sponsored deploy (issue 431). When the background offers
 * one, the Cost box names the sponsor instead of a fee the user would not pay,
 * and Deploy sends the sponsored request — never the self-paid one. A sponsor
 * refusal sent nothing, so the user's own fee returns with the reason; a lost
 * reply stays amber, never "failed".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SPONSORED_DEPLOY_REFUSED } from "@bramble/privacy/sponsored-deploy";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { DeploySponsorship } from "../../../src/sidepanel/runtime/runtime-deploy";
import {
  deployCostLine,
  SPONSORED_DEPLOY_COST,
} from "../../../src/sidepanel/shell/deploy-sponsorship";
import { bindDeploy, type ShellBindingDeps } from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const deployMarkup = `<section class="section">
    <section id="deploy-review-stage">
      <button id="deploy-button" type="button">Deploy</button>
      <div id="deploy-review"></div>
      <p role="status"></p>
    </section>
    <section id="deploy-success" hidden></section>
  </section>`;

const mount = (): HTMLElement => {
  const container = document.createElement("div");
  container.id = "app";
  container.append(document.createRange().createContextualFragment(deployMarkup));
  document.body.replaceChildren(container);
  return container;
};

const quote = { overallFee: "1000000000000000", unit: "FRI" as const };

const toasts = (tone: string): string[] =>
  Array.from(document.querySelectorAll(`.toast.${tone} .toast-text`)).map(
    (node) => node.textContent ?? "",
  );

const wallet = (input: {
  readonly sponsored: () => Promise<string>;
  readonly sponsorship: DeploySponsorship;
}) => {
  const calls: string[] = [];
  return {
    calls,
    wallet: {
      deployAccount: async (fee?: typeof quote) => {
        calls.push(fee ? "deployAccount:fee" : "deployAccount:quote");
        return fee ? "0x5e1f" : quote;
      },
      deployAccountSponsored: async () => {
        calls.push("deployAccountSponsored");
        return input.sponsored();
      },
      deploySponsorship: async () => input.sponsorship,
      loadActivity: async () => [],
      loadStatus: async () => ({ networkId: "SN_SEPOLIA" }),
    } as unknown as ShellBindingDeps["wallet"],
  };
};

const bind = (container: HTMLElement, stub: ShellBindingDeps["wallet"]): void =>
  bindDeploy({
    app: container,
    confirmationDelaysMs: [],
    render: async () => undefined,
    setActiveView: () => undefined,
    wallet: stub,
  });

const press = (container: HTMLElement): void => {
  container.querySelector<HTMLButtonElement>("#deploy-button")?.click();
};

describe("deploy Cost line", () => {
  test("names the sponsor, never a fee, when the sponsor pays", () => {
    expect(deployCostLine(quote, "available")).toBe("Network fee: paid by the Starknet Foundation");
    expect(deployCostLine(quote, "none")).toStartWith("Maximum network fee: ");
    expect(deployCostLine(quote, undefined)).toStartWith("Maximum network fee: ");
    expect(deployCostLine(quote, "refused")).toEndWith(
      ". The Starknet Foundation couldn't cover this deployment.",
    );
    expect(deployCostLine(quote, "held")).toEndWith(
      ". A sponsored deployment of this account may already be on its way.",
    );
    expect(deployCostLine(quote, "may-land")).toEndWith(
      ". A sponsored deployment may still land. If it does, yours is refused at no cost.",
    );
  });
});

describe("sponsored deploy screen", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("shows the sponsor in the Cost box and deploys through the sponsor", async () => {
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "available" });
    bind(container, stub.wallet);
    await tick();
    const cost = container.querySelector("#deploy-review")?.textContent ?? "";
    expect(cost).toContain(SPONSORED_DEPLOY_COST);
    expect(cost).not.toContain("Maximum network fee");

    press(container);
    await tick();
    expect(stub.calls).toEqual(["deployAccount:quote", "deployAccountSponsored"]);
    expect(container.querySelector("#deploy-success")?.hasAttribute("hidden")).toBe(false);
  });

  test("after an earlier attempt, shows its state and deploys self-paid", async () => {
    for (const sponsorship of ["held", "may-land"] as const) {
      const container = mount();
      const stub = wallet({ sponsored: async () => "0x5ab", sponsorship });
      bind(container, stub.wallet);
      await tick();
      const cost = container.querySelector("#deploy-review")?.textContent ?? "";
      expect(cost).toContain("Maximum network fee");
      expect(cost).toContain("A sponsored deployment");
      press(container);
      await tick();
      expect(stub.calls).toEqual(["deployAccount:quote", "deployAccount:fee"]);
    }
  });

  test("keeps the user's own fee when nothing is offered", async () => {
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "none" });
    bind(container, stub.wallet);
    await tick();
    expect(container.querySelector("#deploy-review")?.textContent).toContain("Maximum network fee");
    press(container);
    await tick();
    expect(stub.calls).toEqual(["deployAccount:quote", "deployAccount:fee"]);
  });

  test("a sponsor refusal brings back the user's fee with the reason", async () => {
    const container = mount();
    const stub = wallet({
      sponsored: async () => {
        throw new Error(SPONSORED_DEPLOY_REFUSED);
      },
      sponsorship: "available",
    });
    bind(container, stub.wallet);
    await tick();
    press(container);
    await tick();
    const cost = container.querySelector("#deploy-review")?.textContent ?? "";
    expect(cost).toContain("Maximum network fee");
    expect(cost).toContain("couldn't cover this deployment");
    expect(toasts("error")).toContain(SPONSORED_DEPLOY_REFUSED);
    // The next press is the self-paid deploy the Cost box now shows.
    press(container);
    await tick();
    expect(stub.calls).toEqual([
      "deployAccount:quote",
      "deployAccountSponsored",
      "deployAccount:fee",
    ]);
  });

  test("a refusal after an earlier error quotes a fresh self-paid fee", async () => {
    const container = mount();
    const answers = [new Error("wallet locked"), new Error(SPONSORED_DEPLOY_REFUSED)];
    const stub = wallet({
      sponsored: async () => {
        throw answers.shift();
      },
      sponsorship: "available",
    });
    bind(container, stub.wallet);
    await tick();
    // The lock spends the quoted fee; the screen is still on the sponsored route.
    press(container);
    await tick();
    expect(container.querySelector("#deploy-review")?.textContent?.trim()).toBe("");
    press(container);
    await tick();
    const cost = container.querySelector("#deploy-review")?.textContent ?? "";
    expect(cost).toContain("Maximum network fee");
    expect(cost).toContain("couldn't cover this deployment");
    press(container);
    await tick();
    expect(stub.calls).toEqual([
      "deployAccount:quote",
      "deployAccountSponsored",
      "deployAccountSponsored",
      "deployAccount:quote",
      "deployAccount:fee",
    ]);
  });

  test("a lost reply is amber, not a failure, and offers no self-paid fee", async () => {
    const container = mount();
    const stub = wallet({
      sponsored: async () => {
        throw new SubmissionUnknownError("deployment failed", null);
      },
      sponsorship: "available",
    });
    bind(container, stub.wallet);
    await tick();
    press(container);
    await tick();
    expect(toasts("warning").length).toBe(1);
    expect(toasts("error")).toEqual([]);
    expect(container.querySelector("#deploy-review")?.textContent ?? "").not.toContain(
      "Maximum network fee",
    );
  });
});
