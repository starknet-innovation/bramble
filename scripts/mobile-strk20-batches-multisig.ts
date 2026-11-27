/**
 * The STRK20 multisig job batches for S7 (wallet-core #182): a 2-of-3 Argent multisig's shield
 * through `prepareWith` with the multisig's CallSet signer and held-proof hooks, signed by
 * parity-phrase signers (the multisig fixtures' members and record). It records both signatures
 * at once, the two-phase hold and resume, a held request whose block has aged out, a co-signer's
 * review of the held calls, and the authorization refusals.
 *
 * The hooks are the background's `openMultisigStrk20Session` closures (`signCallSet`,
 * `collectFragment`, `heldProof.hold` / `resume`) restated over the same exported functions, in
 * the same order: that session needs the whole background (vault, session, multisig records), so
 * it is not run itself. Everything they call is the extension's own: the redaction, the CallSet
 * digest, the call review, the fragment check, the aggregate, the store, `holdCompiledStrk20Request`,
 * `findResumableStrk20Request` and `readMultisigStrk20Window`. "Both at once" applies the
 * co-signer's fragment straight after the active signer's, where a real co-owner's would arrive by
 * import; it is what makes the authorization ready before `hold`.
 *
 * The shared multisig viewing key is created by the vault from a fresh random phrase
 * (`freshKey`); here the same derivation runs over the parity phrase, at account index 9.
 */
