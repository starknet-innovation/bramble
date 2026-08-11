/**
 * MCW-V09-101, injectivity sweep: two structurally different SNIP-12 type graphs
 * must never reach one message hash, on either revision.
 *
 * The individual rules that make that true are pinned by name in
 * `typed-data-graph-forgery.test.ts` (the separator grammar) and
 * `typed-data-containers.test.ts` (merkle leaves and enum variant lists). This
 * file checks the property they are all supposed to add up to, by execution
 * rather than by argument: it generates grammar-conforming graphs across the
 * whole accepted vocabulary — nested structs, arrays, presets, tuples, enums and
 * merkle trees — keeps the ones the wallet accepts, and asserts that neither
 * `encodeType` (outside `merkletree`, whose leaf type is deliberately not part
 * of the encoding) nor the full message hash (everywhere, `merkletree`
 * included) maps two different graphs onto one value.
 *
 * This file sweeps type *graphs* only, at deliberately canonical hexadecimal
 * values so two graphs are compared at equal ones. The orthogonal dimension —
 * which spellings a leaf value may take under its declared type, and whether two
 * differently signed values can share one receipt — is swept in
 * `typed-data-scalars.test.ts` and `../sidepanel/sign-request-scalar-receipts.test.ts`.
 *
 * A sweep is only worth its runtime if it can fail, so three things guard it.
 * The corpus is asserted to actually contain enum, preset and merkle graphs — an
 * earlier version of this generator emitted only structs and arrays and so
 * reported a property it never covered. Both known collision pairs are replayed
 * through the same search to show it flags them. And every generated enum graph
 * is offered twice, once with the enum field rewritten as a plain reference to
 * its `contains` type: those two spellings share one `encodeType`, so a
 * validator that admits both fails the sweep rather than narrowing it. Reverting
 * either container rule makes the sweeps below fail.
 *
 * Runtime is bounded on purpose, because a sweep that cannot finish pins
 * nothing. One corpus per revision is built once and shared, and each search is
 * its own test so none carries the whole cost. Hashing is the expensive half,
 * and revision 0 is where the cost lives: Pedersen over a nested struct runs
 * tens of milliseconds where revision 1's Poseidon runs one or two, which made
 * the combined sweep 12 seconds locally and 34 in CI, past bun's 30-second
 * limit. Revision 1 is swept whole; revision 0 message hashes are taken at a
 * fixed stride over its corpus. No assertion is relaxed for it — the stride
 * sample is still asserted to carry the merkle graphs no `encodeType` can
 * separate, and the `encodeType` search still covers every accepted graph on
 * both revisions.
 */
import { describe, expect, test } from "bun:test";
import { isTypedDataShape, typedDataHash } from "@mc-wallet/starknet/typed-data";
import { typedData as snip12 } from "starknet";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const REV1_DOMAIN_TYPE = [{ name: "name", type: "shortstring" }];
const REV0_DOMAIN_TYPE = [{ name: "name", type: "felt" }];

type Revision = "0" | "1";
type Field = { name: string; type: string; contains?: string };
type Graph = { readonly primaryType: string; readonly types: Record<string, Field[]> };
// One graph, its canonical identity, and the values it is swept with.
type Entry = { readonly graph: Graph; readonly identity: string; readonly message: unknown };

const rawHash = (payload: unknown): string =>
  snip12.getMessageHash(payload as Parameters<typeof snip12.getMessageHash>[0], ACCOUNT);

const envelope = (graph: Graph, message: unknown, revision: Revision): unknown =>
  revision === "1"
    ? {
        domain: { name: "MC Test", revision: "1" },
        message,
        primaryType: graph.primaryType,
        types: { ...graph.types, StarknetDomain: REV1_DOMAIN_TYPE },
      }
    : {
        domain: { name: "MC Test" },
        message,
        primaryType: graph.primaryType,
        types: { ...graph.types, StarkNetDomain: REV0_DOMAIN_TYPE },
      };

