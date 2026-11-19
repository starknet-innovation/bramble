/**
 * Sepolia fixtures on S-SCR: script-made Argent, Xverse and Braavos shapes on
 * every ladder (TA-15…TA-26, TA-30, TA-62), per the scope doc's TA cards, plus
 * TA-64 and TA-65 from the account-tree review (docs/VENDOR_IMPORT_DATASET.md). "argentx N"
 * on a card is the Ready double derivation at index N. Argent 0.4.0 calldata
 * and change_owner hashing follow the vendored account-0.4.0 source.
 */
import {
  Account,
  byteArray,
  CallData,
  cairo,
  ec,
  hash,
  OutsideExecutionVersion,
  shortString,
  uint256,
} from "starknet";
import {
  argentConstructor,
  braavosKeypair,
  brambleKeypair,
  CHAIN_ID,
  CLASSES,
  classAt,
  type ManifestEntry,
  provider,
  readyKeypair,
  TOKENS,
  tokenBalance,
  UDC,
} from "./matrix-lib";
import { ArgentSecp256k1Signer, ethAddressOf, type KP, LegacySigner } from "./matrix-signers";
import {
  deployer,
  invokeSelf,
  norm,
  type SepoliaFixture,
  STRK,
  selfDeploy,
  topUp,
  viewFelt,
} from "./sepolia-fixtures";
import { sepoliaSecret, sepoliaVar } from "./sepolia-seeds";

const { getStarkKey } = ec.starkCurve;
const SEED = sepoliaSecret("S-SCR");
const ready = (index: number): KP => readyKeypair(SEED, index);
const keyPair = (priv: string): KP => ({ priv, pub: getStarkKey(priv) });
const GUARDIAN = keyPair(sepoliaSecret("K-GRD"));
const NEW_OWNER = keyPair(sepoliaSecret("K-ROT-A"));

type Shape = {
  readonly classHash: string;
  readonly salt?: string;
  readonly calldata?: readonly string[];
};

const addressOf = (kp: KP, shape: Shape): string =>
  norm(
    hash.calculateContractAddressFromHash(
      shape.salt ?? kp.pub,
      shape.classHash,
      [...(shape.calldata ?? argentConstructor(kp.pub, shape.classHash))],
      0,
    ),
  );

/** One S-SCR account: deployed by itself (optionally followed by `after`) or only funded. */
function scripted(
  id: string,
  derivation: ManifestEntry["vendorDerivation"],
  index: number,
  kp: KP,
  shape: Shape,
  card: {
    readonly expected: string;
    readonly detectability: ManifestEntry["detectability"];
    readonly backedBy?: ManifestEntry["backedBy"];
    readonly fundOnly?: boolean;
    readonly signer?: LegacySigner;
    readonly after?: (e: ManifestEntry) => Promise<Record<string, unknown>>;
  },
): SepoliaFixture {
  const salt = shape.salt ?? kp.pub;
  return {
    id,
    seed: sepoliaVar("S-SCR"),
    vendorDerivation: derivation,
    index,
    address: addressOf(kp, shape),
    pubkey: kp.pub,
    classAtDeploy: card.fundOnly ? null : shape.classHash,
    expected: card.expected,
    detectability: card.detectability,
    backedBy: card.backedBy ?? "none",
    step: async (e) => {
      if (card.fundOnly) {
        await topUp(e, "STRK", STRK);
        return { state: { deployed: false, funded: "STRK", salt, shapeClass: shape.classHash } };
      }
      await selfDeploy(e, {
        signer: card.signer ?? kp.priv,
        classHash: shape.classHash,
        calldata: shape.calldata ?? argentConstructor(kp.pub, shape.classHash),
        salt,
      });
      const extra = card.after ? await card.after(e) : {};
      return { state: { deployed: true, salt, liveClass: await classAt(e.address), ...extra } };
    },
  };
}

// TA-15: guardian set in the constructor — [owner Signer::Starknet(pk),
// guardian Option::Some (0) of Signer::Starknet (0) gpk] — at a fixed salt
// standing in for Ready's backend-chosen one. Deploy needs both signatures.
const ta15 = ready(5);
const TA15_SALT = "0x15a175";
const ta15Calldata = ["0x0", ta15.pub, "0x0", "0x0", GUARDIAN.pub];

