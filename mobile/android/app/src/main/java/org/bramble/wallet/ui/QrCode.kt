package org.bramble.wallet.ui

/**
 * Pure-Kotlin port of the extension's receive-screen encoder
 * (`packages/presentation/wallet-ui/src/sidepanel/shared/qr.ts`): byte mode, error correction
 * level M, versions 1–11, mask pattern 0, no dependency. It is kept step for step with the
 * TypeScript (including its module placement, in [QrMatrix]), so the matrices are identical;
 * `QrCodeTest` checks that against `qr-parity.txt`, which `mobile/android/scripts/qr-fixture.ts`
 * writes by running the extension's encoder. Constant names follow ISO/IEC 18004.
 */
object QrCode {
    private data class Spec(
        val alignment: IntArray,
        val blocks: IntArray,
        val ecPerBlock: Int,
        val version: Int,
    )

    private val VERSIONS =
        listOf(
            Spec(intArrayOf(), intArrayOf(16), 10, 1),
            Spec(intArrayOf(6, 18), intArrayOf(28), 16, 2),
            Spec(intArrayOf(6, 22), intArrayOf(44), 26, 3),
            Spec(intArrayOf(6, 26), intArrayOf(32, 32), 18, 4),
            Spec(intArrayOf(6, 30), intArrayOf(43, 43), 24, 5),
            Spec(intArrayOf(6, 34), intArrayOf(27, 27, 27, 27), 16, 6),
            Spec(intArrayOf(6, 22, 38), intArrayOf(31, 31, 31, 31), 18, 7),
            Spec(intArrayOf(6, 24, 42), intArrayOf(38, 38, 39, 39), 22, 8),
            Spec(intArrayOf(6, 26, 46), intArrayOf(36, 36, 36, 37, 37), 22, 9),
            Spec(intArrayOf(6, 28, 50), intArrayOf(43, 43, 43, 43, 44), 26, 10),
            Spec(intArrayOf(6, 30, 54), intArrayOf(50, 51, 51, 51, 51), 30, 11),
        )

    /** Number of elements of GF(256), the Reed–Solomon codeword field. */
    private const val GF_SIZE = 256

    /** Order of the multiplicative group of GF(256): exponents repeat every 255 steps. */
    private const val GF_ORDER = 255

    /** The exponent table is doubled so a sum of two logarithms indexes it without reduction. */
    private const val GF_EXP_TABLE_SIZE = 512

    /** QR's primitive polynomial x^8 + x^4 + x^3 + x^2 + 1. */
    private const val GF_PRIMITIVE_POLYNOMIAL = 0x11d

    private const val BITS_PER_BYTE = 8
    private const val BYTE_MASK = 0xff

    /** Mode indicator for byte mode, and its width. */
    private const val MODE_BYTE = 0b0100
    private const val MODE_INDICATOR_BITS = 4

    /** Byte-mode character-count width: 8 bits for versions 1–9, 16 from version 10. */
    private const val LONG_COUNT_MIN_VERSION = 10
    private const val SHORT_COUNT_BITS = 8
    private const val LONG_COUNT_BITS = 16

    /** The terminator is up to four zero bits, cut short when capacity runs out. */
    private const val TERMINATOR_MAX_BITS = 4

    /** The alternating pad codewords that fill the remaining data capacity. */
    private val PAD_CODEWORDS = intArrayOf(0xec, 0x11)

    /** A version-V symbol is `17 + 4V` modules wide. */
    private const val SYMBOL_BASE_SIZE = 17
    private const val SYMBOL_SIZE_PER_VERSION = 4

    private val GF_EXP = IntArray(GF_EXP_TABLE_SIZE)
    private val GF_LOG = IntArray(GF_SIZE)

    init {
        var value = 1
        for (index in 0 until GF_ORDER) {
            GF_EXP[index] = value
            GF_LOG[value] = index
            value = value shl 1
            if (value >= GF_SIZE) value = value xor GF_PRIMITIVE_POLYNOMIAL
        }
        for (index in GF_ORDER until GF_EXP_TABLE_SIZE) GF_EXP[index] = GF_EXP[index - GF_ORDER]
    }

    private fun gfMul(
        a: Int,
        b: Int,
    ): Int = if (a == 0 || b == 0) 0 else GF_EXP[(GF_LOG[a] + GF_LOG[b]) % GF_ORDER]

