/**
 * `bun run mobile:ledger`: golden Ledger transcripts for the mobile core's device protocol
 * (wallet-core `ledger::{DeviceSigning, KeyEnumeration}`, `Plan::with_device`,
 * `ledger_account_candidates`), recorded against the real Starknet app under Speculos.
 *
 * Every APDU goes through the extension's own stack: the shipped `newStarknetClient` (the pinned
 * `@ledgerhq/hw-app-starknet` 3.0.2 over hw-transport's `send`) and `@bramble/ledger-protocol`'s
 * `client.ts` for its outcome. A recording transport sits where WebHID would and forwards each
 * APDU to Speculos (`tests/e2e/ledger/speculos.ts`); on-device approval and rejection are driven
 * through Speculos's REST API with the E2E suite's `device-actions.ts`. Each line carries the
 * APDUs in order (request hex, reply hex with its status word) and the extension's outcome.
 *
 * The sign flow is the side panel's `signWith` (`sign-session.ts`), called step by step:
 * `assertLedgerAppReady`, `ledgerPublicKeyX` at the account's path compared with its stored key
 * (`wrong-device` on a mismatch), `ledgerSignHashOnDevice`, then the background's
 * `verifyStarkSignature` gate. The device OS gate (`assertLedgerFirmwareReady`, a dashboard round
 * trip Speculos does not emulate) is left out, as wallet-core leaves it to the host.
 *
 * MANUAL ONLY: it needs Docker and the vendored app (`bun run vendor:ledger-app nanosp`), whose
 * hash must match `scripts/ledger-app-pins.ts`, so neither `bun run check` nor `mobile:parity`
 * runs it, and nothing checks it for drift. Speculos is seeded with the published parity phrase
 * (`PARITY_MNEMONIC`), never a real seed. The device's signatures are RFC 6979 deterministic, so
 * a re-run writes the same bytes.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import {
  assertLedgerAppReady,
  type LedgerDeviceClient,
  ledgerPublicKeyX,
  ledgerSignHashOnDevice,
} from "@bramble/ledger-protocol/client";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import { verifyStarkSignature } from "@bramble/transactions/ledger-verify";
import { deriveLedgerAccountRefs } from "@bramble/vault/accounts";
import type { LedgerEip2645Application } from "@bramble/wallet-model/ledger-path";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { sameFelt } from "@bramble/wallet-model/networks";
import { newStarknetClient } from "../packages/platform/ledger-browser/src/webhid-impl.js";
import { enumerateLedgerPubKeys } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/onboard-enumerate";
import {
  approveHashReview,
  enableBlindSigning,
  rejectHashReview,
} from "../tests/e2e/ledger/device-actions";
import { probeSpeculos, SpeculosApdu, SpeculosScreen } from "../tests/e2e/ledger/speculos";
import {
  APP_STARKNET_REVISION,
  APP_STARKNET_VERSION,
  LEDGER_APP_BINARIES,
  ledgerAppBinaryPath,
  SPECULOS_IMAGE,
} from "./ledger-app-pins";
import { PARITY_MESSAGE_HASH, PARITY_MNEMONIC } from "./mobile-parity";

/** Repository-relative path of the fixture the Rust tests read. */
export const LEDGER_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/extension-ledger.jsonl";

const MODEL = "nanosp";
const API_PORT = 5000;
const APDU_PORT = 9999;

/**
 * The hashes the mobile core's plan asks the device to sign for LedgerW account 0 as an
 * OpenZeppelin account on Sepolia against wallet-core's canned node (`plan_support::node::Node`):
 * its standalone deployment while undeployed, and 1.5 STRK to `ACCOUNT_1` once deployed (nonce
 * 0x5). Printed by wallet-core's `ledger_parity::print_plan_hashes` over the keys below, so its
 * replay reaches the write; they are inputs here, not the extension's hashes (the extension's
 * transaction hashes are other fixtures').
 */
const PLAN_DEPLOY_HASH = "0xf5ffa90a24c4c3494252f955b8d34ded83d06ce84e42ff6bb37c2454409223";
const PLAN_INVOKE_HASH = "0x51899a4f58db1d9dd67bd2887ce37adfcbdd41c1163b49c345143e20184cdcd";

type Exchange = { readonly request: string; readonly reply: string };

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/**
 * hw-transport's `Transport`, the class `send` comes from in the shipped WebHID transport. Loaded
 * untyped: the package's declarations name browser-only WebHID types.
 */
