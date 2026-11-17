/**
 * Where the Mainnet E2E workflow may reference a repository secret.
 *
 * Every decoded key and string value in the whole document is scanned with
 * the shared reader in `workflow-secret-references.ts`: all jobs, `run`,
 * `with`, job- and workflow-level `env`, `if`, `outputs`, keys included. A
 * reference counts only when it is one of the reviewed bindings below: a
 * step-level `env` value in the named job and step, under the named variable,
 * spelled exactly `${{ secrets.NAME }}`, and used once. Every reviewed
 * binding must also be present, so the hot-wallet key reaches exactly five
 * step env values, all in `execute`, and the RPC URL reaches only the
 * balance steps and `execute`.
 */
import { ANY_SECRET, type SecretReference, secretReferences } from "./workflow-secret-references";

const PATH = ".github/workflows/mainnet-e2e.yml";
const KEY = "MAINNET_E2E_PRIVATE_KEY";
const RPC = "MAINNET_E2E_RPC_URL";
const DISCOVERY = "MAINNET_E2E_DISCOVERY_URL";
const PROVER = "MAINNET_E2E_PROVER_URL";

type Bindings = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
>;

/** Job → step id → env variable → the secret it is bound to. */
const BINDINGS: Bindings = {
  preflight: { balance: { MAINNET_E2E_RPC_URL: RPC } },
  post: { balance: { MAINNET_E2E_RPC_URL: RPC } },
  execute: {
    secrets: {
      MAINNET_E2E_PRIVATE_KEY: KEY,
      MAINNET_E2E_RPC_URL: RPC,
      MAINNET_E2E_DISCOVERY_URL: DISCOVERY,
      MAINNET_E2E_PROVER_URL: PROVER,
    },
    playwright: {
      BRAMBLE_MAINNET_E2E_PRIVATE_KEY: KEY,
      BRAMBLE_MAINNET_E2E_RPC_URL: RPC,
      BRAMBLE_STRK20_E2E_PRIVATE_KEY: KEY,
      BRAMBLE_STRK20_E2E_RPC_URL: RPC,
      BRAMBLE_STRK20_E2E_DISCOVERY_URL: DISCOVERY,
      BRAMBLE_STRK20_E2E_PROVER_URL: PROVER,
      GASLESS_E2E_PRIVATE_KEY: KEY,
      GASLESS_E2E_RPC_URL: RPC,
    },
    gasless: { GASLESS_E2E_PRIVATE_KEY: KEY, GASLESS_E2E_RPC_URL: RPC },
  },
};

/** The number of step env values the hot-wallet key is bound to. */
export const HOT_WALLET_BINDINGS = Object.values(BINDINGS)
  .flatMap((steps) => Object.values(steps))
  .flatMap((env) => Object.values(env))
  .filter((secret) => secret === KEY).length;

const KEY_COUNT = `${PATH} must bind the hot-wallet private key in exactly ${HOT_WALLET_BINDINGS} step env values, all in execute`;
const KEY_PLACE = `${PATH} must bind the hot-wallet private key only as a step env value`;
const RPC_PLACE = `${PATH} must bind the mainnet RPC URL only in its reviewed step env values`;
const OTHER_PLACE = `${PATH} must reference secrets only in their reviewed step env bindings`;

/** Failures specific to a job that must hold no secret, or not the key. */
const JOB_FAILURES: Readonly<Record<string, string>> = {
  build: "the mainnet build runs release code and must not receive any secret",
  report: "the hosted mainnet reporter must not receive mainnet secrets",
};

const isStepEnvValue = ({ path, key }: SecretReference): boolean =>
  !key && path.length === 6 && path[0] === "jobs" && path[2] === "steps" && path[4] === "env";

const stepId = (document: unknown, job: unknown, index: unknown): unknown => {
  const jobs = (document as { jobs?: Record<string, { steps?: unknown[] }> }).jobs;
  const step = jobs?.[String(job)]?.steps?.[Number(index)];
  return typeof step === "object" && step !== null ? (step as { id?: unknown }).id : undefined;
};

const failuresFor = (reference: SecretReference): string[] => {
  const [, job] = reference.path;
  const failures: string[] = [];
  const named = (secret: string): boolean =>
    reference.secret === secret || reference.secret === ANY_SECRET;
  if (named(KEY)) failures.push(isStepEnvValue(reference) ? KEY_COUNT : KEY_PLACE);
  if (named(KEY) && (job === "preflight" || job === "post")) {
    failures.push(`the ${job} balance check must run trusted main code without the key`);
  }
  if (named(RPC)) failures.push(RPC_PLACE);
  if (!named(KEY) && !named(RPC)) failures.push(OTHER_PLACE);
  const specific = JOB_FAILURES[String(job)];
  if (reference.path[0] === "jobs" && specific !== undefined) failures.push(specific);
  return failures;
};

const missingFailure = (secret: string): string =>
  secret === KEY ? KEY_COUNT : secret === RPC ? RPC_PLACE : OTHER_PLACE;

/**
 * Violations of the reviewed secret bindings in a decoded workflow document:
 * each reference outside them, and each reviewed binding that is missing or
 * respelled. Pure: it reads only the value it is given.
 */
export const mainnetE2eSecretFailures = (document: unknown): string[] => {
  const failures: string[] = [];
  const used = new Set<string>();
  for (const reference of secretReferences(document)) {
    const [, job, , index, , variable] = reference.path;
    const id = isStepEnvValue(reference) ? stepId(document, job, index) : undefined;
    const bound =
      typeof id === "string" ? BINDINGS[String(job)]?.[id]?.[String(variable)] : undefined;
    const slot = `${String(job)}/${String(id)}/${String(variable)}`;
    if (
      bound === undefined ||
      reference.secret !== bound ||
      reference.text !== `\${{ secrets.${bound} }}` ||
      used.has(slot)
    ) {
      failures.push(...failuresFor(reference));
    } else {
      used.add(slot);
    }
  }
  for (const [job, steps] of Object.entries(BINDINGS)) {
    for (const [id, env] of Object.entries(steps)) {
      for (const [variable, secret] of Object.entries(env)) {
        if (!used.has(`${job}/${id}/${variable}`)) failures.push(missingFailure(secret));
      }
    }
  }
  return failures;
};
