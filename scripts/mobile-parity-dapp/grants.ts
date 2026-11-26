/**
 * The `grants` block: origin grants through the extension's own vault service over a real
 * (memory-backed) vault, so each write is `grantOrigin`'s or `revokeOrigin`'s and each read is
 * `grantedAccountIdsFor` and `connectedSitesFromVault` over the vault that write left. One case
 * is a sequence of steps; after each, the stored grants (in stored order), what each site sees
 * now, and the connected-sites list. A refused step records its sentence and changes nothing.
 */
import { createMemoryStore } from "@bramble/store/kv";
import { connectedSitesFromVault, grantedAccountIdsFor } from "@bramble/vault/origin-grants";
import { PARITY_MNEMONIC } from "../mobile-parity";
import { VAULT_PARITY_PASSWORD, vaultService } from "../mobile-parity-vault";
import { OTHER_SITE, SITE, thrownMessage } from "./shared";

const THIRD_SITE = "https://a.example";

type Step =
  | { readonly op: "grant"; readonly origin: string; readonly account?: number }
  | { readonly op: "revoke"; readonly origin: string; readonly account?: number }
  | { readonly op: "activate"; readonly account: number };

const STEPS: readonly Step[] = [
  { op: "grant", origin: SITE },
  { op: "grant", origin: OTHER_SITE },
  { op: "grant", origin: SITE },
  { account: 1, op: "activate" },
  { op: "grant", origin: THIRD_SITE },
  { account: 1, op: "grant", origin: SITE },
  { account: 0, op: "activate" },
  { account: 1, op: "revoke", origin: SITE },
  { account: 1, op: "revoke", origin: SITE },
  { account: 0, op: "revoke", origin: OTHER_SITE },
  { op: "revoke", origin: THIRD_SITE },
  { op: "revoke", origin: "https://never.example" },
  { op: "grant", origin: "https://app.example/path" },
  { op: "grant", origin: "http://app.example" },
];

/** Runs every step over one vault holding two Mainnet accounts, the first active. */
export const computeGrants = async (): Promise<readonly object[]> => {
  const service = await vaultService(createMemoryStore());
  const vaultPassphrase = VAULT_PARITY_PASSWORD;
  await service.recoverAccounts({
    mnemonic: PARITY_MNEMONIC,
    networkId: "SN_MAIN",
    selections: [
      { accountContractType: "openzeppelin", accountIndex: 0 },
      { accountContractType: "openzeppelin", accountIndex: 1 },
    ],
    vaultPassphrase,
  });
  const ids = (await service.readVault(vaultPassphrase)).accounts.map((account) => account.id);
  await service.setActiveAccount({ accountId: ids[0] ?? "", vaultPassphrase });
  const accountId = (index: number | undefined) =>
    index === undefined ? {} : { accountId: ids[index] ?? "" };

  const cases: object[] = [];
  for (const step of STEPS) {
    let refused: string | null = null;
    try {
      if (step.op === "grant") {
        await service.grantOrigin({
          origin: step.origin,
          vaultPassphrase,
          ...accountId(step.account),
        });
      } else if (step.op === "revoke") {
        await service.revokeOrigin({
          origin: step.origin,
          vaultPassphrase,
          ...accountId(step.account),
        });
      } else {
        await service.setActiveAccount({ accountId: ids[step.account] ?? "", vaultPassphrase });
      }
    } catch (error) {
      refused = thrownMessage(error);
    }
    const vault = await service.readVault(vaultPassphrase);
    cases.push({
      active: vault.activeAccountId,
      connected: connectedSitesFromVault(vault).map(({ accountIds, origin }) => ({
        accountIds,
        origin,
      })),
      grants: vault.originGrants,
      name: `${step.op} ${"origin" in step ? step.origin : ""} ${step.account ?? ""}`.trim(),
      refused,
      sees: Object.fromEntries(
        [SITE, OTHER_SITE, THIRD_SITE].map((origin) => [
          origin,
          grantedAccountIdsFor(vault, origin),
        ]),
      ),
      step: { ...step, ...accountId("account" in step ? step.account : undefined) },
    });
  }
  return cases;
};
