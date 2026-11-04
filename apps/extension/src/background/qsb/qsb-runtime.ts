/**
 * Background-only adapter for the pinned QSB Python pipeline (qsb-app's
 * `public/qsb`) running in Pyodide inside the MV3 service worker.
 *
 * Trust boundary: the interpreter and every Python source come from the
 * extension package, and every source is checked against the pinned
 * `manifest.json` SHA-256 before Python can see it — the same refusal qsb-app's
 * own runtime (`src/lib/qsb-runtime.ts`) applies. Wallet randomness and secret
 * material belong to Krusty KMS, so this adapter exposes no bridge call that
 * draws or holds HORS secrets (`generate`, `setup`, `adopt`); it runs one
 * deterministic, public-only probe over fixed inputs.
 *
 * Fails closed: an unreadable or mismatched source, a manifest that names any
 * file other than the four sources, an interpreter that fails to load, or a
 * probe result of the wrong shape each reject with a fixed message (the raw
 * Python traceback stays in `cause`). A failed start is forgotten, so the next
 * call boots a fresh interpreter instead of reusing a half-started one.
 */

/**
 * The pipeline sources, in the order qsb-app writes them into the interpreter.
 * `scripts/check-qsb-runtime.ts` reads this list, so the build gate and the
 * runtime agree on which files the manifest must cover.
 */
export const QSB_SOURCES = [
  "bitcoin_tx.py",
  "secp256k1.py",
  "qsb_pipeline.py",
  "bridge.py",
] as const;

// One of the pinned pipeline sources.
type QsbSource = (typeof QSB_SOURCES)[number];

/** The pinned SHA-256 manifest shipped beside the sources. */
export const QSB_MANIFEST = "manifest.json";

// A file the runtime reads from the extension package.
type QsbPackagedFile = QsbSource | typeof QSB_MANIFEST;

/**
 * The slice of a loaded Pyodide interpreter the adapter drives. Narrow on
 * purpose: no `pyimport`, no package loading, nothing that reaches the network.
 */
export type QsbInterpreter = {
  readonly FS: { readonly writeFile: (path: string, data: Uint8Array) => void };
  readonly registerJsModule: (name: string, module: object) => void;
  readonly runPythonAsync: (code: string) => Promise<unknown>;
};

/**
 * Collaborators the worker injects. Each must stay inside the extension
 * package: `loadInterpreter` boots Pyodide from packaged files only, and
 * `readFile` returns the bytes of one packaged QSB file or rejects.
 */
export type QsbRuntimeDeps = {
  readonly loadInterpreter: () => Promise<QsbInterpreter>;
  readonly readFile: (file: QsbPackagedFile) => Promise<Uint8Array>;
  /**
   * RIPEMD-160 for the pipeline's HASH160. Pyodide 0.29.3's `hashlib` has no
   * OpenSSL and cannot provide it, so — exactly as in qsb-app — the pipeline's
   * `secp256k1.ripemd160` is rebound to this JavaScript function.
   */
  readonly ripemd160: (bytes: Uint8Array) => Uint8Array;
};

/**
 * The public-only known-answer computation: SHA-256d of the empty string, the
 * pipeline's valid small-r x-coordinates (the field arithmetic behind Config
 * A's public dummy signatures), and the script push of twenty zero bytes.
 */
export type QsbPublicProbe = {
  readonly push20: string;
  readonly sha256dEmpty: string;
  readonly validSmallR: readonly number[];
};

/** The QSB runtime the worker holds; it boots its interpreter on first use. */
export type QsbRuntime = {
  /** Runs the public-only probe; boots and verifies the interpreter first if needed. */
  readonly publicProbe: () => Promise<QsbPublicProbe>;
};

/**
 * The HASH160 provider for a build that has not chosen one: every call
 * refuses, so no pipeline path can silently hash with something else.
 */
export const refuseRipemd160 = (): Uint8Array => {
  throw new Error("QSB RIPEMD-160 provider is not wired in this build");
};

const HEX_DIGEST = /^[0-9a-f]{64}$/;
const EVEN_HEX = /^(?:[0-9a-f]{2})*$/;

// qsb-app's startup, verbatim: rebind the pipeline's RIPEMD-160 (and the
// HASH160 built on it) to the JavaScript module before anything imports
// `bitcoin_tx`, whose `from secp256k1 import hash160` binds at import time.
const STARTUP = [
  "import sys",
  "sys.path.insert(0, '.')",
  "import hashlib",
  "import qsb_hash",
  "import secp256k1",
  "secp256k1.ripemd160 = lambda data: bytes.fromhex(qsb_hash.ripemd(data.hex()))",
  "secp256k1.hash160 = lambda data: secp256k1.ripemd160(hashlib.sha256(data).digest())",
  "import bridge",
].join("\n");

