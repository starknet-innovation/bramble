// Public-only adapter over the pinned qsb-app SDK's packet, hit and simulation code.
// Never call buildLock, assemblePqb or any seed-bearing SDK method here.
import "./pqb-sdk-prelude.js";
import {
  checkPqbHit,
  pqbPacket,
  pqbPublicStateSchema,
  pqbTransaction,
} from "../vendor/pqb/src/lib/pqb.ts";
import {
  encodings,
  evaluate,
  parseHit,
  parseStrictDer,
  parseTxHex,
  pointsFromPacket,
  roundSelection,
} from "../vendor/pqb/src/pqb-core/grind.ts";
import { derSig, dummyPool, pushData, scriptnumBytes } from "../vendor/pqb/src/pqb-core/l1gen.ts";
import {
  concat,
  fromHex,
  hex,
  N,
  Point,
  powmod,
  toInt,
} from "../vendor/pqb/src/pqb-core/primitives.ts";
import { Item, makeResolver, makeRollResolver, Sim } from "../vendor/pqb/src/pqb-core/sim.ts";
import { pinNonceOf, recoverPubkey } from "../vendor/pqb/src/pqb-core/spend.ts";
import {
  findAndDelete,
  legacySighashAll,
  parseScript,
  serializeTx,
} from "../vendor/pqb/src/pqb-core/tx.ts";

