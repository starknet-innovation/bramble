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
import { outcomeReceiptSection } from "../../../src/sidepanel/shared/outcome-receipt";
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
    ${outcomeReceiptSection("deploy-success")}
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
  readonly activity?: () => unknown;
  readonly sponsored: () => Promise<string>;
  readonly sponsorship: DeploySponsorship | (() => DeploySponsorship);
  readonly verification?: () => unknown;
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
      deploySponsorship: async () =>
        typeof input.sponsorship === "function" ? input.sponsorship() : input.sponsorship,
      loadActivity: async () => input.activity?.() ?? { entries: [] },
      loadClassHashVerification: async () => input.verification?.() ?? null,
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

// A binding scoped to one account that reads the chain once after a deploy.
const bindWatching = (container: HTMLElement, stub: ShellBindingDeps["wallet"]): void =>
  bindDeploy({
    app: container,
    confirmationDelaysMs: [0],
    deploymentScope: () => ({ accountId: ACCOUNT, stillCurrent: () => true }),
    render: async () => undefined,
    setActiveView: () => undefined,
    wallet: stub,
  });

const ACCOUNT = "SN_SEPOLIA:0xabc";

describe("sponsored deploy receipt", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  const receiptAfterDeploy = async (verification: string): Promise<string> => {
    const container = mount();
    const stub = wallet({
      activity: () => ({ entries: [{ hash: "0x5ab", status: "accepted" }] }),
      sponsored: async () => "0x5ab",
      sponsorship: "available",
      verification: () => ({
        accountId: ACCOUNT,
        ok: true,
        verification:
          verification === "verified"
            ? { onChainClassHash: "0x1", status: "verified" }
            : { status: "undeployed" },
      }),
    });
    bindWatching(container, stub.wallet);
    await tick();
    press(container);
    await tick();
    await tick();
    return container.querySelector("#deploy-success")?.textContent ?? "";
  };

  test("an accepted relay hash over an empty address is not 'Account deployed'", async () => {
    const receipt = await receiptAfterDeploy("undeployed");
    expect(receipt).toContain("Deployment submitted");
    expect(receipt).not.toContain("Account deployed");
  });

  test("the account's class at its address is 'Account deployed'", async () => {
    expect(await receiptAfterDeploy("verified")).toContain("Account deployed");
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

  test("keeps the user's own fee, with no sponsor message, when nothing is offered", async () => {
    // "none" is every gateway answer that is not a quote: switched off,
    // rate-limited, budget spent, unreachable, unusable. The screen is the
    // self-paid one as it was before sponsorship existed.
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "none" });
    bind(container, stub.wallet);
    await tick();
    const cost = (container.querySelector("#deploy-review")?.textContent ?? "").replace(
      /\s+/g,
      " ",
    );
    expect(cost.trim()).toBe(`Cost ${deployCostLine(quote, undefined)}`);
    expect(cost).not.toMatch(/sponsor|Foundation|couldn't/i);
    expect(document.querySelectorAll(".toast").length).toBe(0);
    expect(container.querySelector('[role="status"]')?.textContent ?? "").toBe("");
    press(container);
    await tick();
    expect(stub.calls).toEqual(["deployAccount:quote", "deployAccount:fee"]);
  });

  test("a sponsored press the background answers 'already deployed' repaints from a fresh read", async () => {
    const container = mount();
    let statusReads = 0;
    const stub = wallet({
      sponsored: async () => {
        throw new Error("account already deployed");
      },
      sponsorship: "available",
    });
    const repainted: unknown[] = [];
    bindDeploy({
      app: container,
      confirmationDelaysMs: [],
      render: async (status) => {
        repainted.push(status);
      },
      setActiveView: () => undefined,
      wallet: {
        ...stub.wallet,
        loadStatus: async () => {
          statusReads += 1;
          return { networkId: "SN_SEPOLIA" };
        },
      } as ShellBindingDeps["wallet"],
    });
    await tick();
    press(container);
    await tick();
    expect(statusReads).toBe(1);
    expect(repainted).toEqual([{ networkId: "SN_SEPOLIA" }]);
    expect(stub.calls).toEqual(["deployAccount:quote", "deployAccountSponsored"]);
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

  test("after a lost reply, the screen turns self-paid once the hold is over", async () => {
    const container = mount();
    const states: DeploySponsorship[] = ["available", "held", "may-land"];
    const stub = wallet({
      sponsored: async () => {
        throw new SubmissionUnknownError("deployment failed", null);
      },
      sponsorship: () => states.shift() ?? "may-land",
    });
    bind(container, stub.wallet);
    await tick();
    press(container);
    await tick();
    // The press after the lost reply only quotes; the refreshed state says the
    // hold is over and the sponsored deploy may still land.
    press(container);
    await tick();
    expect(container.querySelector("#deploy-review")?.textContent).toContain(
      "A sponsored deployment may still land. If it does, yours is refused at no cost.",
    );
    press(container);
    await tick();
    expect(stub.calls).toEqual([
      "deployAccount:quote",
      "deployAccountSponsored",
      "deployAccount:quote",
      "deployAccount:fee",
    ]);
  });

  test("after a sponsored deploy reverts, Try again deploys self-paid", async () => {
    const container = mount();
    const states: DeploySponsorship[] = ["available", "may-land"];
    const stub = wallet({
      activity: () => ({ entries: [{ hash: "0x5ab", status: "reverted" }] }),
      sponsored: async () => "0x5ab",
      sponsorship: () => states.shift() ?? "may-land",
    });
    bind(container, stub.wallet);
    await tick();
    press(container);
    await tick();
    container.querySelector<HTMLButtonElement>('[data-outcome-action="retry"]')?.click();
    await tick();
    expect(container.querySelector("#deploy-review")?.textContent).toContain("may still land");
    press(container);
    await tick();
    expect(stub.calls).toEqual([
      "deployAccount:quote",
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
