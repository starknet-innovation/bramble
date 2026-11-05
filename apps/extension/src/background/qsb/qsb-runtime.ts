/**
 * Background-only adapter for the pinned QSB Python pipeline (qsb-app's
 * `public/qsb`) running in Pyodide inside the MV3 service worker.
 *
 * Trust boundary: the interpreter and every Python source come from the
 * extension package, and every source is checked against the pinned
 * `manifest.json` SHA-256 before Python can see it — the same refusal qsb-app's
 * own runtime (`src/lib/qsb-runtime.ts`) applies. Wallet randomness and secret
 * material belong to Krusty KMS, so this adapter exposes no bridge call that
 * draws or holds HORS secrets (`generate`, `setup`, `adopt`): it runs a
 * deterministic public-only probe; `setup_from_commitments`, which builds a
 * vault script from public commitments alone; and the two-phase withdrawal
 * assembly, `prepare` (public inputs only) and `finish`, which reads the 15
 * preimages Krusty released for an exposure already durably recorded. After
 * `finish`, succeed or fail, the interpreter is dropped, so the next call boots
 * a fresh one and no preimage stays in this worker's Python heap. Pyodide
 * offers no erasure, so that is the most this adapter can claim.
 *
 * Caller data never becomes Python source. A request reaches Python only
 * through the registered `qsb_request` module, whose one function hands over
 * the JSON text of the call in progress; every Python string this adapter runs
 * is a constant. Calls run one at a time, so a request can only ever be read
 * by the call that set it.
 *
 * Fails closed: an unreadable or mismatched source, a manifest that names any
 * file other than the four sources, an interpreter that fails to load, a
 * malformed request, or a reply of the wrong shape each reject with a fixed
 * message (a raw Python traceback stays in `cause`). A failed start is
 * forgotten, so the next call boots a fresh interpreter instead of reusing a
 * half-started one.
 */
import { bytesToHex, hexToBytes, isLowercaseHexBytes } from "@bramble/core/hex";
import { isRecord } from "@bramble/core/json";
import {
  type QsbHorsCommitments,
  type QsbVaultSetup,
  readQsbCommitmentRequest,
  readQsbVaultSetup,
} from "./qsb-vault-setup";
import {
  type QsbPreparedWithdrawal,
  readQsbFinished,
  readQsbFinishRequest,
  readQsbPrepared,
  readQsbPrepareRequest,
} from "./qsb-withdrawal-assembly";

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
 * purpose: no `pyimport`, no globals, no package loading, nothing that reaches
 * the network.
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
 * The public-only known-answer computation: SHA-256d of the empty string,
 * HASH160 of the empty string through the rebound RIPEMD-160 (the hash setup
 * runs for every HORS slot), the pipeline's valid small-r x-coordinates (the
 * field arithmetic behind Config A's public dummy signatures), and the script
 * push of twenty zero bytes.
 */
export type QsbPublicProbe = {
  readonly hash160Empty: string;
  readonly push20: string;
  readonly sha256dEmpty: string;
  readonly validSmallR: readonly number[];
};

/** The QSB runtime the worker holds; it boots its interpreter on first use. */
export type QsbRuntime = {
  /** Runs the public-only probe; boots and verifies the interpreter first if needed. */
  readonly publicProbe: () => Promise<QsbPublicProbe>;
  /**
   * Builds the Config A vault for one vault's HORS commitments with the pinned
   * bridge. The commitments are checked before anything boots, and the reply
   * is checked against them (see `./qsb-vault-setup`); either refusal rejects
   * with a fixed message.
   */
  readonly setupFromCommitments: (commitments: QsbHorsCommitments) => Promise<QsbVaultSetup>;
  /**
   * Phase one of a withdrawal: `T` and the indices to disclose for a vault's
   * public state, a manifest and a solution (each JSON text), with no secret.
   * Requests and the reply are checked (see `./qsb-withdrawal-assembly`).
   */
  readonly prepare: (
    publicStateJson: string,
    manifestJson: string,
    solutionJson: string,
  ) => Promise<QsbPreparedWithdrawal>;
  /**
   * Phase two: the raw transaction for `prepared` and exactly its 15
   * preimages, round 0's then round 1's. Drops the interpreter afterwards,
   * whatever the outcome.
   */
  readonly finish: (
    prepared: QsbPreparedWithdrawal,
    preimages: readonly string[],
  ) => Promise<string>;
};

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
// `bitcoin_tx.hash160` is the binding setup calls, so the probe shows the
// rebinding reached it.
const PUBLIC_PROBE = [
  "import json",
  "import bitcoin_tx",
  "import secp256k1",
  "json.dumps({",
  "    'hash160Empty': bitcoin_tx.hash160(b'').hex(),",
  "    'push20': bitcoin_tx.push_data(bytes(20)).hex(),",
  "    'sha256dEmpty': secp256k1.sha256d(b'').hex(),",
  "    'validSmallR': bitcoin_tx._valid_small_r_values(),",
  "})",
].join("\n");

// The request is read from `qsb_request`, never written into this source.
const SETUP_FROM_COMMITMENTS = [
  "import bridge",
  "import qsb_request",
  "bridge.setup_from_commitments(qsb_request.commitments_json())",
].join("\n");

// Each argument is JSON text inside one JSON list the module hands over.
const PREPARE = [
  "import bridge",
  "import json",
  "import qsb_request",
  "bridge.prepare(*json.loads(qsb_request.arguments_json()))",
].join("\n");