const table = dummyPool(109, 0).map(([a, b]) => derSig(BigInt(a), BigInt(b)));
export function publicState(material) {
  const stages = material.menus.map((m) => ({
    menu: {
      r_inv: powmod(BigInt("0x" + m.r), N - 2n, N).toString(),
      variants: m.recoveryPoints.map((points, i) => ({ add_n: i >= 2, odd: i % 2 === 1, points })),
    },
  }));
  return JSON.stringify(
    pqbPublicStateSchema.parse({
      config: "PQB",
      full_script_hex: material.script,
      round_table: table.map(hex),
      stages,
    }),
  );
}
export function validatePublicState(text) {
  return pqbPublicStateSchema.safeParse(JSON.parse(text)).success;
}
// The public parts of SDK assemblePqb, without seed-derived Lock/witnessPlan inputs.
export function prepare(material, manifest, solution) {
  const pub = publicState(material),
    hits = solution.pqb;
  if (!hits || !hits.round0 || !hits.round1) throw new Error("Incomplete PQB solution");
  const selection = [],
    menus = [],
    keys = [],
    sighashes = [];
  for (const [stage, line] of [hits.pinning, hits.round0, hits.round1].entries()) {
    const p = pqbPacket(pub, manifest, stage, solution),
      solved = checkPqbHit(p, line);
    if (!solved) throw new Error("PQB hit failed verification");
    const parsed = parseHit(p, line),
      { z } = evaluate(
        p,
        parsed.nonce,
        parsed.variant,
        parsed.menuIndex,
        parsed.encoding,
        parsed.ladder,
      );
    if (stage === 0) {
      if (parsed.nonce !== pinNonceOf(solution.locktime, solution.sequence))
        throw new Error("PQB pin changed");
    } else selection.push(roundSelection(p, parsed.nonce));
    const { rinv, variants } = pointsFromPacket(p),
      A = variants[parsed.variant].points[parsed.menuIndex];
    const neg = (N - ((rinv * z) % N)) % N,
      key = neg === 0n ? A : A.add(Point.BASE.multiply(neg));
    const encoded = encodings(key, p.only_33_byte_keys)[parsed.encoding];
    if (!encoded) throw new Error("PQB key encoding invalid");
    keys.push(hex(encoded));
    menus.push(parsed.menuIndex);
    sighashes.push(
      hex(new Uint8Array(32).map((_, i) => Number((z >> BigInt((31 - i) * 8)) & 255n))),
    );
  }
  if (JSON.stringify(selection) !== JSON.stringify([solution.round1, solution.round2]))
    throw new Error("PQB selection changed");
  return {
    transaction: hex(serializeTx(pqbTransaction(manifest, solution.sequence, solution.locktime))),
    scriptHash: material.scriptSha256,
    round0: selection[0],
    round1: selection[1],
    menus,
    keys,
    sighashes,
  };
}
// Adapted from SDK core spend.assemble: only public key recovery, Script index
// resolution and serialization remain; every signing/witness value is supplied by Krusty.
export function finish(material, prepared, witness) {
  const txhex = prepared.transaction;
  // parse the SDK's own canonical transaction to retain exactly its input/output layout.
  const { tx } = parseUnsigned(txhex);
  const script = fromHex(material.script),
    selections = [prepared.round0, prepared.round1];
  const vals = new Map(),
    targets = new Map(),
    slots = [];
  const sighashes = [legacySighashAll(tx, 1, script)];
  for (const row of selections) {
    let code = script;
    for (const i of row) [code] = findAndDelete(code, pushData(table[i]));
    sighashes.push(legacySighashAll(tx, 1, code));
  }
  if (JSON.stringify(sighashes.map(hex)) !== JSON.stringify(prepared.sighashes))
    throw new Error("PQB stage binding changed");
  for (const r of [0, 1]) {
    slots.push("kn" + r);
    vals.set("kn" + r, fromHex(prepared.keys[r + 1]));
    selections[r].forEach((j, a) => {
      const d = table[j],
        z = toInt(sighashes[r + 1]);
      const key =
        recoverPubkey(BigInt(d[4]), BigInt(d[7]), z, 0) ??
        recoverPubkey(BigInt(d[4]), BigInt(d[7]), z, 1);
      if (!key) throw new Error("PQB dummy key invalid");
      vals.set(`k${r}_${a}`, key.toBytes(true));
      slots.push(`k${r}_${a}`);
      vals.set(`pre${r}_${a}`, fromHex(witness[r === 0 ? "round0" : "round1"][a]));
      targets.set(`i${r}_${a}`, fromHex(material.commitments[j]));
    });
  }
  for (const r of [1, 0])
    for (let a = selections[r].length - 1; a >= 0; a--) slots.push(`pre${r}_${a}`);
  for (const r of [1, 0])
    for (let a = selections[r].length - 1; a >= 0; a--) slots.push(`i${r}_${a}`);
  for (const r of [0, 1]) {
    slots.push("msig" + r, "midx" + r);
    vals.set("msig" + r, fromHex(witness.menus[r + 1]));
    targets.set("midx" + r, fromHex(material.menus[r + 1].commitments[prepared.menus[r + 1]]));
  }
  slots.push("menu_idx", "menu_sig", "knpin", "cosig_sig", "cosig_pk");
  targets.set("menu_idx", fromHex(material.menus[0].commitments[prepared.menus[0]]));
  vals.set("menu_sig", fromHex(witness.menus[0]));
  vals.set("knpin", fromHex(prepared.keys[0]));
  vals.set("cosig_sig", fromHex(witness.cosignature));
  vals.set("cosig_pk", fromHex(material.cosigPublicKey));
  const isIndex = (s) => s.startsWith("i") || s === "menu_idx" || s.startsWith("midx");
  for (let stage = 0; stage < 3; stage++) {
    const [r, s] = parseStrictDer(fromHex(witness.menus[stage])) ?? [];
    if (!r || !s) throw new Error("PQB menu signature invalid");
    const z = toInt(sighashes[stage]);
    const key = recoverPubkey(r, s, z, 0) ?? recoverPubkey(r, s, z, 1);
    if (!key) throw new Error("PQB menu key invalid");
    vals.set(stage === 0 ? "knpin" : "kn" + (stage - 1), key.toBytes(true));
  }
  const initial = slots.map(
    (s) => new Item(isIndex(s) ? Uint8Array.of(0) : vals.get(s), "sigslot:" + s),
  );
  const sim = new Sim(
    parseScript(script),
    initial,
    makeResolver(targets),
    makeRollResolver(targets),
  );
  sim.run();
  for (let stage = 0; stage < 3; stage++)
    vals.set(stage === 0 ? "knpin" : "kn" + (stage - 1), fromHex(prepared.keys[stage]));
  const stack = slots.map((s) => (isIndex(s) ? scriptnumBytes(sim.resolved.get(s)) : vals.get(s)));
  if (stack.some((v) => !(v instanceof Uint8Array))) throw new Error("PQB witness incomplete");
  tx.vin[1].scriptSig = concat(...stack.map(pushData));
  return hex(serializeTx(tx));
}
function parseUnsigned(text) {
  return { tx: parseTxHex(text) };
}
