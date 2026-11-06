package org.bramble.wallet.send

import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** Ready (Argent) refusals read as the extension's own text, which no longer names the class. */
class ReadyFailureTextTest {
    @Test
    fun matchesExtensionClassCopy() {
        val failure = SendFailure(SendFailureCode.ACCOUNT_CLASS_UNSUPPORTED, null, "argent 0.3.1")
        assertEquals(
            SendCopy.failurePrefix +
                "Deployed Argent account class " +
                "expects an authorization format this wallet does not produce",
            SendFailureText.message(failure),
        )
    }

    @Test
    fun everyRefusalHasCopy() {
        val codes =
            listOf(
                SendFailureCode.ACCOUNT_CLASS_UNRECOGNISED,
                SendFailureCode.ACCOUNT_NOT_DEPLOYABLE,
                SendFailureCode.ACCOUNT_OWNER_MISMATCH,
                SendFailureCode.ACCOUNT_OWNER_TYPE_UNSUPPORTED,
                SendFailureCode.ACCOUNT_GUARDIAN_UNSUPPORTED,
                SendFailureCode.BRAAVOS_DEPLOY_FIRST,
                SendFailureCode.BRAAVOS_NOT_DEPLOYABLE,
                SendFailureCode.BRAAVOS_CLASS_UNRECOGNISED,
                SendFailureCode.BRAAVOS_OWNER_MISMATCH,
                SendFailureCode.BRAAVOS_SIGNER_LIST_MALFORMED,
                SendFailureCode.BRAAVOS_STRONG_SIGNER,
            )
        for (code in codes) {
            assertNotEquals(code.name, SendCopy.failureDefault, SendFailureText.message(SendFailure(code, null, null)))
        }
    }
}
