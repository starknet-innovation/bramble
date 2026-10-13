/**
 * Extension-only messages behind the Shadow accounts view (#443, PR 5). None
 * is dapp-reachable. Listing reads only the encrypted vault; reading balances
 * and preparing a sweep reach the network and run only when the user asks.
 * The recorded scopes reveal which sites the user drove shadow accounts
 * through, so they cross only to the privileged panel.
 */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isWalletOrigin } from "@bramble/core/origin";
import type { ShadowAccountScopeRef } from "@bramble/vault/shadow-account-scopes";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { isStrk20DappName, isStrk20Felt } from "@bramble/wallet-protocol/strk20";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { activeAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import {
  type ActivePrivacyContext,
  errorText,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { readShadowAccounts, type ShadowScopeTarget } from "./strk20-shadow-reads";
import { prepareShadowSweep } from "./strk20-shadow-sweep";

const readTarget = (
  message: unknown,
  type: string,
  extra: readonly string[] = [],
): (ShadowScopeTarget & Readonly<Record<string, unknown>>) | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["label", "origin", "type", ...extra]) &&
  message["type"] === type &&
  typeof message["origin"] === "string" &&
  isWalletOrigin(message["origin"]) &&
  isStrk20DappName(message["label"])
    ? { ...message, label: message["label"], origin: message["origin"] }
    : null;

// Every route resolves the active account the user is looking at; each is a
// click on the view, so the unlock window is renewed like any other journey.
const withContext = async (
  deps: Strk20WalletOpsDeps,
  run: (
    context: Exclude<Awaited<ReturnType<typeof resolvePrivacyContext>>, { readonly error: string }>,
    vaultPassphrase: string,
  ) => Promise<RuntimeResponse>,
  fallback: string,
): Promise<RuntimeResponse> => {
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  const context = await resolvePrivacyContext(deps, { active });
  if ("error" in context || active.error !== undefined) {
    return "error" in context ? { error: context.error } : { error: fallback };
  }
  try {
    return await run(context, active.vaultPassphrase);
  } catch (error) {
    return { error: errorText(error, fallback) };
  }
};

// The resolved account's recorded scopes on its chain and configured pool.
// Throws when the vault cannot list them.
const recordedShadowScopes = async (
  deps: Pick<Strk20WalletOpsDeps, "wallet">,
  context: ActivePrivacyContext,
  vaultPassphrase: string,
): Promise<readonly ShadowAccountScopeRef[]> => {
  const config = context.accountContext.config;
  if (!deps.wallet.listShadowAccountScopes || !config) {
    throw new WalletError("shadow account records unavailable");
  }
  const account = context.accountContext.account;
  return deps.wallet.listShadowAccountScopes({
    accountId: account.id,
    chainId: STARKNET_NETWORKS[account.networkId].chainId,
    poolAddress: config.poolAddress,
    vaultPassphrase,
  });
};

type ShadowOp = (deps: Strk20WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const SHADOW_OPS: ReadonlyMap<string, ShadowOp> = new Map<string, ShadowOp>([
  [
    "wallet.strk20ShadowAccounts",
    async (deps, message) =>
      readTypeOnlyInput(message, "wallet.strk20ShadowAccounts")
        ? withContext(
            deps,
            async (context, passphrase) => {
              const configured = context.accountContext.config?.shadowAccountAnonymizerAddress;
              const scopes = await recordedShadowScopes(deps, context, passphrase);
              return {
                ok: true,
                strk20ShadowAccounts: {
                  scopes: scopes.map((scope) => ({
                    anonymizer: scope.anonymizer,
                    current: sameFelt(configured, scope.anonymizer),
                    label: scope.label,
                    nonces: [...scope.nonces],
                    origin: scope.origin,
                  })),
                },
              };
            },
            "Shadow accounts unavailable",
          )
        : { error: "Invalid shadow accounts request" },
  ],
  [
    "wallet.strk20ShadowAccountBalances",
    async (deps, message) => {
      const target = readTarget(message, "wallet.strk20ShadowAccountBalances");
      return target
        ? withContext(
            deps,
            async (context, passphrase) => {
              const records = await recordedShadowScopes(deps, context, passphrase);
              const read = await readShadowAccounts(deps, context, records, target);
              return {
                ok: true,
                strk20ShadowAccountBalances: { accounts: read.accounts, unlisted: read.unlisted },
              };
            },
            "Shadow account balances unavailable",
          )
        : { error: "Invalid shadow account balance request" };
    },
  ],
  [
    "wallet.strk20PrepareShadowSweep",
    async (deps, message) => {
      const target = readTarget(message, "wallet.strk20PrepareShadowSweep", ["nonce"]);
      const nonce = target?.["nonce"];
      return target && isStrk20Felt(nonce)
        ? withContext(
            deps,
            async (context, passphrase) =>
              prepareShadowSweep(
                deps,
                context,
                await recordedShadowScopes(deps, context, passphrase),
                {
                  label: target.label,
                  nonce,
                  origin: target.origin,
                },
              ),
            "Shadow account sweep preparation failed",
          )
        : { error: "Invalid shadow account sweep request" };
    },
  ],
]);

/**
 * Handles the privileged Shadow accounts messages and returns null for other
 * types. A Map, so an untrusted type can never resolve to an inherited key.
 */
export const handleStrk20ShadowOps = async (
  deps: Strk20WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const op = SHADOW_OPS.get(messageType);
  return op ? op(deps, message) : null;
};
