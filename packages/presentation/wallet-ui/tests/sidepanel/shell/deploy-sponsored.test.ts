/**
 * The deploy screen under a sponsored deploy (issue 431, 788). When the
 * background offers one, the Cost box names the sponsor instead of a fee the
 * user would not pay, and Deploy sends the sponsored request — never the
 * self-paid one. When the sponsor is not deploying it, for any reason, the
 * screen silently becomes the normal self-paid one: no toast, no note. The
 * deploying state while a hold stands has its own suite
 * (`deploy-sponsored-hold.test.ts`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { DEPLOYMENT_IN_PROGRESS } from "@bramble/privacy/sponsored-deploy";
import {
  deployCostLine,
  SPONSORED_DEPLOY_COST,
} from "../../../src/sidepanel/shell/deploy-sponsorship";
import {
  bindDeployScreen as bind,
  DEPLOY_ACCOUNT,
  mountDeployScreen as mount,
  press,
  deployQuote as quote,
  screen,
  tick,
  deployWallet as wallet,
} from "../../support/deploy-screen-harness";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const PLAIN_FEE = `Cost ${deployCostLine(quote, "none")}`;

describe("deploy Cost line", () => {
  test("names the sponsor when it pays, and is otherwise the user's fee with nothing added", () => {
    expect(deployCostLine(quote, "available")).toBe("Network fee: paid by the Starknet Foundation");
    for (const sponsorship of ["none", "held", undefined] as const) {
      expect(deployCostLine(quote, sponsorship)).toBe("Maximum network fee: 0.001 STRK");
    }
  });
});

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
        accountId: DEPLOY_ACCOUNT,
        ok: true,
        verification:
          verification === "verified"
            ? { onChainClassHash: "0x1", status: "verified" }
            : { status: "undeployed" },
      }),
    });
    bind(container, stub.wallet, { watching: true });
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
    expect(screen(container).cost).toContain(SPONSORED_DEPLOY_COST);
    expect(screen(container).cost).not.toContain("Maximum network fee");
    press(container);
    await tick();
    expect(stub.calls).toEqual([
      "deployAccount:quote",
      "deploySponsorship",
      "deployAccountSponsored",
    ]);
    expect(container.querySelector("#deploy-success")?.hasAttribute("hidden")).toBe(false);
  });

  test("keeps the user's own fee, with no sponsor message, when nothing is offered", async () => {
    // "none" is every gateway answer that is not a quote: switched off,
    // rate-limited, budget spent, unreachable, unusable, refused today.
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "none" });
    bind(container, stub.wallet);
    await tick();
    expect(screen(container).cost).toBe(PLAIN_FEE);
    expect(screen(container).cost).not.toMatch(/sponsor|Foundation|couldn't/i);
    expect(document.querySelectorAll(".toast").length).toBe(0);
    expect(screen(container).status).toBe("");
    press(container);
    await tick();
    expect(stub.calls).toEqual(["deployAccount:quote", "deploySponsorship", "deployAccount:fee"]);
  });

  test("a sponsored press the sponsor declines silently becomes the self-paid screen", async () => {
    // Refused (429s, any clean no), unsupported class, or unreachable at the
    // press: the background answers "not sponsored", and nothing was sent.
    const container = mount();
    const stub = wallet({ sponsored: async () => null, sponsorship: "available" });
    bind(container, stub.wallet);
    await tick();
    press(container);
    await tick();
    expect(screen(container).cost).toBe(PLAIN_FEE);
    expect(screen(container).status).toBe("");
    expect(screen(container).button?.hidden).toBe(false);
    expect(screen(container).button?.disabled).toBe(false);
    expect(document.querySelectorAll(".toast").length).toBe(0);
    press(container);
    await tick();
    expect(stub.calls).toEqual([
      "deployAccount:quote",
      "deploySponsorship",
      "deployAccountSponsored",
      "deployAccount:fee",
    ]);
  });

  test("a decline after an earlier error quotes a fresh self-paid fee, still silently", async () => {
    const container = mount();
    const answers: (Error | null)[] = [new Error("wallet locked"), null];
    const stub = wallet({
      sponsored: async () => {
        const answer = answers.shift() ?? null;
        if (answer) throw answer;
        return null;
      },
      sponsorship: "available",
    });
    bind(container, stub.wallet);
    await tick();
    // The lock spends the quoted fee; the screen is still on the sponsored route.
    press(container);
    await tick();
    expect(screen(container).cost).toBe("");
    document.body.querySelectorAll(".toast").forEach((toast) => {
      toast.remove();
    });
    press(container);
    await tick();
    expect(screen(container).cost).toBe(PLAIN_FEE);
    expect(document.querySelectorAll(".toast").length).toBe(0);
    press(container);
    await tick();
    expect(stub.calls).toEqual([
      "deployAccount:quote",
      "deploySponsorship",
      "deployAccountSponsored",
      "deployAccountSponsored",
      "deployAccount:quote",
      "deployAccount:fee",
    ]);
  });

  test("a sponsored press the background answers 'already deployed' repaints from a fresh read", async () => {
    const container = mount();
    const stub = wallet({
      sponsored: async () => {
        throw new Error("account already deployed");
      },
      sponsorship: "available",
    });
    const repainted: unknown[] = [];
    bind(container, stub.wallet, {
      render: async (status) => {
        repainted.push(status);
      },
    });
    await tick();
    press(container);
    await tick();
    expect(repainted).toEqual([{ networkId: "SN_SEPOLIA" }]);
    expect(stub.calls).toEqual([
      "deployAccount:quote",
      "deploySponsorship",
      "deployAccountSponsored",
    ]);
  });

  test("after a sponsored deploy reverts, Try again deploys self-paid with no note", async () => {
    const container = mount();
    const states = ["available", "none"] as const;
    let asked = 0;
    const stub = wallet({
      activity: () => ({ entries: [{ hash: "0x5ab", status: "reverted" }] }),
      sponsored: async () => "0x5ab",
      sponsorship: () => states[Math.min(asked++, 1)] ?? "none",
    });
    bind(container, stub.wallet);
    await tick();
    press(container);
    await tick();
    container.querySelector<HTMLButtonElement>('[data-outcome-action="retry"]')?.click();
    await tick();
    expect(screen(container).cost).toBe(PLAIN_FEE);
    press(container);
    await tick();
    expect(stub.calls.filter((call) => call.startsWith("deployAccount"))).toEqual([
      "deployAccount:quote",
      "deployAccountSponsored",
      "deployAccount:quote",
      "deployAccount:fee",
    ]);
  });

  test("the hold sentence is the only copy the sponsored flow adds", () => {
    expect(DEPLOYMENT_IN_PROGRESS).toBe("Deploying your account. This can take a few minutes.");
  });
});
