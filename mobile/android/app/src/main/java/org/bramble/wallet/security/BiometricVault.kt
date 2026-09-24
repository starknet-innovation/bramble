package org.bramble.wallet.security

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Holds the biometric wrap secret W (vault-security.md §2.4). UNCOMPILED: this machine has no
 * Android SDK; written against the generated Kotlin bindings and the platform APIs only.
 *
 * W is 32 bytes from `SecureRandom`, encrypted by an AES-256-GCM Keystore key that needs a strong
 * biometric for every use, prefers StrongBox, and is invalidated by any enrolment change. Only the
 * ciphertext is stored (`noBackupFilesDir/biometric-w.bin`). W is handed to the core as a
 * `ByteArray` and zero-filled by the caller. No `androidx.biometric` dependency is needed.
 */
class BiometricVault(private val context: Context) {
    sealed interface Read {
        class Secret(val bytes: ByteArray) : Read
        /** Non-match, cancel, lockout: offer the passphrase, keep the slot. */
        data object Fallback : Read
        /** `KeyPermanentlyInvalidatedException` or the stored secret is gone: drop the slot. */
        data object Invalidated : Read
    }

    private val file: File get() = File(context.noBackupFilesDir, "biometric-w.bin")
    private val keyStore: KeyStore get() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    /** Whether a strong biometric is enrolled and usable now. */
    val available: Boolean
        get() {
            val manager = context.getSystemService(BiometricManager::class.java) ?: return false
            return if (Build.VERSION.SDK_INT >= 30) {
                manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
            } else {
                @Suppress("DEPRECATION")
                manager.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS
            }
        }

    /** True when the key lives in StrongBox rather than the TEE; shown on the Security screen. */
    var strongBox: Boolean = false
        private set

    private fun generateKey(): SecretKey {
        fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .apply {
                if (Build.VERSION.SDK_INT >= 30) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                if (strongBox) setIsStrongBoxBacked(true)
            }
            .build()
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        return try {
            generator.init(spec(strongBox = true))
            generator.generateKey().also { strongBox = true }
        } catch (_: StrongBoxUnavailableException) {
            generator.init(spec(strongBox = false))
            generator.generateKey().also { strongBox = false }
        }
    }

    private fun key(): SecretKey? = keyStore.getKey(ALIAS, null) as? SecretKey

    /** Checks the key on foreground; a permanently invalidated key means enrolment changed. */
    fun invalidated(): Boolean {
        val key = key() ?: return file.exists()
        return try {
            Cipher.getInstance(TRANSFORMATION).init(Cipher.ENCRYPT_MODE, key)
            false
        } catch (_: KeyPermanentlyInvalidatedException) {
            true
        }
    }

    /** A fresh W. The caller zero-fills it after handing it to the core. */
    fun newWrapSecret(): ByteArray = ByteArray(32).also { SecureRandom().nextBytes(it) }

    /** Encrypts W under a new biometric key after a successful prompt, and stores the ciphertext. */
    suspend fun store(activity: Context, secret: ByteArray, title: String): Boolean {
        delete()
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, generateKey()) }
        val authorised = prompt(activity, title, cipher) ?: return false
        val sealed = authorised.doFinal(secret)
        file.writeBytes(byteArrayOf(authorised.iv.size.toByte()) + authorised.iv + sealed)
        return true
    }

    /** Prompts and decrypts W. */
    suspend fun read(activity: Context, title: String): Read {
        val key = key() ?: return Read.Invalidated
        val bytes = runCatching { file.readBytes() }.getOrNull() ?: return Read.Invalidated
        val ivLength = bytes.firstOrNull()?.toInt() ?: return Read.Invalidated
        if (ivLength <= 0 || bytes.size <= 1 + ivLength) return Read.Invalidated
        val cipher = try {
            Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes, 1, ivLength))
            }
        } catch (_: KeyPermanentlyInvalidatedException) {
            return Read.Invalidated
        }
        val authorised = prompt(activity, title, cipher) ?: return Read.Fallback
        return runCatching { Read.Secret(authorised.doFinal(bytes, 1 + ivLength, bytes.size - 1 - ivLength)) }
            .getOrDefault(Read.Fallback)
    }

    private suspend fun prompt(activity: Context, title: String, cipher: Cipher): Cipher? =
        suspendCancellableCoroutine { continuation ->
            val cancel = CancellationSignal()
            continuation.invokeOnCancellation { cancel.cancel() }
            val builder = BiometricPrompt.Builder(activity).setTitle(title)
            if (Build.VERSION.SDK_INT >= 30) {
                builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            }
            // A negative button is required below API 30 and keeps the passphrase one tap away.
            builder.setNegativeButton("Use passphrase", activity.mainExecutor) { _, _ -> continuation.resume(null) }
            builder.build().authenticate(
                BiometricPrompt.CryptoObject(cipher), cancel, activity.mainExecutor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (continuation.isActive) continuation.resume(result.cryptoObject?.cipher)
                    }

                    // Lockout, cancel and every other error: passphrase fallback, key kept.
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (continuation.isActive) continuation.resume(null)
                    }
                    // A non-match (onAuthenticationFailed) lets the prompt retry; nothing to do.
                },
            )
        }

    fun delete() {
        runCatching { keyStore.deleteEntry(ALIAS) }
        file.delete()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "bramble.biometric.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
