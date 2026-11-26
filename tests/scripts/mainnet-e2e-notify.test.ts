/**
 * The Mainnet E2E Slack notifier's reviewed script, executed with stubbed
 * `core`, `fetch` and environment: it posts every enabled run, sends only
 * validated values as JSON, never sends the webhook or raw output, and
 * never fails the run because Slack is unset or unreachable.
 */
import { describe, expect, test } from "bun:test";
import { NOTIFY_SCRIPT } from "../../scripts/mainnet-e2e-workflow-notify";

const WEBHOOK = "https://hooks.slack.com/services/T0000000/B0000000/abcdefghijklmnop";
const REVISION = "0123456789abcdef0123456789abcdef01234567";

type Call = { readonly kind: string; readonly message: string };
type Posted = { readonly url: string; readonly init: RequestInit };

const passing = (): Record<string, string> => ({
  SLACK_MAINNET_E2E_WEBHOOK_URL: WEBHOOK,
  REVISION,
  RESULTS: "success success success success",
  PLAYWRIGHT: "passed",
  GASLESS: "passed",
  VERDICT: "ok",
  STRK_DELTA: "0.0421",
  USDC_DELTA: "0",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "starknet-innovation/bramble",
  GITHUB_RUN_ID: "123456789",
});

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<void>;

const run = async (
  env: Record<string, string>,
  respond: () => Promise<Response> = async () => new Response("ok", { status: 200 }),
): Promise<{ calls: Call[]; posted: Posted[] }> => {
  const calls: Call[] = [];
  const posted: Posted[] = [];
  const record =
    (kind: string) =>
    (message: string): void => {
      calls.push({ kind, message });
    };
  const core = {
    notice: record("notice"),
    info: record("info"),
    warning: record("warning"),
    setFailed: record("failed"),
    setSecret: record("secret"),
  };
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    posted.push({ url, init });
    return respond();
  };
  const body = new AsyncFunction("core", "fetch", "process", NOTIFY_SCRIPT.join("\n"));
  await body(core, fetch, { env });
  return { calls, posted };
};

const text = (posted: Posted[]): string =>
  (JSON.parse(String(posted[0]?.init.body)) as { text: string }).text;

describe("mainnet E2E Slack notifier", () => {
  test("posts a passing run as JSON with every reviewed field", async () => {
    const { calls, posted } = await run(passing());
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe(WEBHOOK);
    expect(posted[0]?.init.method).toBe("POST");
    expect(posted[0]?.init.redirect).toBe("error");
    expect(text(posted)).toBe(
      [
        "Mainnet E2E pass on main at `0123456`",
        "Jobs: preflight success, build success, tests success, post-run balance success",
        "Playwright passed, gasless passed",
        "Balance ok. Spent 0.0421 STRK, 0 USDC.",
        "<https://github.com/starknet-innovation/bramble/actions/runs/123456789|View run>",
      ].join("\n"),
    );
    expect(calls[0]).toEqual({ kind: "secret", message: WEBHOOK });
    expect(String(posted[0]?.init.body)).not.toContain("hooks.slack.com");
  });

  test("reports FAIL for any job that did not succeed or a balance outside policy", async () => {
    for (const change of [
      { RESULTS: "success success failure success", GASLESS: "failed" },
      { RESULTS: "success cancelled skipped success", PLAYWRIGHT: "", GASLESS: "" },
      { VERDICT: "over-cap" },
      { RESULTS: "success success success skipped", VERDICT: "" },
      { RESULTS: "success success success" },
    ]) {
      const { posted } = await run({ ...passing(), ...change });
      expect(text(posted).startsWith("Mainnet E2E FAIL on main")).toBe(true);
    }
    const { posted } = await run({ ...passing(), PLAYWRIGHT: "" });
    expect(text(posted)).toContain("Playwright not run, gasless passed");
  });

  test("replaces every unvalidated value, so nothing else reaches Slack", async () => {
    const hostile = 'x"}\n<!channel> https://evil.example';
    const { posted } = await run({
      ...passing(),
      REVISION: hostile,
      RESULTS: `${hostile} success success success`,
      PLAYWRIGHT: hostile,
      GASLESS: `passed\n${hostile}`,
      VERDICT: `ok ${hostile}`,
      STRK_DELTA: `1${hostile}`,
      USDC_DELTA: hostile,
    });
    const message = text(posted);
    expect(message).not.toContain("channel");
    expect(message).not.toContain("evil");
    expect(message).toContain("`unavailable`");
    expect(message).toContain("preflight unavailable, build unavailable");
    expect(message).toContain("Playwright not run, gasless not run");
    expect(message).toContain("Balance unavailable. Spent unavailable STRK, unavailable USDC.");
    expect(message.startsWith("Mainnet E2E FAIL")).toBe(true);
  });

  test("an unset webhook is a notice, not a failure, and posts nothing", async () => {
    const { calls, posted } = await run({ ...passing(), SLACK_MAINNET_E2E_WEBHOOK_URL: "" });
    expect(posted).toEqual([]);
    expect(calls.map(({ kind }) => kind)).toEqual(["notice"]);
  });

  test("a webhook that is not a Slack incoming webhook fails before any request", async () => {
    for (const url of [
      "http://hooks.slack.com/services/T0/B0/x",
      "https://hooks.slack.com.evil.example/services/T0/B0/x",
      "https://hooks.slack.com/workflows/T0/x",
      `${WEBHOOK}\nhttps://evil.example`,
      `${WEBHOOK}?x=1`,
    ]) {
      const { calls, posted } = await run({ ...passing(), SLACK_MAINNET_E2E_WEBHOOK_URL: url });
      expect(posted).toEqual([]);
      expect(calls.map(({ kind }) => kind)).toEqual(["secret", "failed"]);
      expect(calls[1]?.message).not.toContain(url);
    }
  });

  test("a Slack error or network failure warns and leaves the run result alone", async () => {
    const rejected = await run(passing(), async () => new Response("no", { status: 404 }));
    expect(rejected.calls.at(-1)).toEqual({
      kind: "warning",
      message:
        "Slack did not accept the mainnet E2E result (HTTP 404); the run result is unchanged.",
    });
    const offline = await run(passing(), async () => {
      throw new Error(`connect failed ${WEBHOOK}`);
    });
    expect(offline.calls.at(-1)?.kind).toBe("warning");
    expect(offline.calls.some(({ kind }) => kind === "failed")).toBe(false);
    expect(offline.calls.at(-1)?.message).not.toContain("hooks.slack.com");
  });
});