const FINISH = [
  "import bridge",
  "import json",
  "import qsb_request",
  "bridge.finish(*json.loads(qsb_request.arguments_json()))",
].join("\n");

// The one way a request reaches Python: `commitments_json` (a setup's) or
// `arguments_json` (a withdrawal call's) hands the pending JSON text over once
// and refuses when no call has set one.
type QsbRequestChannel = {
  readonly module: object;
  readonly hold: (json: string) => void;
  readonly release: () => void;
};

const requestChannel = (): QsbRequestChannel => {
  let pending: string | undefined;
  const take = (): string => {
    const json = pending;
    pending = undefined;
    if (json === undefined) {
      throw new Error("QSB runtime has no request in progress");
    }
    return json;
  };
  return {
    hold: (json) => {
      pending = json;
    },
    module: {
      arguments_json: (): string => take(),
      commitments_json: (): string => take(),
    },
    release: () => {
      pending = undefined;
    },
  };
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));

const isSha256Hex = (value: unknown): value is string => isLowercaseHexBytes(value, 32, 32);

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
    if (!isSha256Hex(digest)) {
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

const hashModule = (ripemd160: QsbRuntimeDeps["ripemd160"]): object => ({
  ripemd: (hex: string): string => {
    const bytes = hexToBytes(hex);
    if (bytes === null) {
      throw new Error("QSB hash input is not lowercase hex");
    }
    return bytesToHex(ripemd160(bytes));
  },
});

const boot = async (deps: QsbRuntimeDeps, request: object): Promise<QsbInterpreter> => {
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
  python.registerJsModule("qsb_hash", hashModule(deps.ripemd160));
  python.registerJsModule("qsb_request", request);
  try {
    await python.runPythonAsync(STARTUP);
  } catch (error) {
    throw new Error("QSB pipeline failed to start", { cause: error });
  }
  return python;
};

// Runs one constant Python string; a Python exception becomes `failure`'s
// fixed message, with the traceback kept only as its cause.
const runPython = async (
  python: QsbInterpreter,
  code: string,
  failure: (cause: unknown) => Error,
): Promise<unknown> => {
  try {
    return await python.runPythonAsync(code);
  } catch (error) {
    throw failure(error);
  }
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
    !isLowercaseHexBytes(parsed["hash160Empty"], 20, 20) ||
    !isLowercaseHexBytes(parsed["push20"], 1, 32) ||
    !isSha256Hex(parsed["sha256dEmpty"]) ||
    !Array.isArray(parsed["validSmallR"]) ||
    !parsed["validSmallR"].every(isSmallR)
  ) {
    throw new Error("QSB public probe returned an unexpected shape");
  }
  return {
    hash160Empty: parsed["hash160Empty"],
    push20: parsed["push20"],
    sha256dEmpty: parsed["sha256dEmpty"],
    validSmallR: [...parsed["validSmallR"]],
  };
};

/**
 * Creates the lazy QSB runtime. Nothing loads until the first call; one
 * interpreter then serves every call for the life of the worker, and a worker
 * restart (idle termination, update) starts cold again. Calls queue: each runs
 * its Python only after the previous call has finished, failed or not.
 */
export const createQsbRuntime = (deps: QsbRuntimeDeps): QsbRuntime => {
  const request = requestChannel();
  let started: Promise<QsbInterpreter> | undefined;
  const interpreter = (): Promise<QsbInterpreter> => {
    started ??= boot(deps, request.module).catch((error: unknown) => {
      started = undefined;
      throw error;
    });
    return started;
  };
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: (python: QsbInterpreter) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => task(await interpreter()));
    queue = run.catch(() => undefined);
    return run;
  };
  // One call with its arguments held for exactly as long as it runs.
  const call = (
    python: QsbInterpreter,
    code: string,
    json: string,
    failure: string,
  ): Promise<unknown> => {
    request.hold(json);
    return runPython(python, code, (cause) => new Error(failure, { cause })).finally(
      request.release,
    );
  };
  return {
    finish: async (prepared, preimages) => {
      const json = readQsbFinishRequest(prepared, preimages);
      const raw = await exclusive(async (python) => {
        try {
          return await call(python, FINISH, json, "QSB withdrawal finish failed");
        } finally {
          // The interpreter has held preimages: never reuse it.
          started = undefined;
        }
      });
      return readQsbFinished(raw);
    },
    prepare: async (publicStateJson, manifestJson, solutionJson) => {
      const checked = readQsbPrepareRequest(publicStateJson, manifestJson, solutionJson);
      const raw = await exclusive((python) =>
        call(python, PREPARE, checked.json, "QSB withdrawal prepare failed"),
      );
      return readQsbPrepared(raw, checked);
    },
    publicProbe: () =>
      exclusive(async (python) =>
        probeResult(
          await runPython(
            python,
            PUBLIC_PROBE,
            (cause) => new Error("QSB public probe failed", { cause }),
          ),
        ),
      ),
    setupFromCommitments: async (commitments) => {
      const checked = readQsbCommitmentRequest(commitments);
      const raw = await exclusive(async (python) => {
        request.hold(checked.json);
        try {
          return await runPython(
            python,
            SETUP_FROM_COMMITMENTS,
            (cause) => new Error("QSB commitments setup failed", { cause }),
          );
        } finally {
          request.release();
        }
      });
      return readQsbVaultSetup(raw, checked);
    },
  };
};
