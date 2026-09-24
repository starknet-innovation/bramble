package org.bramble.wallet.security

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume

/**
 * Holds the biometric wrap secret W (vault-security.md §2.4). UNCOMPILED: this machine has no
 * Android SDK; written against the generated Kotlin bindings and the platform APIs only.
 *
 * W is 32 bytes from `SecureRandom`, encrypted by an AES-256-GCM Keystore key that needs a strong
 * biometric for every use, prefers StrongBox, and is invalidated by any enrolment change. Only the
 * ciphertext is stored (`noBackupFilesDir/biometric-w.bin`). W is handed to the core as a
 * `ByteArray` and zero-filled by the caller. No `androidx.biometric` dependency is needed.
 */
class BiometricVault(
    private val context: Context,
) {
    /** The outcome of [read]: the secret, a passphrase fallback, or a slot to drop. */
    sealed interface Read {
        /**
         * The decrypted wrap secret W; the caller zero-fills it once the core has it.
         *
         * @property bytes W itself (secret material: never logged, persisted or shown).
         */
        class Secret(
            val bytes: ByteArray,
        ) : Read

        /** Non-match, cancel, lockout: offer the passphrase, keep the slot. */
        data object Fallback : Read

        /** `KeyPermanentlyInvalidatedException` or the stored secret is gone: drop the slot. */
        data object Invalidated : Read
    }

    private val file: File get() = File(context.noBackupFilesDir, "biometric-w.bin")
    private val keyStore: KeyStore get() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    /**
     * Whether a strong biometric is enrolled and usable now, so a slot can be added. Needs API 30:
     * below it the framework's only check is deprecated and cannot ask for a strong biometric, so
     * the answer there is false. An existing slot still unlocks through [read] on any API level.
     */
    val available: Boolean
        get() =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
                context
                    .getSystemService(BiometricManager::class.java)
                    ?.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
                BiometricManager.BIOMETRIC_SUCCESS

    /** Set when this process generated the key; the fallback below API 31, where KeyInfo has no level. */
    private var generatedInStrongBox = false

    /**
     * True when the key lives in StrongBox rather than the TEE; shown on the Security screen. Read
     * from the key itself on API 31+, so it stays right after a restart.
     */
    val strongBox: Boolean
        get() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return generatedInStrongBox
            val key = runCatching { key() }.getOrNull() ?: return false
            return runCatching {
                val info =
                    SecretKeyFactory
                        .getInstance(
                            key.algorithm,
                            KEYSTORE,
                        ).getKeySpec(key, KeyInfo::class.java) as KeyInfo
                info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
            }.getOrDefault(false)
        }

    private fun generateKey(): SecretKey {
        fun spec(strongBox: Boolean) =
            KeyGenParameterSpec
                .Builder(
                    ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_SIZE_BITS)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)
                .apply {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                    }
                    if (strongBox) setIsStrongBoxBacked(true)
                }.build()
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        return try {
            generator.init(spec(strongBox = true))
            generator.generateKey().also { generatedInStrongBox = true }
        } catch (ignored: StrongBoxUnavailableException) {
            generator.init(spec(strongBox = false))
            generator.generateKey().also { generatedInStrongBox = false }
        }
    }

    private fun key(): SecretKey? = keyStore.getKey(ALIAS, null) as? SecretKey

    /** Checks the key on foreground; a permanently invalidated key means enrolment changed. */
    fun invalidated(): Boolean {
        val key = key() ?: return file.exists()
        return try {
            Cipher.getInstance(TRANSFORMATION).init(Cipher.ENCRYPT_MODE, key)
            false
        } catch (ignored: KeyPermanentlyInvalidatedException) {
            true
        }
    }

    /** A fresh W. The caller zero-fills it after handing it to the core. */
    fun newWrapSecret(): ByteArray = ByteArray(WRAP_SECRET_BYTES).also { SecureRandom().nextBytes(it) }

    /** Encrypts W under a new biometric key after a successful prompt, and stores the ciphertext. */
    suspend fun store(
        activity: Context,
        secret: ByteArray,
        title: String,
    ): Boolean {
        delete()
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, generateKey()) }
        val authorised = prompt(activity, title, cipher) ?: return false
        val sealed = authorised.doFinal(secret)
        file.writeBytes(byteArrayOf(authorised.iv.size.toByte()) + authorised.iv + sealed)
        return true
    }

    /**
     * Prompts and decrypts W. [Read.Invalidated] when the key or a well-formed ciphertext is gone
     * or the key was invalidated; [Read.Fallback] for a dismissed prompt or a failed decryption.
     */
    suspend fun read(
        activity: Context,
        title: String,
    ): Read {
        val key = key()
        val bytes = key?.let { sealedSecret() }
        val cipher = if (key != null && bytes != null) decryptCipher(key, bytes) else null
        if (bytes == null || cipher == null) return Read.Invalidated
        val ivLength = bytes.first().toInt()
        val authorised = prompt(activity, title, cipher)
        return if (authorised == null) {
            Read.Fallback
        } else {
            runCatching { Read.Secret(authorised.doFinal(bytes, 1 + ivLength, bytes.size - 1 - ivLength)) }
                .getOrDefault(Read.Fallback)
        }
    }

    /** The stored `[iv length][iv][ciphertext]`, or null when it is unreadable or malformed. */
    private fun sealedSecret(): ByteArray? {
        val bytes = runCatching { file.readBytes() }.getOrNull()
        val ivLength = bytes?.firstOrNull()?.toInt() ?: 0
        return bytes?.takeIf { ivLength > 0 && it.size > 1 + ivLength }
    }

    /** A decrypting cipher for [bytes]' IV, or null when the key was permanently invalidated. */
    private fun decryptCipher(
        key: SecretKey,
        bytes: ByteArray,
    ): Cipher? =
        try {
            Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, bytes, 1, bytes.first().toInt()))
            }
        } catch (ignored: KeyPermanentlyInvalidatedException) {
            null
        }

    private suspend fun prompt(
        activity: Context,
        title: String,
        cipher: Cipher,
    ): Cipher? =
        suspendCancellableCoroutine { continuation ->
            val cancel = CancellationSignal()
            continuation.invokeOnCancellation { cancel.cancel() }
            val builder = BiometricPrompt.Builder(activity).setTitle(title)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            }
            // A negative button is required below API 30 and keeps the passphrase one tap away.
            builder.setNegativeButton("Use passphrase", activity.mainExecutor) { _, _ ->
                if (continuation.isActive) continuation.resume(null)
            }
            builder.build().authenticate(
                BiometricPrompt.CryptoObject(cipher),
                cancel,
                activity.mainExecutor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (continuation.isActive) continuation.resume(result.cryptoObject?.cipher)
                    }

                    // Lockout, cancel and every other error: passphrase fallback, key kept.
                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence,
                    ) {
                        if (continuation.isActive) continuation.resume(null)
                    }
                    // A non-match (onAuthenticationFailed) lets the prompt retry; nothing to do.
                },
            )
        }

    /** Drops the Keystore key and the stored ciphertext, best effort (either may already be gone). */
    fun delete() {
        runCatching { keyStore.deleteEntry(ALIAS) }
        file.delete()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "bramble.biometric.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_SIZE_BITS = 256
        const val WRAP_SECRET_BYTES = 32
        const val GCM_TAG_BITS = 128
    }
}
