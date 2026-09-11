/**
 * The activation proof and every confirmed execution run as tracked jobs.
 *
 * The shield's proof moved onto the job registry first (see
 * ./strk20-preparation-jobs.test.ts); the same exposure remained on the two
 * proofs a user meets next — the registration proof at activation review, and
 * the proof a relayed send builds at confirm inside the relay hand-off, which
 * the public routes match with their pool-maturity wait before broadcast.
 * These pin that both answer their gate refusals on the request and their
 * outcomes on the poll, and — for execution — that the one-time preparation is
 * consumed exactly once: claimed on the request before any job exists, refused
 * on every later execute, and idempotent on every later poll of the hash.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { STRK20_JOB_INTERRUPTED } from "../../../apps/extension/src/background/privacy/strk20-preparation-jobs";
import { flushHeld } from "../../support/held";
import {
  buildStrk20Handler,
  makeStrk20Service,
  prepareStrk20Registration,
  STRK20_EXTENSION_SENDER,
  STRK20_TOKEN,
  strk20RunningJobId,
} from "../../support/strk20-background";

const deferred = <T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const preferences = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: {
    SN_SEPOLIA: {
      discoveryUrl: "https://discovery.example/strk20",
      poolAddress: "0x123",
      proverUrl: "https://prover.example/strk20",
    },
  },
});

const token = preferences().tokens.find(
  (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
);
if (!token) {
  throw new Error("Sepolia token fixture missing");
}

const poll = (jobId: string | null) => ({ jobId, type: "wallet.strk20PreparationStatus" });

const runningJob = (response: unknown): { readonly id: string; readonly phase?: string } => {
  const id = strk20RunningJobId(response);
  if (id === null) throw new Error(`not a running job: ${JSON.stringify(response)}`);
  const job = (response as { readonly strk20Job: { readonly phase?: string } }).strk20Job;
  return { id, ...(job.phase === undefined ? {} : { phase: job.phase }) };
};

describe("activation route through the job", () => {
  test("answers before the registration proof exists and settles on the review", async () => {
    const proof =
      deferred<Awaited<ReturnType<NonNullable<Strk20Service["prepareRegistration"]>>>>();
    const base = makeStrk20Service({ registered: false });
    const handler = buildStrk20Handler({
      preferences: preferences(),
      registered: false,
      strk20: { ...base, prepareRegistration: () => proof.promise },
    });

    const started = await handler(
      { type: "wallet.strk20PrepareRegistration" },
      STRK20_EXTENSION_SENDER,
    );
    const jobId = strk20RunningJobId(started);
    expect(jobId).not.toBeNull();
    await flushHeld();
    expect(runningJob(await handler(poll(jobId), STRK20_EXTENSION_SENDER))).toEqual({
      id: jobId ?? "",
      phase: "checking the public balance",
    });

    const built = await base.prepareRegistration?.({} as never);
    if (!built) throw new Error("service double did not build");
    proof.resolve(built);
    await flushHeld();
    const settled = (await handler(poll(jobId), STRK20_EXTENSION_SENDER)) as {
      readonly strk20Preparation?: { readonly id: string; readonly kind: string };
    };
    expect(settled.strk20Preparation?.kind).toBe("register");
    expect(settled.strk20Preparation?.id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("refuses at the gate on the request, and inside the job on the poll", async () => {
    // No pool on the active network: refused where the context is resolved,
    // on the request, without a job.
    const noPool = buildStrk20Handler({
      preferences: { ...preferences(), strk20Networks: {} },
      registered: false,
    });
    const refused = await noPool(
      { type: "wallet.strk20PrepareRegistration" },
      STRK20_EXTENSION_SENDER,
    );
    expect(refused).toEqual({ error: "Private balances are not configured for this network" });
    expect(strk20RunningJobId(refused)).toBeNull();

    // Already registered: decided by the service inside the job, so the start
    // answers with the job and the refusal is what the poll settles on.
    const registered = buildStrk20Handler({ preferences: preferences(), registered: true });
    const started = await registered(
      { type: "wallet.strk20PrepareRegistration" },
      STRK20_EXTENSION_SENDER,
    );
    expect(strk20RunningJobId(started)).not.toBeNull();
    await expect(prepareStrk20Registration(registered)).resolves.toEqual({
      error: "Private balances are already active",
    });
  });
});

describe("execution through the job", () => {
  const transfer = {
    amount: "0.5",
    recipient: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    tokenId: token.id,
    type: "wallet.strk20PrepareTransfer",
  };

  test("claims once on the request, proves inside the job, and returns the hash on every later poll", async () => {
    const relay = deferred<{ readonly transactionHash: string }>();
    const submissions = { value: 0 };
    const base = makeStrk20Service({ balance: "0xde0b6b3a7640000" });
    const handler = buildStrk20Handler({
      balance: "0xde0b6b3a7640000",
      preferences: preferences(),
      strk20: {
        ...base,
        async submitActions({ beforeProof }) {
          await beforeProof?.();
          submissions.value += 1;
          return relay.promise;
        },
      },
    });
    const prepared = (await handler(transfer, STRK20_EXTENSION_SENDER)) as {
      readonly strk20Preparation: { readonly id: string };
    };
    const preparationId = prepared.strk20Preparation.id;

    const started = await handler(
      { preparationId, type: "wallet.strk20Execute" },
      STRK20_EXTENSION_SENDER,
    );
    const jobId = strk20RunningJobId(started);
    expect(jobId).not.toBeNull();
    await flushHeld();
    expect(submissions.value).toBe(1);
    expect(runningJob(await handler(poll(jobId), STRK20_EXTENSION_SENDER))).toEqual({
      id: jobId ?? "",
      phase: "checking registration",
    });

    // The one-time claim happened on the request: a second execute for the same
    // preparation is refused there, while the first is still proving...
    await expect(
      handler({ preparationId, type: "wallet.strk20Execute" }, STRK20_EXTENSION_SENDER),
    ).resolves.toEqual({ error: "Privacy preparation not found" });

    relay.resolve({ transactionHash: "0x444" });
    await flushHeld();
    const settled = { ok: true as const, transactionHash: "0x444" };
    // ...and after it settled. Repeated polls return the stored hash; the
    // service is never asked to submit again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(handler(poll(jobId), STRK20_EXTENSION_SENDER)).resolves.toEqual(settled);
    }
    await expect(
      handler({ preparationId, type: "wallet.strk20Execute" }, STRK20_EXTENSION_SENDER),
    ).resolves.toEqual({ error: "Privacy preparation not found" });
    expect(submissions.value).toBe(1);
  });

  test("refuses at the gate on the request itself, without a job", async () => {
    const handler = buildStrk20Handler({ preferences: preferences() });
    for (const preparationId of ["bad", `sha256:${"a".repeat(64)}`]) {
      const refused = await handler(
        { preparationId, type: "wallet.strk20Execute" },
        STRK20_EXTENSION_SENDER,
      );
      expect(refused).toEqual({
        error:
          preparationId === "bad"
            ? "Invalid privacy execution request"
            : "Privacy preparation not found",
      });
      expect(strk20RunningJobId(refused)).toBeNull();
    }
  });

  test("a worker lost mid-submission leaves the preparation consumed", async () => {
    const relay = deferred<{ readonly transactionHash: string }>();
    const base = makeStrk20Service({ balance: "0xde0b6b3a7640000" });
    const before = buildStrk20Handler({
      balance: "0xde0b6b3a7640000",
      preferences: preferences(),
      strk20: {
        ...base,
        async submitActions() {
          return relay.promise;
        },
      },
    });
    const prepared = (await before(transfer, STRK20_EXTENSION_SENDER)) as {
      readonly strk20Preparation: { readonly id: string };
    };
    const preparationId = prepared.strk20Preparation.id;
    const jobId = strk20RunningJobId(
      await before({ preparationId, type: "wallet.strk20Execute" }, STRK20_EXTENSION_SENDER),
    );
    expect(jobId).not.toBeNull();

    // The restarted worker knows neither the job nor the preparation: the poll
    // is answered with the interruption reason and the id cannot be executed
    // again — a retry has to start from a fresh review.
    const after = buildStrk20Handler({ preferences: preferences() });
    await expect(after(poll(jobId), STRK20_EXTENSION_SENDER)).resolves.toEqual({
      error: STRK20_JOB_INTERRUPTED,
    });
    await expect(
      after({ preparationId, type: "wallet.strk20Execute" }, STRK20_EXTENSION_SENDER),
    ).resolves.toEqual({ error: "Privacy preparation not found" });
  });
});
