package org.bramble.wallet

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Source rules the repository's TypeScript gates cannot see in Kotlin (runs from the app module):
 * UI code uses tokens only (colour and size literals live in `design/`), nothing logs, no window
 * opts out of `FLAG_SECURE`, no `Popup` is used, every secret goes through the one `SecretField`,
 * and nothing is kept in saved-instance state.
 */
class SourceHygieneTest {
    private val root = File("src/main/java/org/bramble/wallet")

    private fun sources(): List<File> = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    private fun violations(files: List<File>, pattern: Regex): List<String> = files.flatMap { file ->
        file.readLines().mapIndexedNotNull { index, line ->
            if (pattern.containsMatchIn(line)) "${file.relativeTo(root)}:${index + 1}: ${line.trim()}" else null
        }
    }

    @Test
    fun scansTheAppSources() {
        assertTrue("run from the app module", sources().size > 20)
    }

    @Test
    fun uiUsesTokensOnly() {
        val outsideDesign = sources().filterNot { it.relativeTo(root).path.startsWith("design") }
        val literals = Regex("""Color\(0x|#[0-9a-fA-F]{6}\b|\b\d+(\.\d+)?\.(dp|sp)\b""")
        assertEquals(emptyList<String>(), violations(outsideDesign, literals))
    }

    @Test
    fun nothingLogs() {
        assertEquals(emptyList<String>(), violations(sources(), Regex("""\bLog\.[a-z]+\(|android\.util\.Log\b|\bprintln\(|printStackTrace\(""")))
    }

    @Test
    fun noWindowOptsOutOfFlagSecureOrUsesAPopup() {
        assertEquals(emptyList<String>(), violations(sources(), Regex("""SecureFlagPolicy\.SecureOff|\bPopup\(|clearFlags\(""")))
    }

    @Test
    fun secretsOnlyGoThroughSecretField() {
        // One hardened input (design/SecretField.kt): no Compose text field and no second
        // EditText or IME interceptor anywhere else can take a passphrase or a phrase word.
        val others = sources().filterNot { it.relativeTo(root).invariantSeparatorsPath == "design/SecretField.kt" }
        val inputs = Regex("""\b(Basic|Outlined)?TextField\(|\bEditText\(|InterceptPlatformTextInput""")
        assertEquals(emptyList<String>(), violations(others, inputs))
    }

    @Test
    fun nothingIsKeptInSavedInstanceState() {
        assertEquals(emptyList<String>(), violations(sources(), Regex("""\brememberSaveable\b|onSaveInstanceState\(outState""")))
    }
}
