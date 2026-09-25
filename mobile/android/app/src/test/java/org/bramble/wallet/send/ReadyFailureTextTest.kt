package org.bramble.wallet.send

import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** Ready (Argent) refusals read as the extension's own text, with the class label filled in. */
class ReadyFailureTextTest {
    @Test
    fun namesTheUnsupportedClass() {
        val failure = SendFailure(SendFailureCode.ACCOUNT_CLASS_UNSUPPORTED, null, "argent 0.3.1")
        assertEquals(
            SendCopy.failurePrefix +
                "Deployed Argent account class (argent 0.3.1) " +
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
            )
        for (code in codes) {
            assertNotEquals(code.name, SendCopy.failureDefault, SendFailureText.message(SendFailure(code, null, null)))
        }
    }
}
