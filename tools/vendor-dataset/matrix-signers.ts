/**
 * Transaction signers for the dataset's non-default account shapes, shared by
 * the matrix stages. Argent 0.4.0 signature formats (from the account-0.4.0
 * source): a single stark owner may sign legacy [r,s]; owner+guardian legacy
 * [or,os,gr,gs]; guardian-alone, multisig seats and non-stark owners must use
 * the signer array [n, (variant, …)×n]. Keys stay inside the signer objects.
 */
import { EthSigner, ec, hash, num, Signer, uint256 } from "starknet";

export type KP = { readonly priv: string; readonly pub: string };

const { poseidonHashMany } = ec.starkCurve;

const sigOf = (msgHash: string, priv: string): [string, string] => {
  const sig = ec.starkCurve.sign(msgHash, priv);
  return [num.toHex(sig.r), num.toHex(sig.s)];
};

const firstKey = (keys: readonly KP[]): KP => {
  const [first] = keys;
  if (!first) throw new Error("a signer needs at least one key");
  return first;
};

/** Legacy multi-sig: [or, os] or [or, os, gr, gs]. */
export class LegacySigner extends Signer {
  constructor(private keys: KP[]) {
    super(firstKey(keys).priv);
  }
  override async signRaw(msgHash: string): Promise<string[]> {
    return this.keys.flatMap((k) => sigOf(msgHash, k.priv));
  }
}

/** Modern signer array: [n, (0, pubkey, r, s)×n] — required for guardian-alone and multisig seats. */
export class ModernSigner extends Signer {
  constructor(private keys: KP[]) {
    super(firstKey(keys).priv);
  }
  override async signRaw(msgHash: string): Promise<string[]> {
    return [
      num.toHex(this.keys.length),
      ...this.keys.flatMap((k) => ["0x0", k.pub, ...sigOf(msgHash, k.priv)]),
    ];
  }
}

/**
 * Braavos deploy signer: [r_tx, s_tx, ...params, r_aux, s_aux], where params is
 * the AdditionalDeploymentParams struct and the aux pair signs poseidon(params).
 */
export class BraavosDeploySigner extends Signer {
  constructor(
    private kp: KP,
    private params: string[],
  ) {
    super(kp.priv);
  }
  override async signRaw(msgHash: string): Promise<string[]> {
    const tx = ec.starkCurve.sign(msgHash, this.kp.priv);
    const auxHash = `0x${poseidonHashMany(this.params.map(BigInt)).toString(16)}`;
    const aux = ec.starkCurve.sign(auxHash, this.kp.priv);
    return [num.toHex(tx.r), num.toHex(tx.s), ...this.params, num.toHex(aux.r), num.toHex(aux.s)];
  }
}

/** Ethereum address (keccak-256 of the uncompressed public key, low 160 bits) of a secp256k1 key. */
export async function ethAddressOf(priv: string): Promise<string> {
  const pub = await new EthSigner(priv).getPubKey();
  // keccakBn reads a number, so a leading zero byte would be dropped from the input.
  if (pub.slice(2, 4) === "00") throw new Error("secp256k1 public key starts with a zero byte");
  return num.toHex(BigInt(hash.keccakBn(pub)) & ((1n << 160n) - 1n));
}

/**
 * Argent 0.4.0 secp256k1 owner: a one-entry signer array
 * [1, Secp256k1 (1), pubkey_hash, r.low, r.high, s.low, s.high, y_parity].
 */
export class ArgentSecp256k1Signer extends EthSigner {
  constructor(
    priv: string,
    private ethAddress: string,
  ) {
    super(priv);
  }
  protected override formatEthSignature(sig: { r: bigint; s: bigint; recovery: number }): string[] {
    const r = uint256.bnToUint256(sig.r);
    const s = uint256.bnToUint256(sig.s);
    return [
      "0x1",
      "0x1",
      this.ethAddress,
      num.toHex(r.low),
      num.toHex(r.high),
      num.toHex(s.low),
      num.toHex(s.high),
      num.toHex(sig.recovery),
    ];
  }
}
