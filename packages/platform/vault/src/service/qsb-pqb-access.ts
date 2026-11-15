/** PQB vault session. Secrets are authorized only after the current bound journal is durable. */

import { type PqbDisclosureRequest, snapshotPqbRequest } from "@bramble/wallet-model/pqb";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import type { PqbKms } from "../qsb/pqb-kms";
import { type QsbSlot, qsbSlotBinding, qsbSlotRefusal } from "./qsb-vault-slot";
import type { QsbVaultAccess } from "./qsb-vault-types";
import { custodyBinding, recordExposureIn } from "./qsb-vault-withdrawals";

type InSlot = <T>(run: (slot: QsbSlot) => Promise<T>) => Promise<T>;
const refused = (): never => {
  throw qsbSlotRefusal(QSB_WITHDRAWAL_REFUSALS.bindingRefused);
};
const boundRequest = async (slot: QsbSlot, v: number, r: PqbDisclosureRequest): Promise<void> => {
  const bound = await qsbSlotBinding(slot);
  const vault = bound.status === "bound" ? bound.journal.vaults.find((x) => x.v === v) : undefined;
  if (!vault?.pqb || vault.scriptHash !== r.scriptHash || vault.root !== r.scriptHash) refused();
};
/** Public derivation before allocation; preparation and authorization bind to the persisted vault. */
export const qsbPqbAccess = (kms: PqbKms, inSlot: InSlot): NonNullable<QsbVaultAccess["pqb"]> => ({
  material: (v) => inSlot((slot) => kms.material(slot.account.mnemonic, v)),
  prepare: (v, r) =>
    inSlot(async (slot) => {
      await boundRequest(slot, v, r);
      return kms.prepare(slot.account.mnemonic, v, r);
    }),
  release: (v, request, digest, emergency) => {
    const r = snapshotPqbRequest(request);
    return inSlot(async (slot) => {
      const binding = await custodyBinding(slot, emergency);
      await boundRequest(slot, v, r);
      const vault = binding.journal.vaults.find((x) => x.v === v) ?? refused();
      const info = await kms.prepare(slot.account.mnemonic, v, r);
      if (info.digest !== digest) return refused();
      const disclosure = {
        digest,
        transaction: r.transaction,
        round0: [...r.round0],
        round1: [...r.round1],
        menus: [...r.menus],
      };
      await recordExposureIn(slot, binding, vault, disclosure, emergency);
      return kms.authorize(slot.account.mnemonic, v, r);
    });
  },
});