    private fun generatorPoly(degree: Int): IntArray {
        var poly = intArrayOf(1)
        for (index in 0 until degree) {
            val next = IntArray(poly.size + 1)
            for ((position, coefficient) in poly.withIndex()) {
                next[position] = next[position] xor coefficient
                next[position + 1] = next[position + 1] xor gfMul(coefficient, GF_EXP[index])
            }
            poly = next
        }
        return poly
    }

    private fun reedSolomon(
        data: List<Int>,
        degree: Int,
    ): List<Int> {
        val generator = generatorPoly(degree)
        val remainder = ArrayDeque(List(degree) { 0 })
        for (byte in data) {
            val factor = byte xor remainder.removeFirst()
            remainder.addLast(0)
            for (index in 1 until generator.size) {
                remainder[index - 1] = remainder[index - 1] xor gfMul(generator[index], factor)
            }
        }
        return remainder.toList()
    }

    private fun characterCountBits(version: Int): Int =
        if (version <
            LONG_COUNT_MIN_VERSION
        ) {
            SHORT_COUNT_BITS
        } else {
            LONG_COUNT_BITS
        }

    private fun bitStream(
        payload: ByteArray,
        capacity: Int,
        version: Int,
    ): List<Int> {
        val bits = ArrayList<Int>()

        fun push(
            value: Int,
            length: Int,
        ) {
            for (index in length - 1 downTo 0) bits.add((value shr index) and 1)
        }
        push(MODE_BYTE, MODE_INDICATOR_BITS)
        push(payload.size, characterCountBits(version))
        for (byte in payload) push(byte.toInt() and BYTE_MASK, BITS_PER_BYTE)
        push(0, minOf(TERMINATOR_MAX_BITS, capacity * BITS_PER_BYTE - bits.size))
        while (bits.size % BITS_PER_BYTE != 0) bits.add(0)
        var padIndex = 0
        while (bits.size < capacity * BITS_PER_BYTE) {
            push(PAD_CODEWORDS[padIndex % PAD_CODEWORDS.size], BITS_PER_BYTE)
            padIndex += 1
        }
        return bits
    }

    private fun interleave(
        spec: Spec,
        codewords: List<Int>,
    ): List<Int> {
        val blocks = ArrayList<List<Int>>()
        val ecBlocks = ArrayList<List<Int>>()
        var cursor = 0
        for (blockLength in spec.blocks) {
            val block = codewords.subList(cursor, cursor + blockLength).toList()
            cursor += blockLength
            blocks.add(block)
            ecBlocks.add(reedSolomon(block, spec.ecPerBlock))
        }
        val output = ArrayList<Int>()
        for (index in 0 until spec.blocks.max()) {
            for (block in blocks) if (index < block.size) output.add(block[index])
        }
        for (index in 0 until spec.ecPerBlock) {
            for (block in ecBlocks) output.add(block[index])
        }
        return output
    }

    /**
     * Encodes [text] (UTF-8) as a QR matrix, row by row; `true` is a dark module.
     *
     * @throws IllegalArgumentException when the payload does not fit version 11 at level M.
     */
    fun matrix(text: String): List<BooleanArray> {
        val payload = text.encodeToByteArray()
        val spec =
            VERSIONS.firstOrNull { candidate ->
                val capacity = candidate.blocks.sum()
                val countBits = characterCountBits(candidate.version)
                MODE_INDICATOR_BITS + countBits + payload.size * BITS_PER_BYTE <= capacity * BITS_PER_BYTE
            } ?: throw IllegalArgumentException("QR payload too long")
        val capacity = spec.blocks.sum()
        val bits = bitStream(payload, capacity, spec.version)
        val codewords =
            (bits.indices step BITS_PER_BYTE).map { index ->
                (0 until BITS_PER_BYTE).fold(0) { byte, offset -> (byte shl 1) or bits[index + offset] }
            }
        val matrix = QrMatrix(SYMBOL_BASE_SIZE + spec.version * SYMBOL_SIZE_PER_VERSION)
        matrix.placeFixedPatterns(spec.alignment)
        matrix.placeVersion(spec.version)
        matrix.placeFormat()
        matrix.placeData(interleave(spec, codewords))
        return matrix.values.toList()
    }
}
