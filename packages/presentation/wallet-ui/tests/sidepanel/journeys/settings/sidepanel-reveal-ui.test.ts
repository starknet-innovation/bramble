/**
 * Reveal-secrets binding under happy-dom: the mask toggle flips both secret
 * fields and its own label, a confirmed passphrase renders the returned recovery
 * phrase and private key and unhides the output, and a rejected reveal surfaces
 * the error in the status line without exposing anything.
 *
 * The clipboard copy is covered here too: it reads the live node rather than any
 * second copy of the secret, refuses when nothing has been revealed, and
 * schedules the best-effort overwrite that keeps the phrase from sitting on the
 * clipboard indefinitely.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type {
  RevealSecretsResponse,
  WalletStatus,
} from "../../../../src/popup/responses/responses";
import {
  bindReveal,
  type RevealUiDeps,
  revealFlow,
} from "../../../../src/sidepanel/journeys/settings/reveal-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";
const PRIVATE_KEY = "0x123456";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type RevealResult = { readonly resolve: RevealSecretsResponse } | { readonly reject: unknown };

// Mounts the reveal screen and binds it against a wallet whose revealSecrets
// yields the scripted outcome, recording the passphrase it was handed.
const mount = (outcome: RevealResult) => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "app";
  container.replaceChildren(document.createRange().createContextualFragment(revealFlow(status)));
  document.body.append(container);

  const passphrases: string[] = [];
  const wallet = {
    revealSecrets: (vaultPassphrase: string): Promise<RevealSecretsResponse> => {
      passphrases.push(vaultPassphrase);
      return "resolve" in outcome
        ? Promise.resolve(outcome.resolve)
        : Promise.reject(outcome.reject);
    },
  };
  bindReveal({ app: container, wallet: wallet as unknown as RevealUiDeps["wallet"] });
  return { container, passphrases };
};

const submit = (container: HTMLElement): void => {
  container
    .querySelector<HTMLFormElement>("#reveal-form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

describe("bindReveal", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("the toggle unmasks both secret fields and relabels itself", () => {
    const { container } = mount({
      resolve: { mnemonic: MNEMONIC, ok: true, privateKey: PRIVATE_KEY },
    });
    const phrase = container.querySelector("#reveal-phrase");
    const key = container.querySelector("#reveal-key");
    const toggle = container.querySelector<HTMLButtonElement>("#reveal-toggle");

    expect(phrase?.classList.contains("is-masked")).toBe(true);

    toggle?.click();
    expect(phrase?.classList.contains("is-masked")).toBe(false);
    expect(key?.classList.contains("is-masked")).toBe(false);
    expect(toggle?.textContent).toContain("Tap to hide");

    toggle?.click();
    expect(phrase?.classList.contains("is-masked")).toBe(true);
    expect(key?.classList.contains("is-masked")).toBe(true);
    expect(toggle?.textContent).toContain("Tap to show");
  });

  test("a confirmed passphrase reveals the phrase and key and unhides the output", async () => {
    const { container, passphrases } = mount({
      resolve: { mnemonic: MNEMONIC, ok: true, privateKey: PRIVATE_KEY },
    });
    const input = container.querySelector<HTMLInputElement>('input[name="vaultPassphrase"]');
    if (input) {
      input.value = "correct horse battery staple";
    }

    submit(container);
    await tick();

    expect(passphrases).toEqual(["correct horse battery staple"]);
    expect(container.querySelector("#reveal-phrase")?.textContent).toBe(MNEMONIC);
    expect(container.querySelector("#reveal-key")?.textContent).toBe(PRIVATE_KEY);
    expect(container.querySelector("#reveal-output")?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector("#reveal-result")?.textContent).toContain("Revealed");
  });

  test("a wallet with no recovery phrase shows the fallback line, still revealing the key", async () => {
    const { container } = mount({ resolve: { mnemonic: null, ok: true, privateKey: PRIVATE_KEY } });

    submit(container);
    await tick();

    expect(container.querySelector("#reveal-phrase")?.textContent).toBe(
      "No recovery phrase is stored for this wallet.",
    );
    expect(container.querySelector("#reveal-key")?.textContent).toBe(PRIVATE_KEY);
  });

  test("a Ledger active account shows the device-recovery note, not a reveal form", () => {
    const ledgerAccount = {
      accountContractType: "openzeppelin" as const,
      address: account.address,
      classHash: account.classHash,
      derivation: {
        accountIndex: 0,
        eip2645application: "LedgerW" as const,
        kind: "ledger" as const,
        path: "m/2645'/1195502025'/734980059'/0'/0'/0",
      },
      id: account.id,
      networkId: account.networkId,
      publicKeyX: account.publicKeyX,
    };
    const ledgerStatus: WalletStatus = {
      ...status,
      accounts: [ledgerAccount],
      activeAccountId: ledgerAccount.id,
    };
    const html = revealFlow(ledgerStatus);

    expect(html).toContain("lives on your Ledger");
    expect(html).toContain("Recover this account from your Ledger device");
    // No reveal form or secret output region is emitted for a hardware account.
    expect(html).not.toContain('id="reveal-form"');
    expect(html).not.toContain('id="reveal-output"');
  });

  test("a rejected reveal reports the error and leaves the output hidden", async () => {
    const { container } = mount({ reject: new Error("Wrong passphrase") });

    submit(container);
    await tick();

    expect(container.querySelector("#reveal-result")?.textContent).toBe("Wrong passphrase");
    expect(container.querySelector("#reveal-output")?.hasAttribute("hidden")).toBe(true);
    // The error is announced as a toast too.
    expect(document.querySelector(".toast.error")?.textContent).toContain("Wrong passphrase");
  });

  test("copies the revealed phrase and schedules the clipboard overwrite", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });
    const scheduled: Array<() => void> = [];
    const realSetTimeout = window.setTimeout;
    Object.defineProperty(window, "setTimeout", {
      configurable: true,
      value: (callback: () => void, delay?: number) => {
        // Only intercept the clear timer; leave the toast's own timers alone.
        if (delay === 60_000) {
          scheduled.push(callback);
          return 0;
        }
        return realSetTimeout(callback, delay);
      },
    });

    const { container } = mount({
      resolve: { mnemonic: MNEMONIC, ok: true, privateKey: PRIVATE_KEY },
    });
    submit(container);
    await tick();
    container.querySelector<HTMLButtonElement>("#reveal-copy-phrase")?.click();
    await tick();

    expect(copied).toEqual([MNEMONIC]);
    // The phrase must not linger on the clipboard: the overwrite is scheduled,
    // and clears it when it runs.
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    await tick();
    expect(copied).toEqual([MNEMONIC, ""]);

    Object.defineProperty(window, "setTimeout", { configurable: true, value: realSetTimeout });
  });

  test("refuses to copy before anything has been revealed", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });

    const { container } = mount({
      resolve: { mnemonic: MNEMONIC, ok: true, privateKey: PRIVATE_KEY },
    });
    container.querySelector<HTMLButtonElement>("#reveal-copy-phrase")?.click();
    await tick();

    expect(copied).toEqual([]);
  });

  test("keeps the phrase out of the markup — the control carries no copy of it", () => {
    // The shared inline copy affordance puts its value in a `data-copy`
    // attribute. For a recovery phrase that would mint a second copy in the DOM
    // that outlives the mask, so this control must read the live node instead.
    const { container } = mount({
      resolve: { mnemonic: MNEMONIC, ok: true, privateKey: PRIVATE_KEY },
    });
    const copyButton = container.querySelector<HTMLButtonElement>("#reveal-copy-phrase");
    expect(copyButton).not.toBeNull();
    expect(copyButton?.outerHTML).not.toContain("data-copy");
    expect(revealFlow(status)).not.toContain("data-copy");
  });
});
