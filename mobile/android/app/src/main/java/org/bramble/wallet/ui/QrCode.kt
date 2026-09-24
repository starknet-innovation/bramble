package org.bramble.wallet.ui

/**
 * Pure-Kotlin port of the extension's receive-screen encoder
 * (`packages/presentation/wallet-ui/src/sidepanel/shared/qr.ts`): byte mode, error correction
 * level M, versions 1–11, mask pattern 0, no dependency. It is kept step for step with the
 * TypeScript (including its module placement), so the matrices are identical; `QrCodeTest`
 * checks that against `qr-parity.txt`, which `mobile/android/scripts/qr-fixture.ts` writes by
 * running the extension's encoder.
 */
object QrCode {
    private class Spec(val alignment: IntArray, val blocks: IntArray, val ecPerBlock: Int, val version: Int)

    private val VERSIONS = listOf(
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

    private val GF_EXP = IntArray(512)
    private val GF_LOG = IntArray(256)

    init {
        var value = 1
        for (index in 0 until 255) {
            GF_EXP[index] = value
            GF_LOG[value] = index
            value = value shl 1
            if (value >= 256) value = value xor 0x11d
        }
        for (index in 255 until 512) GF_EXP[index] = GF_EXP[index - 255]
    }

    private fun gfMul(a: Int, b: Int): Int = if (a == 0 || b == 0) 0 else GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255]

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