const Transport = Object.getPrototypeOf(
  require("@ledgerhq/hw-transport-webhid").default,
) as new () => {
  exchange(apdu: Buffer): Promise<Buffer>;
};

/** Stands where WebHID would: forwards each APDU to Speculos, or replays fixed replies. */
class RecordingTransport extends Transport {
  readonly log: Exchange[] = [];
  constructor(private readonly answer: (apdu: Uint8Array) => Promise<Uint8Array>) {
    super();
  }
  override async exchange(apdu: Buffer): Promise<Buffer> {
    const reply = await this.answer(apdu);
    this.log.push({ reply: hex(reply), request: hex(apdu) });
    return Buffer.from(reply);
  }
  async close(): Promise<void> {}
}

const outcomeOf = (error: unknown) => {
  if (!(error instanceof LedgerRejection)) throw error;
  return {
    code: error.code,
    status: "refused",
    ...(error.statusWord === undefined
      ? {}
      : { statusWord: `0x${error.statusWord.toString(16).padStart(4, "0")}` }),
  };
};

const verifiedBinary = async (): Promise<string> => {
  const path = ledgerAppBinaryPath(MODEL);
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (digest !== LEDGER_APP_BINARIES[MODEL].sha256) {
    throw new Error(`${path} does not match its pin; run bun run vendor:ledger-app ${MODEL}`);
  }
  return resolve(path);
};