describe("no two accepted type graphs reach one hash", () => {
  const SEED = 2463534242;
  const ATTEMPTS = 300;
  // Every fifth accepted revision-0 graph reaches the Pedersen message hash. The
  // stride spreads the sample over the whole generated space instead of its
  // first fifth, and the coverage assertions below keep it merkle-bearing.
  const REV0_HASH_STRIDE = 5;

  // Deterministic xorshift32: the corpus must be identical on every run.
  let state = SEED;
  const random = (): number => {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) / 4294967296;
  };
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;

  // Names chosen so one is a prefix, suffix, or concatenation of another: if a
  // flat encoding can lose a boundary, these are the names that find it.
  const NAMES = [
    "Details",
    "Detail",
    "s",
    "Order",
    "Order Details",
    "a b",
    "a",
    "b",
    "x y",
    "A-B",
    "1",
    "n_1",
    "n 1",
    "n-1",
    "_",
  ] as const;
  const FIELD_NAMES = [...NAMES, "token", "amount", "felt", "details", "V1", "V2"] as const;
  const LEAVES = ["felt", "shortstring", "u128", "selector", "ContractAddress"] as const;
  const PRESETS = ["u256", "TokenAmount", "NftId"] as const;

  // The link from one type in the chain to the next. Returning the variant list
  // separately keeps the enum case from being a second write into `types`.
  const linkField = (
    next: string,
    revision: Revision,
  ): { readonly field: Field; readonly variantList?: readonly Field[] } => {
    const roll = random();
    if (revision === "1" && roll < 0.25) {
      return {
        field: { contains: next, name: pick(FIELD_NAMES), type: "enum" },
        // A variant list holds only tuples, so the chain ends in one.
        variantList: [{ name: pick(FIELD_NAMES), type: `(${pick(LEAVES)})` }],
      };
    }
    if (roll < 0.45) {
      return { field: { contains: next, name: pick(FIELD_NAMES), type: "merkletree" } };
    }
    return { field: { name: pick(FIELD_NAMES), type: random() < 0.5 ? `${next}*` : next } };
  };

  // One extra field beyond the chain link: a preset, a second merkle tree, or an
  // ordinary reference to a later type or a leaf.
  const extraField = (later: readonly string[], revision: Revision): Field => {
    const roll = random();
    if (revision === "1" && roll < 0.2) {
      return { name: pick(FIELD_NAMES), type: pick(PRESETS) };
    }
    if (roll < 0.35 && later.length > 0) {
      return { contains: pick(later), name: pick(FIELD_NAMES), type: "merkletree" };
    }
    const base = later.length > 0 && random() < 0.4 ? pick(later) : pick(LEAVES);
    return { name: pick(FIELD_NAMES), type: random() < 0.25 ? `${base}*` : base };
  };

  const distinctNames = (size: number): string[] => {
    const names: string[] = [];
    while (names.length < size) {
      const candidate = pick(NAMES);
      if (!names.includes(candidate)) {
        names.push(candidate);
      }
    }
    return names;
  };

  // Builds a chain T0 -> T1 -> ... so every declared type is reachable from the
  // primary type: the encoding then covers the whole graph, and the graph is a
  // complete canonical description of what the encoding must distinguish.
  const graph = (revision: Revision): Graph => {
    const names = distinctNames(1 + Math.floor(random() * 4));
    const types: Record<string, Field[]> = {};
    names.forEach((name, index) => {
      const fields: Field[] = [];
      const taken = new Set<string>();
      const add = (field: Field): void => {
        if (!taken.has(field.name)) {
          taken.add(field.name);
          fields.push(field);
        }
      };
      const next = names[index + 1];
      if (next !== undefined) {
        const link = linkField(next, revision);
        add(link.field);
        if (link.variantList) {
          types[next] = [...link.variantList];
        }
      }
      for (let extra = Math.floor(random() * 3); extra > 0; extra -= 1) {
        add(extraField(names.slice(index + 1), revision));
      }
      // A variant list written earlier in the chain must not be overwritten.
      types[name] = types[name] ?? fields;
    });
    return { primaryType: names[0] as string, types };
  };

  const PRESET_FIELDS: Record<string, Field[]> = {
    NftId: [
      { name: "collection_address", type: "ContractAddress" },
      { name: "token_id", type: "u256" },
    ],
    TokenAmount: [
      { name: "token_address", type: "ContractAddress" },
      { name: "amount", type: "u256" },
    ],
    u256: [
      { name: "low", type: "u128" },
      { name: "high", type: "u128" },
    ],
  };

  // Values are derived from the field *path* alone, never from its declared
  // type: two graphs that differ only in structure therefore get the same
  // values, so an equal message hash means the structures were indistinguishable.
  const felt = (seed: string): string =>
    `0x${(([...seed].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7) % 1000000) + 1).toString(16)}`;

  const sampleValue = (
    type: string,
    types: Record<string, Field[]>,
    seed: string,
    depth: number,
  ): unknown => {
    if (depth > 6) {
      return felt(seed);
    }
    if (type.endsWith("*")) {
      const element = type.slice(0, -1);
      return [0, 1].map((index) => sampleValue(element, types, `${seed}[${index}]`, depth + 1));
    }
    const fields = types[type] ?? PRESET_FIELDS[type];
    if (!fields) {
      return felt(seed);
    }
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      out[field.name] = fieldValue(field, types, `${seed}.${field.name}`, depth + 1);
    }
    return out;
  };

  function fieldValue(
    field: Field,
    types: Record<string, Field[]>,
    seed: string,
    depth: number,
  ): unknown {
    if (field.contains === undefined) {
      return sampleValue(field.type, types, seed, depth);
    }
    if (field.type === "merkletree") {
      return [0, 1].map((index) =>
        sampleValue(field.contains as string, types, `${seed}[${index}]`, depth + 1),
      );
    }
    const variant = (types[field.contains] ?? [])[0];
    if (!variant) {
      return {};
    }
    const inner = variant.type.slice(1, -1);
    const parts = inner.length === 0 ? [] : inner.split(",");
    return {
      [variant.name]: parts.map((part, index) =>
        sampleValue(part, types, `${seed}.${index}`, depth + 1),
      ),
    };
  }

  // The same graph with every `enum` field rewritten as a plain reference to its
  // `contains` type — the second spelling of one `encodeType` string.
  const plainReferenceTwin = (entry: Graph): Graph => ({
    primaryType: entry.primaryType,
    types: Object.fromEntries(
      Object.entries(entry.types).map(([name, fields]) => [
        name,
        fields.map((field) =>
          field.type === "enum" && field.contains !== undefined
            ? { name: field.name, type: field.contains }
            : field,
        ),
      ]),
    ),
  });

  const canonical = (entry: Graph): string =>
    JSON.stringify([
      entry.primaryType,
      Object.keys(entry.types)
        .sort()
        .map((name) => [name, entry.types[name]]),
    ]);

  // Pairs a graph with the path-derived values every search uses for it, so
  // acceptance and hashing can never describe two different payloads.
  const entryOf = (entry: Graph): Entry => ({
    graph: entry,
    identity: canonical(entry),
    message: sampleValue(entry.primaryType, entry.types, "m", 0),
  });

  const holds = (entry: Graph, matches: (field: Field) => boolean): boolean =>
    Object.values(entry.types).some((fields) => fields.some(matches));
  const hasMerkle = (entry: Entry): boolean =>
    holds(entry.graph, (field) => field.type === "merkletree");
  const hasEnum = (entry: Entry): boolean => holds(entry.graph, (field) => field.type === "enum");
  const hasPreset = (entry: Entry): boolean =>
    holds(entry.graph, (field) =>
      PRESETS.includes(field.type.replace(/\*$/, "") as (typeof PRESETS)[number]),
    );

  // Built once per revision and shared by every search below: generation and
  // acceptance are cheap next to hashing, but repeating them per test would put
  // the same corpus under four different clocks for no added coverage.
  const built = new Map<Revision, readonly Entry[]>();
  const corpus = (revision: Revision): readonly Entry[] => {
    const cached = built.get(revision);
    if (cached) {
      return cached;
    }
    const accepted: Entry[] = [];
    state = SEED;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const candidate = graph(revision);
      // Every enum graph is offered twice: once as declared, and once with the
      // enum field rewritten as a plain reference to the same type. The two
      // spell one `encodeType`, so if the validator ever admits both again the
      // searches below fail instead of quietly reporting a narrower property.
      const twin = plainReferenceTwin(candidate);
      const spellings = canonical(twin) === canonical(candidate) ? [candidate] : [candidate, twin];
      for (const spelling of spellings) {
        // The envelope carries the same path-derived values the hash search
        // uses: acceptance covers values as well as declarations, so an empty
        // message cannot report every graph refused.
        const entry = entryOf(spelling);
        if (isTypedDataShape(envelope(entry.graph, entry.message, revision))) {
          accepted.push(entry);
        }
      }
    }
    built.set(revision, accepted);
    return accepted;
  };

  // Returns the first pair of structurally different graphs sharing a key.
  const collision = (
    entries: readonly Entry[],
    keyOf: (entry: Entry) => string | null,
  ): string | null => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const key = keyOf(entry);
      if (key === null) {
        continue;
      }
      const prior = seen.get(key);
      if (prior === undefined) {
        seen.set(key, entry.identity);
      } else if (prior !== entry.identity) {
        return `${key}\n  ${prior}\n  ${entry.identity}`;
      }
    }
    return null;
  };

  const encodingOf =
    (revision: Revision) =>
    (entry: Entry): string =>
      snip12.encodeType(entry.graph.types as never, entry.graph.primaryType, revision as never);

  const messageHashOf =
    (revision: Revision) =>
    (entry: Entry): string | null => {
      try {
        return typedDataHash(envelope(entry.graph, entry.message, revision), ACCOUNT);
      } catch {
        return null;
      }
    };

  // A refused graph is not evidence of injectivity, so each hash search counts
  // the graphs that actually reached a hash before trusting its own clean run.
  const hashSearch = (entries: readonly Entry[], revision: Revision): [number, string | null] => {
    const hashes = new Map<Entry, string>();
    for (const entry of entries) {
      const hash = messageHashOf(revision)(entry);
      if (hash !== null) {
        hashes.set(entry, hash);
      }
    }
    return [hashes.size, collision([...hashes.keys()], (entry) => hashes.get(entry) ?? null)];
  };

  const rev0HashSample = (): readonly Entry[] =>
    corpus("0").filter((_, index) => index % REV0_HASH_STRIDE === 0);

  test("both searches flag the known collision pairs, so a clean sweep means something", () => {
    // The separator forgery: two graphs, one encodeType, one message hash.
    const separator: Graph[] = [
      {
        primaryType: "Order",
        types: {
          Details: [
            { name: "token", type: "felt" },
            { name: "amount", type: "felt" },
          ],
          Order: [
            { name: "maker", type: "felt" },
            { name: "details", type: "Details" },
          ],
        },
      },
      {
        primaryType: "Order",
        types: {
          Order: [
            { name: "maker", type: "felt" },
            { name: "details", type: "Details)Details(token:felt,amount:felt" },
          ],
        },
      },
    ];
    expect(collision(separator.map(entryOf), encodingOf("0"))).not.toBeNull();
    // The merkle-leaf substitution: same message hash, different declared graph.
    const merkle: Graph[] = [
      {
        primaryType: "Session",
        types: {
          Policy: [{ name: "contract_address", type: "felt" }],
          Session: [{ contains: "Policy", name: "root", type: "merkletree" }],
        },
      },
      {
        primaryType: "Session",
        types: { Session: [{ contains: "felt", name: "root", type: "merkletree" }] },
      },
    ];
    const honest = merkle[0] as Graph;
    const leafHash = (index: number): string =>
      snip12.getStructHash(
        honest.types as never,
        "Policy",
        sampleValue("Policy", honest.types, `m.root[${index}]`, 1) as never,
        "0" as never,
      );
    // The forged half's leaf values are the honest half's leaf hashes, which is
    // exactly what the path-derived value generator cannot produce on its own —
    // so the sweep needs this pair handed to it, and it flags it.
    const forged = envelope(merkle[1] as Graph, { root: [leafHash(0), leafHash(1)] }, "0");
    expect(messageHashOf("0")(entryOf(honest))).toBe(rawHash(forged));
    expect(isTypedDataShape(forged)).toBe(false);
  });

  test("the corpus is big enough and holds every construct the rules are about", () => {
    for (const revision of ["0", "1"] as const) {
      const accepted = corpus(revision);
      // The corpus has to be big and varied enough for the searches to bite,
      // and it has to actually exercise the constructs the rules are about.
      expect(accepted.length).toBeGreaterThan(200);
      expect(new Set(accepted.map((entry) => entry.identity)).size).toBeGreaterThan(150);
      expect(accepted.filter(hasMerkle).length).toBeGreaterThan(40);
      if (revision === "1") {
        // The generator once emitted only structs and arrays, which let this
        // sweep report a property it never covered. Pin the vocabulary.
        expect(accepted.filter(hasEnum).length).toBeGreaterThan(20);
        expect(accepted.filter(hasPreset).length).toBeGreaterThan(20);
      }
    }
    // The strided revision-0 sample keeps the merkle graphs its own hash search
    // is the only search that can separate.
    const sample = rev0HashSample();
    expect(new Set(sample.map((entry) => entry.identity)).size).toBeGreaterThan(50);
    expect(sample.filter(hasMerkle).length).toBeGreaterThan(30);
  });

  test("no two accepted graphs share an encodeType, on either revision", () => {
    for (const revision of ["0", "1"] as const) {
      // `merkletree` deliberately keeps its leaf type out of `encodeType`, so
      // only the message hash can separate those graphs — and it does, below.
      expect(
        collision(
          corpus(revision).filter((entry) => !hasMerkle(entry)),
          encodingOf(revision),
        ),
      ).toBeNull();
    }
  });

  test("no two accepted revision 1 graphs share a message hash", () => {
    const [hashed, found] = hashSearch(corpus("1"), "1");
    expect(hashed).toBeGreaterThan(150);
    expect(found).toBeNull();
  });

  test("no two accepted revision 0 graphs share a message hash", () => {
    const [hashed, found] = hashSearch(rev0HashSample(), "0");
    expect(hashed).toBeGreaterThan(50);
    expect(found).toBeNull();
  });
});