// TA-17 (0.3.0 → 0.4.0) and TA-62 (0.4.0 → 0.5.0): deployed at one release,
// then upgraded in place, so the address keeps the older shape.
const upgradeTo =
  (cls: string, index: number) =>
  async (e: ManifestEntry): Promise<Record<string, unknown>> => {
    const live = await classAt(e.address);
    if (live && BigInt(live) !== BigInt(cls)) {
      await invokeSelf(e, new LegacySigner([ready(index)]), "upgrade", [cls, "0x0"]);
    }
    return { upgradedTo: cls };
  };

// TA-20: change_owner takes the new owner's SignerSignature over
// pedersen-array(selector("change_owner"), chain id, account, old owner guid).
const changeOwner = async (e: ManifestEntry): Promise<Record<string, unknown>> => {
  const current = ready(3);
  if ((await viewFelt(e.address, "get_owner")) === BigInt(current.pub)) {
    const oldGuid = hash.computePoseidonHash(
      shortString.encodeShortString("Starknet Signer"),
      current.pub,
    );
    const msg = hash.computeHashOnElements([
      hash.getSelectorFromName("change_owner"),
      CHAIN_ID,
      e.address,
      oldGuid,
    ]);
    const sig = ec.starkCurve.sign(msg, NEW_OWNER.priv);
    await invokeSelf(e, current.priv, "change_owner", [
      "0x0",
      NEW_OWNER.pub,
      `0x${sig.r.toString(16)}`,
      `0x${sig.s.toString(16)}`,
    ]);
  }
  return { owner: NEW_OWNER.pub };
};

// TA-22: deployed through the UDC by the bank with unique = 1, so the
// deployer folds into the salt and the UDC is the deploying address.
const ta22 = ready(7);
const ta22Address = norm(
  hash.calculateContractAddressFromHash(
    hash.computePedersenHash(deployer.address, ta22.pub),
    CLASSES.argent040,
    argentConstructor(ta22.pub, CLASSES.argent040),
    UDC,
  ),
);

// TA-64: deployed, then every STRK swept out through a SNIP-9 outside
// execution the bank submits and pays for, so the balance lands on exactly
// zero. An ordinary transfer always leaves fee dust, which is the "near-zero"
// mainnet fixture already covers; this one tests the class probe alone.
const ta64 = ready(10);
const sweepAll = async (e: ManifestEntry): Promise<Record<string, unknown>> => {
  const balance = await tokenBalance("STRK", e.address);
  if (balance > 0n) {
    const account = new Account({
      provider,
      address: e.address,
      signer: ta64.priv,
      cairoVersion: "1",
    });
    // The window is wide on purpose: the public node's clock and ours need not agree.
    const now = Math.floor(Date.now() / 1000);
    const amount = uint256.bnToUint256(balance);
    const outside = await account.getOutsideTransaction(
      { caller: deployer.address, execute_after: now - 3600, execute_before: now + 3600 },
      {
        contractAddress: TOKENS.STRK.address,
        entrypoint: "transfer",
        calldata: [deployer.address, amount.low, amount.high],
      },
      OutsideExecutionVersion.V2,
    );
    const { transaction_hash } = await deployer.executeFromOutside(outside);
    await provider.waitForTransaction(transaction_hash);
    e.log.push(`swept ${transaction_hash}`);
    console.log(`   swept: ${transaction_hash.slice(0, 10)}…`);
  }
  if ((await tokenBalance("STRK", e.address)) !== 0n) throw new Error("TA-64 still holds STRK");
  return { swept: true };
};

