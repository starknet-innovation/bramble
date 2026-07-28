/**
 * Self-contained QR encoder for the receive screen: byte mode, error
 * correction level M, versions 1-6, mask pattern 0. No external dependencies
 * so the extension CSP stays locked to packaged code.
 */
import { escapeHtml } from "../shared/html";

type VersionSpec = {
  readonly alignment: readonly number[];
  readonly blocks: readonly number[];
  readonly ecPerBlock: number;
  readonly version: number;
};

const VERSIONS: readonly VersionSpec[] = [
  { alignment: [], blocks: [16], ecPerBlock: 10, version: 1 },
  { alignment: [6, 18], blocks: [28], ecPerBlock: 16, version: 2 },
  { alignment: [6, 22], blocks: [44], ecPerBlock: 26, version: 3 },
  { alignment: [6, 26], blocks: [32, 32], ecPerBlock: 18, version: 4 },
  { alignment: [6, 30], blocks: [43, 43], ecPerBlock: 24, version: 5 },
  { alignment: [6, 34], blocks: [27, 27, 27, 27], ecPerBlock: 16, version: 6 },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if (value >= 256) {
      value ^= 0x11d;
    }
  }
  for (let index = 255; index < 512; index += 1) {
    GF_EXP[index] = GF_EXP[index - 255] ?? 0;
  }
}

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : (GF_EXP[((GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)) % 255] ?? 0);

const generatorPoly = (degree: number): number[] => {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (const [position, coefficient] of poly.entries()) {
      next[position] = (next[position] ?? 0) ^ coefficient;
      next[position + 1] = (next[position + 1] ?? 0) ^ gfMul(coefficient, GF_EXP[index] ?? 0);
    }
    poly = next;
  }
  return poly;
};

const reedSolomon = (data: readonly number[], degree: number): number[] => {
  const generator = generatorPoly(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = (byte ?? 0) ^ (remainder.shift() ?? 0);
    remainder.push(0);
    for (const [index, coefficient] of generator.slice(1).entries()) {
      remainder[index] = (remainder[index] ?? 0) ^ gfMul(coefficient, factor);
    }
  }
  return remainder;
};

const bitStream = (payload: Uint8Array, capacity: number): number[] => {
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let index = length - 1; index >= 0; index -= 1) {
      bits.push((value >> index) & 1);
    }
  };
  push(0b0100, 4);
  push(payload.length, 8);
  for (const byte of payload) {
    push(byte, 8);
  }
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (bits.length < capacity * 8) {
    push(pads[padIndex % 2] ?? 0xec, 8);
    padIndex += 1;
  }
  return bits;
};

const interleave = (spec: VersionSpec, codewords: readonly number[]): number[] => {
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let cursor = 0;
  for (const blockLength of spec.blocks) {
    const block = codewords.slice(cursor, cursor + blockLength);
    cursor += blockLength;
    blocks.push([...block]);
    ecBlocks.push(reedSolomon(block, spec.ecPerBlock));
  }
  const output: number[] = [];
  const maxLength = Math.max(...spec.blocks);
  for (let index = 0; index < maxLength; index += 1) {
    for (const block of blocks) {
      if (index < block.length) {
        output.push(block[index] ?? 0);
      }
    }
  }
  for (let index = 0; index < spec.ecPerBlock; index += 1) {
    for (const block of ecBlocks) {
      output.push(block[index] ?? 0);
    }
  }
  return output;
};

const FORMAT_MASK = 0x5412;

const formatBits = (): number => {
  // EC level M ("00") with mask pattern 0.
  const data = 0b00000;
  let value = data << 10;
  for (let index = 14; index >= 10; index -= 1) {
    if ((value >> index) & 1) {
      value ^= 0x537 << (index - 10);
    }
  }
  return (((data << 10) | value) ^ FORMAT_MASK) & 0x7fff;
};

type Matrix = {
  readonly reserved: boolean[][];
  readonly size: number;
  readonly values: boolean[][];
};

const setModule = (matrix: Matrix, row: number, col: number, value: boolean): void => {
  const valuesRow = matrix.values[row];
  const reservedRow = matrix.reserved[row];
  if (valuesRow && reservedRow) {
    valuesRow[col] = value;
    reservedRow[col] = true;
  }
};

const placeFinder = (matrix: Matrix, row: number, col: number): void => {
  for (let dr = -1; dr <= 7; dr += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= matrix.size || c >= matrix.size) {
        continue;
      }
      const inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark =
        inner &&
        (dr === 0 ||
          dr === 6 ||
          dc === 0 ||
          dc === 6 ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      setModule(matrix, r, c, dark);
    }
  }
};