// Fixed public inputs only: no bridge method, no `os.urandom`, no file writes.
const PUBLIC_PROBE = [
  "import json",
  "import bitcoin_tx",
  "import secp256k1",
  "json.dumps({",
  "    'push20': bitcoin_tx.push_data(bytes(20)).hex(),",
  "    'sha256dEmpty': secp256k1.sha256d(b'').hex(),",
  "    'validSmallR': bitcoin_tx._valid_small_r_values(),",
  "})",
].join("\n");

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array => {
  if (!EVEN_HEX.test(hex)) {
    throw new Error("QSB hash input is not lowercase hex");
  }
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parses the pinned manifest into one digest per source. Refuses anything that
 * is not exactly the four sources mapped to lowercase SHA-256 hex: an extra
 * entry is a file someone expected to run, and this runtime runs none.
 */
const manifestDigests = (bytes: Uint8Array): ReadonlyMap<QsbSource, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("QSB source manifest is not JSON", { cause: error });
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== QSB_SOURCES.length) {
    throw new Error("QSB source manifest does not list exactly the pinned sources");
  }
  const digests = new Map<QsbSource, string>();
  for (const source of QSB_SOURCES) {
    const digest = parsed[source];
    if (typeof digest !== "string" || !HEX_DIGEST.test(digest)) {
      throw new Error("QSB source manifest does not list exactly the pinned sources");
    }
    digests.set(source, digest);
  }
  return digests;
};

/**
 * Reads and verifies every source before writing any into the interpreter, so
 * Python never starts with a partial or mixed set.
 */
const verifiedSources = async (
  readFile: QsbRuntimeDeps["readFile"],
): Promise<readonly (readonly [QsbSource, Uint8Array])[]> => {
  const digests = manifestDigests(await readFile(QSB_MANIFEST));
  const sources: (readonly [QsbSource, Uint8Array])[] = [];
  for (const source of QSB_SOURCES) {
    const bytes = await readFile(source);
    if ((await sha256Hex(bytes)) !== digests.get(source)) {
      throw new Error("QSB source integrity check failed");
    }
    sources.push([source, bytes]);
  }
  return sources;
};

const boot = async (deps: QsbRuntimeDeps): Promise<QsbInterpreter> => {
  const sources = await verifiedSources(deps.readFile);
  let python: QsbInterpreter;
  try {
    python = await deps.loadInterpreter();
  } catch (error) {
    throw new Error("QSB interpreter failed to load", { cause: error });
  }
  for (const [source, bytes] of sources) {
    python.FS.writeFile(source, bytes);
  }
  python.registerJsModule("qsb_hash", {
    ripemd: (hex: string): string => toHex(deps.ripemd160(fromHex(hex))),
  });
  try {
    await python.runPythonAsync(STARTUP);
  } catch (error) {
    throw new Error("QSB pipeline failed to start", { cause: error });
  }
  return python;
};

const isSmallR = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 127;

const probeResult = (raw: unknown): QsbPublicProbe => {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed["push20"] !== "string" ||
    !EVEN_HEX.test(parsed["push20"]) ||
    typeof parsed["sha256dEmpty"] !== "string" ||
    !HEX_DIGEST.test(parsed["sha256dEmpty"]) ||
    !Array.isArray(parsed["validSmallR"]) ||
    !parsed["validSmallR"].every(isSmallR)
  ) {
    throw new Error("QSB public probe returned an unexpected shape");
  }
  return {
    push20: parsed["push20"],
    sha256dEmpty: parsed["sha256dEmpty"],
    validSmallR: [...parsed["validSmallR"]],
  };
};

/**
 * Creates the lazy QSB runtime. Nothing loads until the first call; one
 * interpreter then serves every call for the life of the worker, and a worker
 * restart (idle termination, update) starts cold again.
 */
export const createQsbRuntime = (deps: QsbRuntimeDeps): QsbRuntime => {
  let started: Promise<QsbInterpreter> | undefined;
  const interpreter = (): Promise<QsbInterpreter> => {
    started ??= boot(deps).catch((error: unknown) => {
      started = undefined;
      throw error;
    });
    return started;
  };
  return {
    publicProbe: async () => {
      const python = await interpreter();
      let raw: unknown;
      try {
        raw = await python.runPythonAsync(PUBLIC_PROBE);
      } catch (error) {
        throw new Error("QSB public probe failed", { cause: error });
      }
      return probeResult(raw);
    },
  };
};
