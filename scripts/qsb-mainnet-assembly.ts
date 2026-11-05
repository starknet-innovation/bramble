/**
 * Runs the first mainnet QSB withdrawal (./qsb-mainnet-withdrawal) through a
 * QSB runtime's commitments setup, `prepare` and `finish`, and lists every
 * answer that differs from the chain's. Shared by `check:qsb` (real adapter,
 * Bun) and the vendor-gated suite so both agree on what "it ran" means.
 */
import { createHash } from "node:crypto";
import type { QsbRuntime } from "../apps/extension/src/background/qsb/qsb-runtime";
import {
  QSB_MAINNET_ASSEMBLY,
  QSB_MAINNET_COMMITMENTS,
  QSB_MAINNET_DEPOSIT_TX,
  QSB_MAINNET_MANIFEST,
  QSB_MAINNET_PREIMAGES,
  QSB_MAINNET_SOLUTION,
} from "./qsb-mainnet-withdrawal";

// The vault output's script, read from the deposit's segwit serialization:
// version, marker and flag, one input of 41 bytes with an empty scriptSig,
// two outputs, the first one's amount, then its length as 0xfd and two bytes.
const vaultScriptOf = (depositHex: string): string => {
  const at = (4 + 2 + 1 + 41 + 1 + 8) * 2;
  const length = Number.parseInt(
    depositHex
      .slice(at + 2, at + 6)
      .match(/../g)
      ?.reverse()
      .join("") ?? "",
    16,
  );
  return depositHex.slice(at + 6, at + 6 + length * 2);
};

/** Every way `runtime` disagrees with the chain on the first mainnet withdrawal. */
export const mainnetAssemblyFailures = async (runtime: QsbRuntime): Promise<readonly string[]> => {
  const failures: string[] = [];
  const vault = await runtime.setupFromCommitments(QSB_MAINNET_COMMITMENTS);
  if (vault.scriptHex !== vaultScriptOf(QSB_MAINNET_DEPOSIT_TX)) {
    failures.push("the setup's script is not the mainnet vault's");
  }
  if (
    createHash("sha256").update(vault.publicStateJson).digest("hex") !==
    QSB_MAINNET_ASSEMBLY.publicStateSha256
  ) {
    failures.push("the setup's public state is not the reviewed one");
  }
  const prepared = await runtime.prepare(
    vault.publicStateJson,
    JSON.stringify(QSB_MAINNET_MANIFEST),
    JSON.stringify(QSB_MAINNET_SOLUTION),
  );
  if (
    prepared.transaction !== QSB_MAINNET_ASSEMBLY.transaction ||
    prepared.round0.join() !== QSB_MAINNET_ASSEMBLY.round0.join() ||
    prepared.round1.join() !== QSB_MAINNET_ASSEMBLY.round1.join() ||
    prepared.scriptHash !== QSB_MAINNET_ASSEMBLY.scriptHash ||
    prepared.scriptHash !== vault.scriptHash
  ) {
    failures.push("prepare is not the mainnet withdrawal's T and indices");
  }
  const raw = await runtime.finish(prepared, QSB_MAINNET_PREIMAGES);
  if (raw !== QSB_MAINNET_ASSEMBLY.raw) {
    failures.push("finish is not the mainnet withdrawal's legacy serialization");
  }
  return failures;
};