const placeFixedPatterns = (matrix: Matrix, spec: VersionSpec): void => {
  placeFinder(matrix, 0, 0);
  placeFinder(matrix, 0, matrix.size - 7);
  placeFinder(matrix, matrix.size - 7, 0);
  for (let index = 8; index < matrix.size - 8; index += 1) {
    const dark = index % 2 === 0;
    if (!matrix.reserved[6]?.[index]) {
      setModule(matrix, 6, index, dark);
    }
    if (!matrix.reserved[index]?.[6]) {
      setModule(matrix, index, 6, dark);
    }
  }
  const nearFinder = (row: number, col: number): boolean =>
    (row <= 8 && col <= 8) ||
    (row <= 8 && col >= matrix.size - 9) ||
    (row >= matrix.size - 9 && col <= 8);
  for (const centerRow of spec.alignment) {
    for (const centerCol of spec.alignment) {
      if (nearFinder(centerRow, centerCol)) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(matrix, centerRow + dr, centerCol + dc, dark);
        }
      }
    }
  }
  setModule(matrix, matrix.size - 8, 8, true);
};

const placeFormat = (matrix: Matrix): void => {
  const bits = formatBits();
  const at = (position: number): boolean => ((bits >> (14 - position)) & 1) === 1;
  const copyOne: readonly (readonly [number, number])[] = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  for (const [position, cell] of copyOne.entries()) {
    setModule(matrix, cell[0], cell[1], at(position));
  }
  for (let position = 0; position <= 6; position += 1) {
    setModule(matrix, matrix.size - 1 - position, 8, at(position));
  }
  for (let position = 7; position < 15; position += 1) {
    setModule(matrix, 8, matrix.size - 15 + position, at(position));
  }
};

const placeData = (matrix: Matrix, codewords: readonly number[]): void => {
  const bits: number[] = [];
  for (const byte of codewords) {
    for (let index = 7; index >= 0; index -= 1) {
      bits.push((byte >> index) & 1);
    }
  }
  const writable = matrix.reserved.reduce(
    (sum, rowCells) => sum + rowCells.filter((reserved) => !reserved).length,
    0,
  );
  if (writable < bits.length) {
    throw new Error(`QR layout mismatch: ${writable} cells for ${bits.length} bits`);
  }
  let bitIndex = 0;
  let upward = true;
  for (let right = matrix.size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let step = 0; step < matrix.size; step += 1) {
      const row = upward ? matrix.size - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (matrix.reserved[row]?.[c]) {
          continue;
        }
        const bit = bits[bitIndex] === 1;
        bitIndex += 1;
        const masked = (row + c) % 2 === 0 ? !bit : bit;
        setModule(matrix, row, c, masked);
      }
    }
    upward = !upward;
  }
};

/**
 * Encodes text as a QR matrix of booleans (true = dark module).
 */
export const qrMatrix = (text: string): readonly (readonly boolean[])[] => {
  const payload = new TextEncoder().encode(text);
  const spec = VERSIONS.find((candidate) => {
    const capacity = candidate.blocks.reduce((sum, block) => sum + block, 0);
    return payload.length + 2 <= capacity;
  });
  if (!spec) {
    throw new Error("QR payload too long");
  }
  const capacity = spec.blocks.reduce((sum, block) => sum + block, 0);
  const bits = bitStream(payload, capacity);
  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | (bits[index + offset] ?? 0);
    }
    codewords.push(byte);
  }
  const size = 17 + spec.version * 4;
  const matrix: Matrix = {
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    size,
    values: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
  placeFixedPatterns(matrix, spec);
  placeFormat(matrix);
  placeData(matrix, interleave(spec, codewords));
  return matrix.values;
};

/**
 * Renders text as an inline QR SVG drawn in the current skin color.
 */
export const qrSvg = (text: string, label = "QR code for wallet address"): string => {
  const matrix = qrMatrix(text);
  const size = matrix.length;
  const cells: string[] = [];
  for (const [row, line] of matrix.entries()) {
    for (const [col, dark] of line.entries()) {
      if (dark) {
        cells.push(`<rect x="${col}" y="${row}" width="1" height="1" />`);
      }
    }
  }
  return `<svg class="qr" viewBox="-4 -4 ${size + 8} ${size + 8}" role="img" aria-label="${escapeHtml(label)}" fill="currentColor" shape-rendering="crispEdges">${cells.join("")}</svg>`;
};
