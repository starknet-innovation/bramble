/**
 * The `signature` block: one co-signer's signature handed to the background's own
 * `wallet.importArgentMultisigSignature` handler (`importSignature` in `multisig-tx-ops.ts`, via
 * `handleMultisigTxOps`) against a stored intent, recorded as the `import` block records a package.
 * Unlike an import, this path marks a stored intent stale when the chain's authority or nonce no
 * longer matches. A nonce ahead of the intent starts a receipt lookup for a co-signer's send,
 * which needs a node, so only a nonce behind it is recorded.
 */
import { type MultisigSigner, OUTSIDER, signAs } from "../mobile-multisig-transactions";
import { intents } from "./import";
import { type HandlerCase, runHandlerCases } from "./run";
import { currentAuthority, type Setup } from "./shared";

const TYPE = "wallet.importArgentMultisigSignature";

/** Every signature case, run through the background handler. */
export const computeSignatureImports = async (setup: Setup): Promise<readonly object[]> => {
  const i = await intents(setup);
  const hash = i.proposal.prepared.transactionHash;
  const signer = (index: number) => setup.signers[index] as MultisigSigner;
  const by = (index: number, over = hash) => signAs(signer(index), over);
  const member2 = await by(2);
  const message = (signature: unknown, intentId = i.proposal.id) => ({
    intentId,
    signature,
    type: TYPE,
  });
  const authority = currentAuthority(setup.record);
  const cases: readonly Omit<HandlerCase, "intentId">[] = [
    { message: message(await by(1)), name: "the first signature", stored: i.proposal },
    {
      message: message(member2),
      name: "the signature that reaches the threshold",
      stored: i.byMember1,
    },
    {
      message: message(await by(OUTSIDER)),
      name: "a signer who is not a member",
      stored: i.byMember1,
    },
    { message: message(await by(1)), name: "a member who already signed", stored: i.byMember1 },
    {
      message: message({ ...member2, s: (await by(1)).s }),
      name: "a signature that does not verify",
      stored: i.byMember1,
    },
    {
      message: message(await by(2, i.other.prepared.transactionHash)),
      name: "a signature over another transaction's hash",
      stored: i.byMember1,
    },
    {
      message: message(member2, i.other.id),
      name: "an intent this wallet does not hold",
      stored: i.byMember1,
    },
    { message: message(member2), name: "a ready intent", stored: i.ready },
    { message: message(member2), name: "a submitted intent", stored: i.submitted },
    {
      message: message(member2),
      name: "a stale intent",
      stored: { ...i.byMember1, staleReason: "nonce", state: "stale" },
    },
    {
      message: message(member2),
      name: "a threshold the chain no longer has",
      reads: { authority: { ...authority, threshold: 3 } },
      stored: i.byMember1,
    },
    {
      message: message(member2),
      name: "the chain nonce behind the intent",
      reads: { nonce: "0x4" },
      stored: i.byMember1,
    },
    {
      message: message(member2),
      name: "a locked wallet",
      stored: i.byMember1,
      wallet: { locked: true },
    },
    {
      message: { ...message(member2), origin: "x" },
      name: "an unknown message key",
      stored: i.byMember1,
    },
    {
      message: message({ r: member2.r, s: member2.s }),
      name: "a signature without its public key",
      stored: i.byMember1,
    },
  ];
  // The stored intent's own entry, so a wrong-id case still shows that nothing changed.
  return runHandlerCases(
    setup,
    TYPE,
    cases.map((item) => ({ ...item, intentId: i.proposal.id })),
  );
};