// TA-65: an undeployed counterfactual whose only asset is one ERC-721, minted
// to it at the collection's construction (OpenZeppelin Contracts for Cairo
// 2.0.0 ERC721Upgradeable preset, declared on Sepolia; constructor name,
// symbol, base_uri, recipient, token_ids, owner). Deployed by the bank through
// the UDC with unique = 1, like TA-11's token.
const OZ_ERC721 = "0x0077dcbd0d9907cff8b84dcf0c3006ab07b27a7db1e1e4e12b272d6b1fcdad4c";
const NFT_SALT = "0x65";
const ta65 = ready(11);
const ta65Address = addressOf(ta65, { classHash: CLASSES.argent040 });
const nftCalldata = CallData.compile([
  byteArray.byteArrayFromString("Bramble Test Collectible"),
  byteArray.byteArrayFromString("BTC"),
  byteArray.byteArrayFromString(""),
  ta65Address,
  [cairo.uint256(1)],
  deployer.address,
]);
const nftAddress = norm(
  hash.calculateContractAddressFromHash(
    hash.computePedersenHash(deployer.address, NFT_SALT),
    OZ_ERC721,
    nftCalldata,
    UDC,
  ),
);
const mintCollectible = async (e: ManifestEntry): Promise<Record<string, unknown>> => {
  if (!(await classAt(nftAddress))) {
    const { transaction_hash } = await deployer.execute({
      contractAddress: UDC,
      entrypoint: "deployContract",
      calldata: [
        OZ_ERC721,
        NFT_SALT,
        "0x1",
        `0x${nftCalldata.length.toString(16)}`,
        ...nftCalldata,
      ],
    });
    await provider.waitForTransaction(transaction_hash);
    e.log.push(`collectible-deployed ${transaction_hash}`);
    console.log(`   collectible deployed: ${transaction_hash.slice(0, 10)}…`);
  }
  const [low = "0x0"] = await provider.callContract({
    contractAddress: nftAddress,
    entrypoint: "balance_of",
    calldata: [e.address],
  });
  if (BigInt(low) === 0n) throw new Error("TA-65 holds no collectible");
  return { collectible: nftAddress, tokenId: "0x1" };
};

// TA-25: an Ethereum-key owner, Signer::Secp256k1 (1) of its address.
const secpOwner = sepoliaSecret("K-SECP");
const secpAddress = await ethAddressOf(secpOwner);
const TA25_SALT = "0x25";
const ta25Calldata = ["0x1", secpAddress, "0x1"];

