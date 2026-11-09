/**
 * An error toast's copy control carries the raw diagnostic (mc-wallet issue
 * 476).
 *
 * The toast shows the reader-facing sentence and keeps the original error
 * behind its copy control for a bug report. Callers used to hand the toast
 * `errorMessage(...)`, which has already rewritten a network failure into the
 * connectivity sentence, so the copy control held that sentence instead of
 * what actually failed. They hand it `errorDetails(...)` now, and the toast
 * does the rewriting itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { account } from "@bramble/testkit/sidepanel";
import { errorLine } from "../../../src/sidepanel/shared/dom";
import { outcomeReceiptSection } from "../../../src/sidepanel/shared/outcome-receipt";
import { bindDeploy, type ShellBindingDeps } from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const RAW = "TypeError: fetch failed (connect ECONNREFUSED 10.0.0.1:443)";
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let copied: string[] = [];

beforeEach(() => {
  document.body.replaceChildren();
  copied = [];
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied.push(value);
      },
    },
  });
});

describe("error toast copy control", () => {
  test("copies what failed, while the toast shows the reader's sentence", async () => {
    const app = document.createElement("div");
    app.innerHTML = `<section id="deploy-review-stage">
        <button id="deploy-button" type="button">Deploy</button>
        <div id="deploy-review"></div>
        <p role="status"></p>
      </section>
      ${outcomeReceiptSection("deploy-success")}`;
    document.body.append(app);
    let quoted = false;
    const wallet = {
      deployAccount: async (fee?: unknown) => {
        if (!fee && !quoted) {
          quoted = true;
          return { overallFee: "1000", unit: "FRI" as const };
        }
        throw new Error(RAW);
      },
    } as unknown as ShellBindingDeps["wallet"];
    bindDeploy({
      app,
      deploymentScope: () => ({ accountId: account.id, stillCurrent: () => true }),
      render: async () => undefined,
      setActiveView: () => undefined,
      wallet,
    });
    await tick();
    app.querySelector<HTMLButtonElement>("#deploy-button")?.click();
    await tick();

    expect(document.querySelector(".toast.error .toast-text")?.textContent).toContain(
      "Couldn't reach the network",
    );
    document.querySelector<HTMLButtonElement>(".toast.error .toast-copy")?.click();
    await tick();
    expect(copied).toEqual([RAW]);
  });

  test("a status line names the same cause the toast does", () => {
    // The status line classifies the raw diagnostic too, so a node's own
    // rejection that mentions a timeout is not reported as a lost connection.
    const rejection = new Error(
      'RPC: starknet_estimateFee with params {"request":[]} 41: Transaction execution timed out',
    );
    expect(errorLine(rejection, "Fee estimate failed")).toBe(
      "The RPC rejected this request. Copy the error details for the full response.",
    );
  });

  test("no caller hands an error toast the rewritten message", () => {
    const root = join(import.meta.dir, "../../../src");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
      });
    const offenders = files(root).filter((path) =>
      /showToast\(\s*errorMessage\(/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
