package org.bramble.wallet.ui

/** Finder patterns are 7×7 modules, with a one-module light separator around them. */
private const val FINDER_SIZE = 7

/** Last row/column offset inside a finder pattern (its dark outer ring). */
private const val FINDER_EDGE = FINDER_SIZE - 1

/** The finder's 3×3 dark core spans offsets 2 to 4. */
private const val FINDER_CORE_FIRST = 2
private const val FINDER_CORE_LAST = 4

/** Row and column that carry the alternating timing patterns. */
private const val TIMING_LINE = 6

/** Row and column beside the finders that carry the format information (and the dark module). */
private const val FORMAT_LINE = 8

/** Alignment patterns are 5×5: two modules either side of their center. */
private const val ALIGNMENT_RADIUS = 2

/** Format information: 15 bits, of which the low 10 are the BCH(15,5) error-correction bits. */
private const val FORMAT_BIT_COUNT = 15
private const val FORMAT_ECC_BITS = 10

/** BCH(15,5) generator polynomial for format information. */
private const val FORMAT_GENERATOR = 0x537

/** XOR mask applied to the format information. */
private const val FORMAT_MASK = 0x5412

/** Keeps the 15 format-information bits. */
private const val FORMAT_BITS_MASK = 0x7fff

/** The second format copy runs 7 modules up the left column, then 8 along the top row. */
private const val FORMAT_VERTICAL_BITS = 7

/** Version information is carried from version 7: 18 bits, the low 12 of which are BCH(18,6). */
private const val VERSION_INFO_MIN_VERSION = 7
private const val VERSION_INFO_BITS = 18
private const val VERSION_ECC_BITS = 12

/** BCH(18,6) generator polynomial for version information. */
private const val VERSION_GENERATOR = 0x1f25

/** Each version-information block is 3 modules deep, starting 11 modules from the far edge. */
private const val VERSION_BLOCK_DEPTH = 3
private const val VERSION_BLOCK_OFFSET = 11

private const val BITS_PER_BYTE = 8

/** Positions of the first format-information copy, around the top-left finder, bit 0 first. */
private val FORMAT_COPY_ONE =
    listOf(
        8 to 0,
        8 to 1,
        8 to 2,
        8 to 3,
        8 to 4,
        8 to 5,
        8 to 7,
        8 to 8,
        7 to 8,
        5 to 8,
        4 to 8,
        3 to 8,
        2 to 8,
        1 to 8,
        0 to 8,
    )

private fun formatBits(): Int {
    // EC level M ("00") with mask pattern 0.
    val data = 0b00000
    var value = data shl FORMAT_ECC_BITS
    for (index in FORMAT_BIT_COUNT - 1 downTo FORMAT_ECC_BITS) {
        val shift = index - FORMAT_ECC_BITS
        if ((value shr index) and 1 == 1) value = value xor (FORMAT_GENERATOR shl shift)
    }
    return (((data shl FORMAT_ECC_BITS) or value) xor FORMAT_MASK) and FORMAT_BITS_MASK
}

private fun isFinderModuleDark(
    dr: Int,
    dc: Int,
): Boolean {
    val inner = dr in 0..FINDER_EDGE && dc in 0..FINDER_EDGE
    val ring = dr == 0 || dr == FINDER_EDGE || dc == 0 || dc == FINDER_EDGE
    val core = dr in FINDER_CORE_FIRST..FINDER_CORE_LAST && dc in FINDER_CORE_FIRST..FINDER_CORE_LAST
    return inner && (ring || core)
}

/**
 * The module grid [QrCode] draws into, with the function-pattern, format, version, and data
 * placement steps of the extension's `shared/qr.ts`, in the same order. Writes outside the grid
 * are ignored, as they are in the TypeScript.
 *
 * @property size Width and height in modules.
 */