export const SCR_FIXTURES: readonly SepoliaFixture[] = [
  scripted(
    "s-scr/TA-15",
    "ready-double",
    5,
    ta15,
    { classHash: CLASSES.argent040, salt: TA15_SALT, calldata: ta15Calldata },
    {
      expected: "simulated smart account: guardian from deploy, salt not the pubkey",
      detectability: "D4",
      backedBy: "simulated",
      signer: new LegacySigner([ta15, GUARDIAN]),
    },
  ),
  scripted(
    "s-scr/TA-16",
    "ready-double",
    0,
    ready(0),
    { classHash: CLASSES.argent031 },
    {
      expected: "Argent 0.3.1, never upgraded",
      detectability: "D2",
    },
  ),
  scripted(
    "s-scr/TA-17",
    "ready-double",
    1,
    ready(1),
    { classHash: CLASSES.argent030 },
    {
      expected: "address from the 0.3.0 shape; live class 0.4.0",
      detectability: "D2",
      after: upgradeTo(CLASSES.argent040, 1),
    },
  ),
  scripted(
    "s-scr/TA-18",
    "ready-double",
    2,
    ready(2),
    { classHash: CLASSES.argent031 },
    {
      expected: "Argent 0.3.1 funded counterfactual",
      detectability: "D2",
      fundOnly: true,
    },
  ),
  scripted(
    "s-scr/TA-19",
    "bramble-account",
    0,
    brambleKeypair(SEED, 0),
    { classHash: CLASSES.argent040 },
    {
      expected: "Argent 0.4.0 on Bramble's own ladder (account 0)",
      detectability: "D1",
    },
  ),
  scripted(
    "s-scr/TA-20",
    "ready-double",
    3,
    ready(3),
    { classHash: CLASSES.argent040 },
    {
      expected: "owner changed to K-ROT-A: found at the seed's address, not signable by it",
      detectability: "D5",
      backedBy: "simulated",
      after: changeOwner,
    },
  ),
  scripted(
    "s-scr/TA-21",
    "ready-double",
    6,
    ready(6),
    { classHash: CLASSES.argent040, salt: "0x5a17" },
    {
      expected: "custom salt: seed-owned key at an address the seed cannot recompute",
      detectability: "D4",
    },
  ),
  {
    id: "s-scr/TA-22",
    seed: sepoliaVar("S-SCR"),
    vendorDerivation: "ready-double",
    index: 7,
    address: ta22Address,
    pubkey: ta22.pub,
    classAtDeploy: CLASSES.argent040,
    expected: "deployed via the UDC with unique = 1: the bank's address folds into it",
    detectability: "D4",
    backedBy: "none",
    step: async (e) => {
      if (!(await classAt(e.address))) {
        const { transaction_hash } = await deployer.execute({
          contractAddress: UDC,
          entrypoint: "deployContract",
          calldata: [
            CLASSES.argent040,
            ta22.pub,
            "0x1",
            "0x3",
            ...argentConstructor(ta22.pub, CLASSES.argent040),
          ],
        });
        await provider.waitForTransaction(transaction_hash);
        e.log.push(`udc-deployed ${transaction_hash}`);
      }
      const liveClass = await classAt(e.address);
      if (!liveClass) throw new Error("UDC deploy landed somewhere else");
      return { state: { deployed: true, deployedBy: "UDC unique=1", liveClass } };
    },
  },
  scripted(
    "s-scr/TA-23",
    "ready-double",
    8,
    ready(8),
    { classHash: CLASSES.argent040, salt: "0x5eed" },
    {
      expected: "custom-salt counterfactual, funded: invisible from the seed",
      detectability: "D5",
      fundOnly: true,
    },
  ),
  scripted(
    "s-scr/TA-24",
    "ready-double",
    250,
    ready(250),
    { classHash: CLASSES.argent040 },
    {
      expected: "index 250: beyond the owner-search cap",
      detectability: "D2",
    },
  ),
  scripted(
    "s-scr/TA-62",
    "ready-double",
    9,
    ready(9),
    { classHash: CLASSES.argent040 },
    {
      expected: "upgraded to Argent 0.5.0: found at its 0.4.0 address, view only (release)",
      detectability: "D2",
      after: upgradeTo(CLASSES.argent050, 9),
    },
  ),
  scripted(
    "s-scr/TA-64",
    "ready-double",
    10,
    ta64,
    { classHash: CLASSES.argent040 },
    {
      expected: "deployed, then emptied to exactly zero: the class probe alone must list it",
      detectability: "D2",
      after: sweepAll,
    },
  ),
  {
    id: "s-scr/TA-65",
    seed: sepoliaVar("S-SCR"),
    vendorDerivation: "ready-double",
    index: 11,
    address: ta65Address,
    pubkey: ta65.pub,
    classAtDeploy: null,
    expected: "undeployed, holds only an ERC-721: no balance probe sees it",
    detectability: "D3",
    backedBy: "none",
    step: async (e) => ({ state: { deployed: false, ...(await mintCollectible(e)) } }),
  },
  {
    id: "key/TA-25",
    seed: sepoliaVar("K-SECP"),
    vendorDerivation: "key",
    index: 0,
    address: norm(
      hash.calculateContractAddressFromHash(TA25_SALT, CLASSES.argent040, ta25Calldata, 0),
    ),
    pubkey: secpAddress,
    classAtDeploy: CLASSES.argent040,
    expected: "Argent 0.4.0 with a secp256k1 owner: no stark key can sign for it",
    detectability: "D5",
    backedBy: "none",
    step: async (e) => {
      const liveClass = await selfDeploy(e, {
        signer: new ArgentSecp256k1Signer(secpOwner, secpAddress),
        classHash: CLASSES.argent040,
        calldata: ta25Calldata,
        salt: TA25_SALT,
      });
      return { state: { deployed: true, salt: TA25_SALT, ownerType: "secp256k1", liveClass } };
    },
  },
  scripted(
    "s-scr/TA-26",
    "bramble-account",
    1,
    brambleKeypair(SEED, 1),
    { classHash: CLASSES.xverse040 },
    {
      expected: "Xverse class on Bramble's ladder (account 1), standing in for the Xverse app",
      detectability: "D1",
    },
  ),
  scripted(
    "s-scr/TA-30",
    "braavos-direct",
    4,
    braavosKeypair(SEED, 4),
    { classHash: CLASSES.braavosBase, calldata: [braavosKeypair(SEED, 4).pub] },
    {
      expected: "Braavos base-class counterfactual: Bramble refuses to deploy it",
      detectability: "D2",
      fundOnly: true,
    },
  ),
];
