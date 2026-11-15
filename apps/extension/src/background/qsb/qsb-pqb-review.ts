/** PQB review preparation: verify SDK hits and compare Krusty's independent stage bindings. No disclosure. */

import type { QsbSolution } from "@bramble/qsb/withdrawal-binding";
import {
  isQsbDisclosureOf,
  isQsbSolutionInRange,
  qsbWithdrawalTransaction,
} from "@bramble/qsb/withdrawal-binding";
import type { QsbWithdrawalManifest } from "@bramble/qsb/withdrawal-manifest";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import type { QsbDepositContext } from "./qsb-vault-prepare";
import { withdrawalRefusal } from "./qsb-vault-refusals";
import type { QsbPreparedWithdrawal } from "./qsb-withdrawal-assembly";
import type { QsbWithdrawableRecord } from "./qsb-withdrawal-terms";

const refuse = (): never => {
  throw withdrawalRefusal("bindingRefused");
};
/** Re-derives public material, validates all three real puzzle hits and their exact transaction. */
export const preparePqbReview = async (
  context: QsbDepositContext,
  record: QsbWithdrawableRecord,
  script: string,
  manifest: QsbWithdrawalManifest,
  solution: QsbSolution,
): Promise<QsbPreparedWithdrawal> => {
  if (!solution.pqb || !context.access.pqb || !context.deps.runtime.pqb) return refuse();
  const material = await context.access.pqb.material(record.v);
  if (material.script !== script || material.scriptSha256 !== record.scriptHash) return refuse();
  const prepared = context.deps.runtime.pqb.prepare(material, manifest, solution);
  if (
    prepared.transaction !== qsbWithdrawalTransaction(manifest, solution) ||
    prepared.scriptHash !== record.scriptHash ||
    !isQsbSolutionInRange(solution) ||
    !isQsbDisclosureOf(prepared, solution)
  )
    return refuse();
  return {
    json: "",
    round0: prepared.round0,
    round1: prepared.round1,
    scriptHash: prepared.scriptHash,
    transaction: prepared.transaction,
    pqb: { material, prepared },
  };
};
/** PQB sighashes must match the public SDK computation before the journal digest is reviewed. */
export const preparedDisclosureDigest = async (
  access: QsbVaultAccess,
  v: number,
  prepared: QsbPreparedWithdrawal,
): Promise<string> => {
  if (!prepared.pqb)
    return (await access.revealDigest(prepared.transaction, prepared.round0, prepared.round1))
      .digest;
  if (!access.pqb) return refuse();
  const info = await access.pqb.prepare(v, prepared.pqb.prepared);
  if (JSON.stringify(info.stageSighashes) !== JSON.stringify(prepared.pqb.prepared.sighashes))
    return refuse();
  return info.digest;
};