internal class QrMatrix(
    val size: Int,
) {
    /** Modules already claimed by a function pattern or by data. */
    val reserved = Array(size) { BooleanArray(size) }

    /** Module colours; `true` is dark. */
    val values = Array(size) { BooleanArray(size) }

    /** Sets and reserves the module at [row], [col]; does nothing outside the grid. */
    fun set(
        row: Int,
        col: Int,
        value: Boolean,
    ) {
        if (row in 0 until size && col in 0 until size) {
            values[row][col] = value
            reserved[row][col] = true
        }
    }

    private fun placeFinder(
        row: Int,
        col: Int,
    ) {
        for (dr in -1..FINDER_SIZE) {
            for (dc in -1..FINDER_SIZE) {
                val r = row + dr
                val c = col + dc
                if (r !in 0 until size || c !in 0 until size) continue
                set(r, c, isFinderModuleDark(dr, dc))
            }
        }
    }

    private fun placeTimingPatterns() {
        for (index in FORMAT_LINE until size - FORMAT_LINE) {
            val dark = index % 2 == 0
            if (!reserved[TIMING_LINE][index]) set(TIMING_LINE, index, dark)
            if (!reserved[index][TIMING_LINE]) set(index, TIMING_LINE, dark)
        }
    }

    private fun placeAlignment(
        centerRow: Int,
        centerCol: Int,
    ) {
        for (dr in -ALIGNMENT_RADIUS..ALIGNMENT_RADIUS) {
            for (dc in -ALIGNMENT_RADIUS..ALIGNMENT_RADIUS) {
                val dark = maxOf(kotlin.math.abs(dr), kotlin.math.abs(dc)) != 1
                set(centerRow + dr, centerCol + dc, dark)
            }
        }
    }

    /** Places the finder, timing, and alignment patterns and the dark module. */
    fun placeFixedPatterns(alignment: IntArray) {
        placeFinder(0, 0)
        placeFinder(0, size - FINDER_SIZE)
        placeFinder(size - FINDER_SIZE, 0)
        placeTimingPatterns()

        fun nearFinder(
            row: Int,
            col: Int,
        ): Boolean {
            val farEdge = size - 1 - FORMAT_LINE
            return (row <= FORMAT_LINE && col <= FORMAT_LINE) ||
                (row <= FORMAT_LINE && col >= farEdge) ||
                (row >= farEdge && col <= FORMAT_LINE)
        }
        for (centerRow in alignment) {
            for (centerCol in alignment) {
                if (nearFinder(centerRow, centerCol)) continue
                placeAlignment(centerRow, centerCol)
            }
        }
        set(size - FORMAT_LINE, FORMAT_LINE, true)
    }

    /** Places both copies of the format information (level M, mask 0). */
    fun placeFormat() {
        val bits = formatBits()

        fun at(position: Int): Boolean {
            val shift = FORMAT_BIT_COUNT - 1 - position
            return (bits shr shift) and 1 == 1
        }
        for ((position, cell) in FORMAT_COPY_ONE.withIndex()) set(cell.first, cell.second, at(position))
        for (position in 0 until FORMAT_VERTICAL_BITS) set(size - 1 - position, FORMAT_LINE, at(position))
        for (position in FORMAT_VERTICAL_BITS until FORMAT_BIT_COUNT) {
            set(FORMAT_LINE, size - FORMAT_BIT_COUNT + position, at(position))
        }
    }

    /** Places both version-information blocks; versions below 7 carry none. */
    fun placeVersion(version: Int) {
        if (version < VERSION_INFO_MIN_VERSION) return
        var remainder = version shl VERSION_ECC_BITS
        for (index in VERSION_INFO_BITS - 1 downTo VERSION_ECC_BITS) {
            val shift = index - VERSION_ECC_BITS
            if ((remainder shr index) and 1 == 1) remainder = remainder xor (VERSION_GENERATOR shl shift)
        }
        val bits = (version shl VERSION_ECC_BITS) or remainder
        for (index in 0 until VERSION_INFO_BITS) {
            val dark = (bits shr index) and 1 == 1
            val along = index / VERSION_BLOCK_DEPTH
            val across = (index % VERSION_BLOCK_DEPTH) + size - VERSION_BLOCK_OFFSET
            set(along, across, dark)
            set(across, along, dark)
        }
    }

    /**
     * Places [codewords] in the zig-zag column-pair order with mask pattern 0.
     *
     * @throws IllegalStateException when the free modules cannot hold every bit.
     */
    fun placeData(codewords: List<Int>) {
        val bits = ArrayList<Int>(codewords.size * BITS_PER_BYTE)
        for (byte in codewords) for (index in BITS_PER_BYTE - 1 downTo 0) bits.add((byte shr index) and 1)
        val writable = reserved.sumOf { row -> row.count { !it } }
        check(writable >= bits.size) { "QR layout mismatch: $writable cells for ${bits.size} bits" }
        var bitIndex = 0
        var upward = true
        var right = size - 1
        while (right >= 1) {
            if (right == TIMING_LINE) right = TIMING_LINE - 1
            bitIndex = placeColumnPair(right, upward, bits, bitIndex)
            upward = !upward
            right -= 2
        }
    }

    /** Fills the free modules of columns [right] and `right - 1`; returns the next bit index. */
    private fun placeColumnPair(
        right: Int,
        upward: Boolean,
        bits: List<Int>,
        firstBit: Int,
    ): Int {
        var bitIndex = firstBit
        for (step in 0 until size) {
            val row = if (upward) size - 1 - step else step
            for (c in intArrayOf(right, right - 1)) {
                if (reserved[row][c]) continue
                val bit = bits.getOrNull(bitIndex) == 1
                bitIndex += 1
                val masked = if ((row + c) % 2 == 0) !bit else bit
                set(row, c, masked)
            }
        }
        return bitIndex
    }
}
