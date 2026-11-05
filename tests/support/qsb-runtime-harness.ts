/**
 * A fake Pyodide interpreter and packaged files for the QSB runtime adapter
 * suites. The fake answers by what the adapter asks: the startup returns
 * nothing, the probe returns `probe`, and a commitments setup first reads its
 * request through the registered `qsb_request` module — the only way the
 * adapter hands Python data — then returns `setup(request)`; a withdrawal
 * `prepare` or `finish` reads its arguments the same way and returns
 * `prepare(args)` or `finish(args)`. Every code string, module and file the
 * adapter hands it is recorded.
 */
import { createHash } from "node:crypto";
import { ripemd160 } from "@noble/hashes/legacy.js";
import {
  QSB_MANIFEST,
  QSB_SOURCES,
  type QsbInterpreter,
  type QsbRuntimeDeps,
} from "../../apps/extension/src/background/qsb/qsb-runtime";
import { QSB_PUBLIC_PROBE_ANSWERS } from "../../scripts/qsb-known-answers";

const encoder = new TextEncoder();

/** SHA-256 of bytes or text, lowercase hex. */
export const digest = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Stand-in pipeline sources: one short, distinct file per source. */
export const sourceBytes = Object.fromEntries(
  QSB_SOURCES.map((source) => [source, encoder.encode(`# ${source}\n`)]),
) as Readonly<Record<string, Uint8Array>>;

/** A manifest file with exactly `entries`. */
export const manifestFor = (entries: Readonly<Record<string, unknown>>): Uint8Array =>
  encoder.encode(JSON.stringify(entries));

/** The manifest that pins {@link sourceBytes}. */
export const pinnedManifest = manifestFor(
  Object.fromEntries(
    QSB_SOURCES.map((source) => [source, digest(sourceBytes[source] ?? new Uint8Array())]),
  ),
);

/**
 * A full-size stand-in vault script: 300 pushes of 20 distinct bytes and a
 * closing OP_CHECKSIG, 6,301 bytes, so no length bound can pass by accident.
 */
export const FAKE_SCRIPT = `${Array.from(
  { length: 300 },
  (_, index) => `14${digest(`fake-script/${index}`).slice(0, 40)}`,
).join("")}ac`;

/**
 * A well-formed bridge reply for `requestJson`, with `fields` and `state`
 * overriding the reply's fields and the public state's.
 */
export const vaultReply = (
  requestJson: string,
  fields: Readonly<Record<string, unknown>> = {},
  state: Readonly<Record<string, unknown>> = {},
): string =>
  JSON.stringify({
    publicStateJson: JSON.stringify({
      config: "A",
      full_script_hex: FAKE_SCRIPT,
      hors_commitments: JSON.parse(requestJson),
      ...state,
    }),
    scriptHash: digest(Buffer.from(FAKE_SCRIPT, "hex")),
    scriptHex: FAKE_SCRIPT,
    ...fields,
  });

/** 2 × 150 distinct, full-length commitments derived from `label`. */
export const commitmentsFor = (label: string): string[][] =>
  [0, 1].map((round) =>
    Array.from({ length: 150 }, (_, index) => digest(`${label}/${round}/${index}`).slice(0, 40)),
  );

/** What the fake does for each kind of Python the adapter runs. */
export type FakeReplies = {
  readonly probe?: unknown;
  readonly setup?: (requestJson: string) => unknown;
  /** `bridge.prepare`'s reply to its three JSON-text arguments. */
  readonly prepare?: (args: readonly string[]) => unknown;
  /** `bridge.finish`'s reply to its two JSON-text arguments. */
  readonly finish?: (args: readonly string[]) => unknown;
};

/** A fake interpreter and everything the adapter gave it. */
export type FakePython = {
  readonly python: QsbInterpreter;
  readonly ran: string[];
  readonly registered: Map<string, object>;
  readonly requests: string[];
  readonly written: string[];
};

/** Reads a function the adapter registered as `module.name`, or throws. */
export const registeredFunction = (
  fake: FakePython,
  module: string,
  name: string,
): ((...args: unknown[]) => unknown) => {
  const value = (fake.registered.get(module) as Record<string, unknown> | undefined)?.[name];
  if (typeof value !== "function") {
    throw new Error(`${module}.${name} was not registered`);
  }
  return value as (...args: unknown[]) => unknown;
};

/** A fake interpreter answering with `replies` (see the module comment). */
export const fakePython = (replies: FakeReplies = {}): FakePython => {
  const fake: FakePython = {
    python: {
      FS: { writeFile: (path) => void fake.written.push(path) },
      registerJsModule: (name, module) => void fake.registered.set(name, module),
      runPythonAsync: async (code) => {
        fake.ran.push(code);
        if (code.includes("setup_from_commitments")) {
          // Yield first, as Pyodide does, so an unserialized second call
          // would get the chance to overwrite this one's request.
          await Promise.resolve();
          const request = String(registeredFunction(fake, "qsb_request", "commitments_json")());
          fake.requests.push(request);
          return (replies.setup ?? vaultReply)(request);
        }
        for (const [call, reply] of [
          ["bridge.prepare(", replies.prepare],
          ["bridge.finish(", replies.finish],
        ] as const) {
          if (code.includes(call)) {
            await Promise.resolve();
            const request = String(registeredFunction(fake, "qsb_request", "arguments_json")());
            fake.requests.push(request);
            if (!reply) throw new Error(`no reply for ${call}`);
            return reply(JSON.parse(request) as string[]);
          }
        }
        if (code.includes("json.dumps(")) {
          return "probe" in replies ? replies.probe : JSON.stringify(QSB_PUBLIC_PROBE_ANSWERS);
        }
        return undefined;
      },
    },
    ran: [],
    registered: new Map(),
    requests: [],
    written: [],
  };
  return fake;
};

/**
 * Runtime collaborators over `fake` and `files` (the pinned stand-ins by
 * default), with noble's RIPEMD-160 as the worker wires it, and a count of
 * interpreter loads.
 */
export const runtimeDeps = (
  overrides: Partial<QsbRuntimeDeps> & { readonly files?: Readonly<Record<string, Uint8Array>> },
  fake: FakePython = fakePython(),
): { readonly deps: QsbRuntimeDeps; readonly loads: () => number } => {
  let loads = 0;
  const { files = { ...sourceBytes, [QSB_MANIFEST]: pinnedManifest }, ...deps } = overrides;
  return {
    deps: {
      loadInterpreter: async () => {
        loads += 1;
        return fake.python;
      },
      readFile: async (file) => {
        const bytes = files[file];
        if (bytes === undefined) {
          throw new Error(`missing ${file}`);
        }
        return bytes;
      },
      ripemd160,
      ...deps,
    },
    loads: () => loads,
  };
};