    private fun reedSolomon(data: List<Int>, degree: Int): List<Int> {
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

    private fun bitStream(payload: ByteArray, capacity: Int, version: Int): List<Int> {
        val bits = ArrayList<Int>()
        fun push(value: Int, length: Int) {
            for (index in length - 1 downTo 0) bits.add((value shr index) and 1)
        }
        push(0b0100, 4)
        push(payload.size, if (version < 10) 8 else 16)
        for (byte in payload) push(byte.toInt() and 0xff, 8)
        push(0, minOf(4, capacity * 8 - bits.size))
        while (bits.size % 8 != 0) bits.add(0)
        val pads = intArrayOf(0xec, 0x11)
        var padIndex = 0
        while (bits.size < capacity * 8) {
            push(pads[padIndex % 2], 8)
            padIndex += 1
        }
        return bits
    }

    private fun interleave(spec: Spec, codewords: List<Int>): List<Int> {
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

    private const val FORMAT_MASK = 0x5412

    private fun formatBits(): Int {
        // EC level M ("00") with mask pattern 0.
        val data = 0b00000
        var value = data shl 10
        for (index in 14 downTo 10) {
            if ((value shr index) and 1 == 1) value = value xor (0x537 shl (index - 10))
        }
        return (((data shl 10) or value) xor FORMAT_MASK) and 0x7fff
    }

    private class Matrix(val size: Int) {
        val reserved = Array(size) { BooleanArray(size) }
        val values = Array(size) { BooleanArray(size) }

        fun set(row: Int, col: Int, value: Boolean) {
            if (row in 0 until size && col in 0 until size) {
                values[row][col] = value
                reserved[row][col] = true
            }
        }
    }

    private fun placeFinder(matrix: Matrix, row: Int, col: Int) {
        for (dr in -1..7) {
            for (dc in -1..7) {
                val r = row + dr
                val c = col + dc
                if (r < 0 || c < 0 || r >= matrix.size || c >= matrix.size) continue
                val inner = dr in 0..6 && dc in 0..6
                val dark = inner && (dr == 0 || dr == 6 || dc == 0 || dc == 6 || (dr in 2..4 && dc in 2..4))
                matrix.set(r, c, dark)
            }
        }
    }

    private fun placeFixedPatterns(matrix: Matrix, spec: Spec) {
        placeFinder(matrix, 0, 0)
        placeFinder(matrix, 0, matrix.size - 7)
        placeFinder(matrix, matrix.size - 7, 0)
        for (index in 8 until matrix.size - 8) {
            val dark = index % 2 == 0
            if (!matrix.reserved[6][index]) matrix.set(6, index, dark)
            if (!matrix.reserved[index][6]) matrix.set(index, 6, dark)
        }
        fun nearFinder(row: Int, col: Int): Boolean =
            (row <= 8 && col <= 8) || (row <= 8 && col >= matrix.size - 9) || (row >= matrix.size - 9 && col <= 8)
        for (centerRow in spec.alignment) {
            for (centerCol in spec.alignment) {
                if (nearFinder(centerRow, centerCol)) continue
                for (dr in -2..2) {
                    for (dc in -2..2) {
                        val dark = maxOf(kotlin.math.abs(dr), kotlin.math.abs(dc)) != 1
                        matrix.set(centerRow + dr, centerCol + dc, dark)
                    }
                }
            }
        }
        matrix.set(matrix.size - 8, 8, true)
    }

    private val FORMAT_COPY_ONE = listOf(
        8 to 0, 8 to 1, 8 to 2, 8 to 3, 8 to 4, 8 to 5, 8 to 7, 8 to 8,
        7 to 8, 5 to 8, 4 to 8, 3 to 8, 2 to 8, 1 to 8, 0 to 8,
    )

    private fun placeFormat(matrix: Matrix) {
        val bits = formatBits()
        fun at(position: Int): Boolean = (bits shr (14 - position)) and 1 == 1
        for ((position, cell) in FORMAT_COPY_ONE.withIndex()) matrix.set(cell.first, cell.second, at(position))
        for (position in 0..6) matrix.set(matrix.size - 1 - position, 8, at(position))
        for (position in 7 until 15) matrix.set(8, matrix.size - 15 + position, at(position))
    }

    private fun placeVersion(matrix: Matrix, version: Int) {
        if (version < 7) return
        var remainder = version shl 12
        for (index in 17 downTo 12) {
            if ((remainder shr index) and 1 == 1) remainder = remainder xor (0x1f25 shl (index - 12))
        }
        val bits = (version shl 12) or remainder
        for (index in 0 until 18) {
            val dark = (bits shr index) and 1 == 1
            matrix.set(index / 3, (index % 3) + matrix.size - 11, dark)
            matrix.set((index % 3) + matrix.size - 11, index / 3, dark)
        }
    }

    private fun placeData(matrix: Matrix, codewords: List<Int>) {
        val bits = ArrayList<Int>(codewords.size * 8)
        for (byte in codewords) for (index in 7 downTo 0) bits.add((byte shr index) and 1)
        val writable = matrix.reserved.sumOf { row -> row.count { !it } }
        check(writable >= bits.size) { "QR layout mismatch: $writable cells for ${bits.size} bits" }
        var bitIndex = 0
        var upward = true
        var right = matrix.size - 1
        while (right >= 1) {
            if (right == 6) right = 5
            for (step in 0 until matrix.size) {
                val row = if (upward) matrix.size - 1 - step else step
                for (c in intArrayOf(right, right - 1)) {
                    if (matrix.reserved[row][c]) continue
                    val bit = bits.getOrNull(bitIndex) == 1
                    bitIndex += 1
                    val masked = if ((row + c) % 2 == 0) !bit else bit
                    matrix.set(row, c, masked)
                }
            }
            upward = !upward
            right -= 2
        }
    }

    /** Encodes [text] (UTF-8) as a QR matrix, row by row; `true` is a dark module. */
    fun matrix(text: String): List<BooleanArray> {
        val payload = text.encodeToByteArray()
        val spec = VERSIONS.firstOrNull { candidate ->
            val capacity = candidate.blocks.sum()
            val countBits = if (candidate.version < 10) 8 else 16
            4 + countBits + payload.size * 8 <= capacity * 8
        } ?: throw IllegalArgumentException("QR payload too long")
        val capacity = spec.blocks.sum()
        val bits = bitStream(payload, capacity, spec.version)
        val codewords = (bits.indices step 8).map { index ->
            (0 until 8).fold(0) { byte, offset -> (byte shl 1) or bits[index + offset] }
        }
        val matrix = Matrix(17 + spec.version * 4)
        placeFixedPatterns(matrix, spec)
        placeVersion(matrix, spec.version)
        placeFormat(matrix)
        placeData(matrix, interleave(spec, codewords))
        return matrix.values.toList()
    }
}
