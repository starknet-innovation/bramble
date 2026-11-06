/**
 * Record and replay of the network traffic behind a Sepolia verification run
 * (verify-sepolia.ts, issue 821). A live run can record every HTTP answer the
 * extension received into a tape; a later run replays that tape with the
 * suite's DNS blackhole in place, so the same checks run offline, without rate
 * limits, against exactly the chain state the tape saw.
 *
 * A tape holds requests and answers only: addresses, public keys, class hashes
 * and visible errors. The run is read-only, so no signature or key is sent;
 * `writeTape` still refuses a tape the redactor would change. JSON-RPC ids are
 * dropped from the key and written back on replay, so a replay matches however
 * the wallet numbers its calls. Repeated identical requests are answered in the
 * order recorded, the last answer repeating. A request the tape lacks is
 * aborted as unresolvable, as the blackhole would, and listed in `missing`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { BrowserContext, Route } from "@playwright/test";
import { redact } from "./sepolia-redact";

/** One recorded answer. */
export type TapeAnswer = {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
};

/** Request key → answers, in the order they arrived. */
export type Tape = Record<string, TapeAnswer[]>;

const NETWORK = /^https?:\/\//;

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const withoutId = (call: unknown): unknown => {
  if (call === null || typeof call !== "object" || Array.isArray(call)) return call;
  const { id: _id, ...rest } = call as Record<string, unknown>;
  return rest;
};

/** The tape key for a request: method, URL and body, with JSON-RPC ids removed. */
export const tapeKey = (method: string, url: string, body: string | null): string => {
  const json = body === null ? undefined : parse(body);
  const shape = Array.isArray(json) ? json.map(withoutId) : withoutId(json);
  return `${method} ${url} ${json === undefined ? (body ?? "") : JSON.stringify(shape)}`;
};

const idOf = (call: unknown): unknown =>
  call !== null && typeof call === "object" ? (call as { id?: unknown }).id : undefined;

/**
 * `answer` with the JSON-RPC ids of `request` written back in: a single call
 * takes the request's id, and a batch takes each call's id by position. A body
 * that is not JSON-RPC is returned unchanged.
 */
export const withRequestIds = (request: string | null, answer: string): string => {
  const sent = request === null ? undefined : parse(request);
  const got = parse(answer);
  if (got === undefined || got === null || typeof got !== "object") return answer;
  if (Array.isArray(sent) && Array.isArray(got)) {
    return JSON.stringify(got.map((item, i) => ({ ...item, id: idOf(sent[i]) })));
  }
  if (!Array.isArray(sent) && !Array.isArray(got) && idOf(sent) !== undefined) {
    return JSON.stringify({ ...got, id: idOf(sent) });
  }
  return answer;
};

const keyOfRoute = (route: Route): string => {
  const request = route.request();
  return tapeKey(request.method(), request.url(), request.postData());
};

/**
 * Forwards every request to the network and records its answer. Returns the
 * tape, which fills as the run goes on. A request that gets no answer at all
 * (DNS, reset, timeout) is aborted and left off the tape, so a replay of it
 * fails the same way.
 */
export const recordTape = async (context: BrowserContext): Promise<Tape> => {
  const tape: Tape = {};
  await context.route(NETWORK, async (route) => {
    let response: Awaited<ReturnType<Route["fetch"]>>;
    let body: string;
    try {
      response = await route.fetch();
      body = await response.text();
    } catch {
      await route.abort("failed");
      return;
    }
    const key = keyOfRoute(route);
    tape[key] = [
      ...(tape[key] ?? []),
      { status: response.status(), contentType: response.headers()["content-type"] ?? "", body },
    ];
    await route.fulfill({ response, body });
  });
  return tape;
};

/**
 * Answers every request from `tape` and never reaches the network. Returns the
 * keys the tape could not answer, which grows as the run goes on.
 */
export const replayTape = async (context: BrowserContext, tape: Tape): Promise<Set<string>> => {
  const missing = new Set<string>();
  const served = new Map<string, number>();
  await context.route(NETWORK, async (route) => {
    const key = keyOfRoute(route);
    const answers = tape[key];
    if (!answers?.length) {
      missing.add(key);
      await route.abort("namenotresolved");
      return;
    }
    const n = served.get(key) ?? 0;
    served.set(key, n + 1);
    const answer = answers[Math.min(n, answers.length - 1)] as TapeAnswer;
    await route.fulfill({
      status: answer.status,
      contentType: answer.contentType,
      body: withRequestIds(route.request().postData(), answer.body),
    });
  });
  return missing;
};

/** Reads a tape written by {@link writeTape}. Throws if the file is missing or malformed. */
export const readTape = (path: string): Tape => JSON.parse(readFileSync(path, "utf8")) as Tape;

/**
 * Writes `tape` with its keys sorted, so two recordings diff line by line.
 * Throws, writing nothing, if any part of it matches a registered secret.
 */
export const writeTape = (path: string, tape: Tape): void => {
  const sorted = Object.fromEntries(Object.entries(tape).sort(([a], [b]) => a.localeCompare(b)));
  const text = `${JSON.stringify(sorted, null, 1)}\n`;
  if (redact(text) !== text) throw new Error("the tape carries a secret; not written");
  writeFileSync(path, text, { mode: 0o600 });
};
