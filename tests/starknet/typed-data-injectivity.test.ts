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
 * A sweep is only worth its runtime if it can fail, so three things guard it.
 * The corpus is asserted to actually contain enum, preset and merkle graphs — an
 * earlier version of this generator emitted only structs and arrays and so
 * reported a property it never covered. Both known collision pairs are replayed
 * through the same search to show it flags them. And every generated enum graph
 * is offered twice, once with the enum field rewritten as a plain reference to
 * its `contains` type: those two spellings share one `encodeType`, so a
 * validator that admits both fails the sweep rather than narrowing it. Reverting
 * either container rule makes both tests in this file fail.
 */
import { describe, expect, test } from "bun:test";
import { typedData as snip12 } from "starknet";
import { isTypedDataShape, typedDataHash } from "../../src/starknet/typed-data";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const REV1_DOMAIN_TYPE = [{ name: "name", type: "shortstring" }];
const REV0_DOMAIN_TYPE = [{ name: "name", type: "felt" }];

type Revision = "0" | "1";
type Field = { name: string; type: string; contains?: string };
type Graph = { readonly primaryType: string; readonly types: Record<string, Field[]> };

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
  // Deterministic xorshift32: the corpus must be identical on every run.
  let state = 2463534242;
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

  const holds = (entry: Graph, matches: (field: Field) => boolean): boolean =>
    Object.values(entry.types).some((fields) => fields.some(matches));
  const hasMerkle = (entry: Graph): boolean => holds(entry, (field) => field.type === "merkletree");
  const hasEnum = (entry: Graph): boolean => holds(entry, (field) => field.type === "enum");
  const hasPreset = (entry: Graph): boolean =>
    holds(entry, (field) =>
      PRESETS.includes(field.type.replace(/\*$/, "") as (typeof PRESETS)[number]),
    );

  // Returns the first pair of structurally different graphs sharing a key.
  const collision = (
    corpus: readonly Graph[],
    keyOf: (entry: Graph) => string | null,
  ): string | null => {
    const seen = new Map<string, string>();
    for (const entry of corpus) {
      const key = keyOf(entry);
      if (key === null) {
        continue;
      }
      const identity = canonical(entry);
      const prior = seen.get(key);
      if (prior === undefined) {
        seen.set(key, identity);
      } else if (prior !== identity) {
        return `${key}\n  ${prior}\n  ${identity}`;
      }
    }
    return null;
  };

  const encodingOf =
    (revision: Revision) =>
    (entry: Graph): string =>
      snip12.encodeType(entry.types as never, entry.primaryType, revision as never);

  const messageHashOf =
    (revision: Revision) =>
    (entry: Graph): string | null => {
      try {
        return typedDataHash(
          envelope(entry, sampleValue(entry.primaryType, entry.types, "m", 0), revision),
          ACCOUNT,
        );
      } catch {
        return null;
      }
    };

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
    expect(collision(separator, encodingOf("0"))).not.toBeNull();
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
    const leafHash = (index: number): string =>
      snip12.getStructHash(
        merkle[0]?.types as never,
        "Policy",
        sampleValue(
          "Policy",
          merkle[0]?.types as Record<string, Field[]>,
          `m.root[${index}]`,
          1,
        ) as never,
        "0" as never,
      );
    // The forged half's leaf values are the honest half's leaf hashes, which is
    // exactly what the path-derived value generator cannot produce on its own —
    // so the sweep needs this pair handed to it, and it flags it.
    const forged = envelope(merkle[1] as Graph, { root: [leafHash(0), leafHash(1)] }, "0");
    expect(messageHashOf("0")(merkle[0] as Graph)).toBe(rawHash(forged));
    expect(isTypedDataShape(forged)).toBe(false);
  });

  test("no two accepted graphs share an encodeType or a message hash", () => {
    for (const revision of ["0", "1"] as const) {
      const accepted: Graph[] = [];
      state = 2463534242;
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const candidate = graph(revision);
        // Every enum graph is offered twice: once as declared, and once with the
        // enum field rewritten as a plain reference to the same type. The two
        // spell one `encodeType`, so if the validator ever admits both again the
        // sweep below fails instead of quietly reporting a narrower property.
        const twin = plainReferenceTwin(candidate);
        const corpus = canonical(twin) === canonical(candidate) ? [candidate] : [candidate, twin];
        for (const entry of corpus) {
          // The envelope carries the same path-derived values the hash sweep
          // below uses: acceptance now covers values as well as declarations, so
          // an empty message would report every graph refused.
          const message = sampleValue(entry.primaryType, entry.types, "m", 0);
          if (isTypedDataShape(envelope(entry, message, revision))) {
            accepted.push(entry);
          }
        }
      }
      // The corpus has to be big and varied enough for the assertion to bite,
      // and it has to actually exercise the constructs the rules are about.
      expect(accepted.length).toBeGreaterThan(200);
      expect(new Set(accepted.map(canonical)).size).toBeGreaterThan(150);
      expect(accepted.filter(hasMerkle).length).toBeGreaterThan(40);
      if (revision === "1") {
        // The generator once emitted only structs and arrays, which let this
        // sweep report a property it never covered. Pin the vocabulary.
        expect(accepted.filter(hasEnum).length).toBeGreaterThan(20);
        expect(accepted.filter(hasPreset).length).toBeGreaterThan(20);
      }
      // `merkletree` deliberately keeps its leaf type out of `encodeType`, so
      // only the message hash can separate those graphs — and it does.
      expect(
        collision(
          accepted.filter((entry) => !hasMerkle(entry)),
          encodingOf(revision),
        ),
      ).toBeNull();
      const hashes = new Map<Graph, string>();
      for (const entry of accepted) {
        const hash = messageHashOf(revision)(entry);
        if (hash !== null) {
          hashes.set(entry, hash);
        }
      }
      expect(hashes.size).toBeGreaterThan(150);
      expect(collision([...hashes.keys()], (entry) => hashes.get(entry) ?? null)).toBeNull();
    }
  }, 30000);
});