const startSpeculos = async (binary: string): Promise<string> => {
  const name = `bramble-ledger-fixture-${process.pid}`;
  const started = Bun.spawnSync([
    "docker",
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1:${API_PORT}:${API_PORT}`,
    "-p",
    `127.0.0.1:${APDU_PORT}:${APDU_PORT}`,
    "-v",
    `${dirname(binary)}:/apps:ro`,
    SPECULOS_IMAGE,
    "--model",
    MODEL,
    "--display",
    "headless",
    "--seed",
    PARITY_MNEMONIC,
    "--api-port",
    String(API_PORT),
    "--apdu-port",
    String(APDU_PORT),
    `/apps/${MODEL}.elf`,
  ]);
  if (started.exitCode !== 0) throw new Error(started.stderr.toString());
  return name;
};

const main = async (): Promise<void> => {
  const binary = await verifiedBinary();
  const container = await startSpeculos(binary);
  const endpoints = {
    apduPort: APDU_PORT,
    apiUrl: `http://127.0.0.1:${API_PORT}`,
    host: "127.0.0.1",
    model: MODEL,
  } as const;
  const apdu = new SpeculosApdu(endpoints);
  try {
    for (let tries = 0; (await probeSpeculos(endpoints)) !== null; tries += 1) {
      if (tries > 90) throw new Error("Speculos did not come up");
      await Bun.sleep(1_000);
    }
    const screen = new SpeculosScreen(endpoints);
    await enableBlindSigning(screen, MODEL);

    /** Runs `flow` over a fresh recording client; returns its APDUs and outcome. */
    const record = async <T>(
      flow: (client: LedgerDeviceClient) => Promise<T>,
      answer: (apdu: Uint8Array) => Promise<Uint8Array> = (bytes) => apdu.exchange(bytes),
    ) => {
      const transport = new RecordingTransport(answer);
      const client = newStarknetClient(transport) as LedgerDeviceClient;
      let outcome: object;
      try {
        outcome = { status: "ok", ...(await flow(client)) };
      } catch (error) {
        outcome = outcomeOf(error);
      }
      return { exchanges: transport.log, outcome };
    };

    const lines: object[] = [
      {
        app: {
          elfSha256: LEDGER_APP_BINARIES[MODEL].sha256,
          library: "@ledgerhq/hw-app-starknet 3.0.2",
          model: MODEL,
          name: "Starknet",
          revision: APP_STARKNET_REVISION,
          version: APP_STARKNET_VERSION,
        },
        appMinimum: "2.4.0",
        block: "header",
        seed: "PARITY_MNEMONIC (the published parity phrase)",
        speculosImage: SPECULOS_IMAGE,
      },
    ];

    const version = async (client: LedgerDeviceClient) => {
      const v = await assertLedgerAppReady(client);
      return { version: `${v.major}.${v.minor}.${v.patch}` };
    };
    lines.push({
      block: "version",
      name: "the device's app",
      recorded: true,
      ...(await record(version)),
    });
    // Speculos runs 2.4.3, so the refusal is the extension's gate over a reply written here.
    lines.push({
      block: "version",
      name: "an app below the minimum (reply written by the generator)",
      recorded: false,
      ...(await record(version, async () => Uint8Array.from([2, 3, 9, 0x90, 0x00]))),
    });

    const keys = new Map<string, string>();
    for (const scheme of ["LedgerW", "argentx"] as const) {
      for (const accountIndex of [0, 1]) {
        const path = ledgerAccountPath(accountIndex, scheme);
        const read = await record(async (client) => ({
          publicKeyX: await ledgerPublicKeyX(client, path),
        }));
        keys.set(`${scheme}/${accountIndex}`, (read.outcome as { publicKeyX: string }).publicKeyX);
        lines.push({
          accountIndex,
          block: "publicKey",
          name: `${scheme} ${accountIndex}`,
          path,
          scheme,
          ...read,
        });
      }
    }

    const sign = async (
      name: string,
      scheme: LedgerEip2645Application,
      accountIndex: number,
      hash: string,
      device: "approve" | "reject" | "none",
      storedAt = `${scheme}/${accountIndex}`,
    ) => {
      const path = ledgerAccountPath(accountIndex, scheme);
      const storedPublicKeyX = keys.get(storedAt) ?? "";
      const flow = async (client: LedgerDeviceClient) => {
        await assertLedgerAppReady(client);
        if (!sameFelt(await ledgerPublicKeyX(client, path), storedPublicKeyX)) {
          throw new LedgerRejection("wrong-device");
        }
        const signing = ledgerSignHashOnDevice(client, path, hash);
        if (device === "approve") await approveHashReview(screen, MODEL);
        if (device === "reject") await rejectHashReview(screen, MODEL);
        const signature = await signing;
        const verified = verifyStarkSignature({ hash, publicKeyX: storedPublicKeyX, signature });
        return { ...signature, verified };
      };
      lines.push({
        accountIndex,
        block: "sign",
        hash,
        name,
        path,
        scheme,
        storedPublicKeyX,
        ...(await record(flow)),
      });
    };
    await sign("approved", "LedgerW", 0, PARITY_MESSAGE_HASH, "approve");
    await sign("approved at Ready's scheme", "argentx", 0, PARITY_MESSAGE_HASH, "approve");
    await sign("rejected on the device", "LedgerW", 0, PARITY_MESSAGE_HASH, "reject");
    await sign("another key at the path", "LedgerW", 0, PARITY_MESSAGE_HASH, "none", "LedgerW/1");
    await sign("plan deployment", "LedgerW", 0, PLAN_DEPLOY_HASH, "approve");
    await sign("plan transfer", "LedgerW", 0, PLAN_INVOKE_HASH, "approve");

    const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
    for (const [scheme, accountContractType] of [
      ["LedgerW", "openzeppelin"],
      ["argentx", "argent"],
    ] as const) {
      let entries: Awaited<ReturnType<typeof enumerateLedgerPubKeys>> = [];
      const page = await record(async (client) => {
        await assertLedgerAppReady(client);
        entries = await enumerateLedgerPubKeys(client, 0, 5, "verified", scheme);
        return { entries };
      });
      const accounts = await deriveLedgerAccountRefs(kms, {
        accountContractType,
        eip2645application: scheme,
        entries,
        networkId: "SN_SEPOLIA",
      });
      lines.push({
        block: "enumerate",
        candidates: accounts.map((account) => ({
          accountIndex: account.derivation.accountIndex,
          address: account.address,
          path: account.derivation.path,
          publicKeyX: account.publicKeyX,
        })),
        count: 5,
        family: accountContractType,
        name: `${scheme} page 0`,
        networkId: "SN_SEPOLIA",
        scheme,
        startIndex: 0,
        ...page,
      });
    }

    await writeFile(
      LEDGER_PARITY_FIXTURE_PATH,
      lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
    );
    console.log(`wrote ${LEDGER_PARITY_FIXTURE_PATH} (${lines.length} lines)`);
  } finally {
    apdu.close();
    Bun.spawnSync(["docker", "stop", container], { stderr: "ignore", stdout: "ignore" });
  }
};

await main();