import { WalletError } from "@bramble/core/errors";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { DEFAULT_STRK20_NETWORKS } from "@bramble/privacy/config";
import {
  type MultisigStrk20ActionRequest,
  type MultisigStrk20Authorization,
  multisigStrk20CallSetAggregate,
  multisigStrk20CallSetHash,
  withMultisigStrk20Fragment,
} from "@bramble/privacy/multisig-strk20";
import { redactStrk20Calldata } from "@bramble/privacy/multisig-strk20-redaction";
import {
  multisigStrk20Summary,
  reviewMultisigStrk20Calls,
} from "@bramble/privacy/multisig-strk20-review";
import { createMultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import type { Strk20HeldProofHooks, Strk20PrepareInput } from "@bramble/privacy/service";
import { createMemoryStore } from "@bramble/store/kv";
import {
  canonicalFelt,
  DEFAULT_TOKENS,
  STARKNET_NETWORKS,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import {
  findResumableStrk20Request,
  holdCompiledStrk20Request,
} from "../apps/extension/src/background/multisig/multisig-strk20-held";
import { multisigStrk20ReviewScope } from "../apps/extension/src/background/multisig/multisig-strk20-scope";
import {
  MULTISIG_STRK20_WAITING,
  readMultisigStrk20Window,
} from "../apps/extension/src/background/multisig/multisig-strk20-session";
import { multisigRecord, multisigSigners, signAs } from "./mobile-multisig-transactions";
import { PARITY_MNEMONIC } from "./mobile-parity";
import { type Batch, type BatchKit, PROVING_BLOCK } from "./mobile-strk20-batches";
import { hex } from "./mobile-strk20-primitives";

const E18 = 1_000_000_000_000_000_000n;
const VALIDITY_BLOCKS = 100n;
const NOW_SECONDS = 1_800_000_000;
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const errorText = (run: () => unknown): unknown => {
  try {
    return { result: plain(run()) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/** The S7 batches and lines, in fixture order. */
export const multisigStrk20Batches = async (kit: BatchKit): Promise<readonly Batch[]> => {
  const config = DEFAULT_STRK20_NETWORKS.SN_MAIN;
  const pool = config ? canonicalFelt(config.poolAddress) : null;
  if (!config || !pool) throw new Error("mainnet STRK20 config missing");
  const rpcUrl = STARKNET_NETWORKS.SN_MAIN.rpcUrls[0] ?? "";
  const chainId = STARKNET_NETWORKS.SN_MAIN.chainId;
  const signers = await multisigSigners("SN_MAIN");
  const record = multisigRecord("SN_MAIN", signers);
  const current = record.currentConfig;
  if (!current) throw new Error("multisig record has no current config");
  const signerSet = { signerPublicKeys: current.signerPublicKeys, threshold: current.threshold };
  const [active, cosigner, , , outsider] = signers;
  if (!active || !cosigner || !outsider) throw new Error("multisig signers missing");
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const { privateKey } = await kms.deriveStarknetKeypair(PARITY_MNEMONIC, 0, 9);
  const scalar = canonicalFelt(await kms.deriveStrk20ViewingKey(privateKey, chainId, pool)) ?? "";
  const multisig = kit.partyOf(BigInt(record.address), BigInt(scalar));
  const store = createMultisigStrk20Store(createMemoryStore());
  const scope = multisigStrk20ReviewScope(record, pool, DEFAULT_TOKENS);
  const isAuthorized = () => true;
  const amount = `${5n * E18}`;
  const shield = [{ amount, token: hex(kit.strk), type: "deposit" as const }];
  const request: MultisigStrk20ActionRequest = { amount, kind: "deposit", token: hex(kit.strk) };
  const authorizations: Record<string, string> = {};

  // multisig-strk20-session.ts `redactedCalls`: the scalar replaced in each call's calldata.
  const redactedCalls = (calls: readonly Call[]) => {
    const redacted = calls.map((call) => {
      const contractAddress = canonicalFelt(String(call.contractAddress));
      const source = Array.isArray(call.calldata) ? call.calldata : [];
      const calldata = redactStrk20Calldata(
        source.map((felt) => String(felt)),
        scalar,
      );
      return contractAddress && calldata
        ? { calldata, contractAddress, entrypoint: call.entrypoint }
        : null;
    });
    return redacted.every((call) => call !== null) ? redacted : null;
  };

  // The session's hooks for one job; `cosign` adds the co-signer's fragment at once.
  const session = (batchId: string, cosign: boolean) => {
    let compiled: string | null = null;
    const log: Record<string, unknown> = {};
    const signCallSet = async (messageHash: string, calls: readonly Call[]): Promise<string[]> => {
      const callsForHash = redactedCalls(calls);
      const digest = callsForHash
        ? multisigStrk20CallSetHash(record.address, callsForHash, chainId, scalar)
        : null;
      const hash = digest ? canonicalFelt(digest) : null;
      if (
        !callsForHash ||
        !hash ||
        !sameFelt(hash, messageHash) ||
        !reviewMultisigStrk20Calls(callsForHash, scalar, scope)
      ) {
        throw new WalletError("Invalid Argent multisig private proof");
      }
      const id = `${record.id}:${hash}`;
      compiled = id;
      authorizations[batchId] = id;
      const existing = await store.getAuthorization(id, scalar);
      if (existing?.state === "ready") {
        return [...multisigStrk20CallSetAggregate(existing.fragments, signerSet)];
      }
      // collectFragment: the active member signs; the store keeps the authorization.
      const base: MultisigStrk20Authorization = existing ?? {
        accountAddress: record.address,
        accountId: record.id,
        calls: callsForHash,
        chainId,
        fragments: [],
        hash,
        id,
        request,
        signerPublicKeys: signerSet.signerPublicKeys,
        state: "collecting",
        summary: multisigStrk20Summary(request.kind),
        threshold: signerSet.threshold,
      };
      const own = await signAs(active, hash);
      let next = withMultisigStrk20Fragment(base, { ...own, publicKey: active.publicKey }) ?? base;
      const fragments: unknown[] = [{ ...own, publicKey: active.publicKey, signer: "active" }];
      if (cosign) {
        const theirs = await signAs(cosigner, hash);
        next =
          withMultisigStrk20Fragment(next, { ...theirs, publicKey: cosigner.publicKey }) ?? next;
        fragments.push({ ...theirs, publicKey: cosigner.publicKey, signer: "cosigner" });
      }
      if ((await store.upsertAuthorization(next, scalar, isAuthorized)) !== "stored") {
        throw new WalletError("Invalid Argent multisig private proof");
      }
      const answer =
        next.state === "ready"
          ? [...multisigStrk20CallSetAggregate(next.fragments, signerSet)]
          : ["0x0"];
      log["signCallSet"] = { digest: hash, fragments, returned: answer, state: next.state };
      return answer;
    };
    const heldProof: Strk20HeldProofHooks = {
      async hold(compiledRequest) {
        log["holdInput"] = plain(compiledRequest);
        const authorization = compiled ? await store.getAuthorization(compiled, scalar) : null;
        const held = await holdCompiledStrk20Request({
          authorization,
          isAuthorized,
          plan: undefined,
          request: compiledRequest,
          scalar,
          signers: signerSet,
          store,
        });
        log["holdResult"] = held === "waiting" ? "waiting" : plain(held);
        if (held !== "waiting") return held;
        throw new WalletError(MULTISIG_STRK20_WAITING);
      },
      async resume() {
        const resumed = await findResumableStrk20Request({
          accountId: record.id,
          action: request,
          nowSeconds: NOW_SECONDS,
          readWindow: () => readMultisigStrk20Window([rpcUrl], pool),
          scalar,
          signers: signerSet,
          store,
        });
        log["resumed"] = resumed ? plain(resumed) : null;
        return resumed?.request ?? null;
      },
    };
    const batch = (id: string, script: Batch["script"], before?: Batch["before"]): Batch => ({
      ...kit.job(id, "actions", shield, { nonce: [kit.rpc("0x2a")], prover: [], ...script }),
      account: {
        address: record.address,
        sign: async () => ({ publicKey: "", r: "", s: "" }),
        viewingKey: scalar,
      },
      ...(before ? { before } : {}),
      context: (base: Strk20PrepareInput, signing) => ({
        ...base,
        heldProof,
        signCallSet: async (messageHash: string, calls: readonly Call[]) => {
          const signature = await signCallSet(messageHash, calls);
          const last = signing.at(-1);
          if (last) Object.assign(last, { digest: messageHash, signature });
          return signature;
        },
        signHash: () => Promise.reject(new WalletError("Invalid Argent multisig private proof")),
      }),
      extra: async () => ({
        multisig: {
          ...log,
          authorization: authorizations[id]
            ? plain(await store.getAuthorization(authorizations[id] ?? "", scalar))
            : null,
          held: plain(await store.listHeld(record.id)),
        },
      }),
      inputs: {
        accountPublicKey: null,
        multisig: {
          activeSigner: active.publicKey,
          coSigner: cosigner.publicKey,
          id: record.id,
          scalarDerivation: "deriveStrk20ViewingKey(deriveStarknetKeypair(parity phrase, 0, 9))",
          signerPublicKeys: signerSet.signerPublicKeys,
          threshold: signerSet.threshold,
        },
        request,
      },
    });
    return batch;
  };

  const self = kit.outgoing([{ created: true, last: 1, to: multisig }], 1, undefined, multisig);
  const proved = kit.proved(shield, false, multisig);
  const window = (current: bigint) => [kit.rpc(Number(current)), kit.rpc([hex(VALIDITY_BLOCKS)])];
  const live = window(BigInt(PROVING_BLOCK) + 10n);
  const aged = window(BigInt(PROVING_BLOCK) + VALIDITY_BLOCKS + 1n);

  const both = session("multisig-shield-both-signers", true)("multisig-shield-both-signers", {
    outgoing: [self],
    prover: [proved],
  });
  const phaseOne = session("multisig-shield-phase-1", false)("multisig-shield-phase-1", {
    outgoing: [self],
  });
  // The co-signer's turn between the phases: its fragment over the held authorization's digest.
  const coSign = async () => {
    const id = authorizations["multisig-shield-phase-1"] ?? "";
    const held = await store.getAuthorization(id, scalar);
    if (!held) throw new Error("phase 1 stored no authorization");
    const theirs = await signAs(cosigner, held.hash);
    const next = withMultisigStrk20Fragment(held, { ...theirs, publicKey: cosigner.publicKey });
    if (!next || (await store.upsertAuthorization(next, scalar, isAuthorized)) !== "stored") {
      throw new Error("the co-signer's fragment was refused");
    }
    authorizations["multisig-shield-phase-2"] = id;
    return {
      coSigner: { fragment: { ...theirs, publicKey: cosigner.publicKey }, state: next.state },
    };
  };
  const phaseTwo = session("multisig-shield-phase-2", false)(
    "multisig-shield-phase-2",
    {
      blockNumber: [live[0] ?? kit.rpc("0x0")],
      call: [live[1] ?? kit.rpc([])],
      nonce: [],
      prover: [proved],
    },
    coSign,
  );
  const agedOut = session("multisig-held-aged-out", false)("multisig-held-aged-out", {
    blockNumber: [aged[0] ?? kit.rpc("0x0")],
    call: [aged[1] ?? kit.rpc([])],
    outgoing: [self],
  });

  // Not jobs: a co-signer's review of the held calls, and the authorization refusals.
  const line = (
    id: string,
    kind: string,
    build: () => Promise<Record<string, unknown>>,
  ): Batch => ({
    actions: [],
    builder: "actions",
    id,
    line: async () => ({ kind, id, ...(await build()) }),
    script: {},
  });
  const review = line("multisig-cosigner-review", "multisig-review", async () => {
    const held = await store.getAuthorization(
      authorizations["multisig-shield-phase-1"] ?? "",
      scalar,
    );
    if (!held) throw new Error("no held authorization to review");
    return {
      calls: plain(held.calls),
      digest: held.hash,
      review: plain(reviewMultisigStrk20Calls(held.calls, scalar, scope)),
      scope: plain(scope),
    };
  });
  const refusals = line("multisig-authorization-refusals", "multisig-refusal", async () => {
    const held = await store.getAuthorization(
      authorizations["multisig-shield-phase-1"] ?? "",
      scalar,
    );
    if (!held) throw new Error("no authorization");
    const collecting = {
      ...held,
      fragments: held.fragments.slice(0, 1),
      state: "collecting" as const,
    };
    const outsiderSig = await signAs(outsider, held.hash);
    const wrongHash = await signAs(cosigner, hex(BigInt(held.hash) + 1n));
    const own = held.fragments[0];
    return {
      belowThresholdAggregate: errorText(() =>
        multisigStrk20CallSetAggregate(collecting.fragments, signerSet),
      ),
      cases: {
        nonSigner: plain(
          withMultisigStrk20Fragment(collecting, { ...outsiderSig, publicKey: outsider.publicKey }),
        ),
        repeatedSigner: own ? plain(withMultisigStrk20Fragment(collecting, own)) : null,
        signatureOverAnotherHash: plain(
          withMultisigStrk20Fragment(collecting, { ...wrongHash, publicKey: cosigner.publicKey }),
        ),
      },
      fragments: { nonSigner: { ...outsiderSig, publicKey: outsider.publicKey } },
      threshold: signerSet.threshold,
    };
  });

  return [both, phaseOne, phaseTwo, agedOut, review, refusals];
};
