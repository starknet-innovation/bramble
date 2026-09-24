package org.bramble.wallet.ui.onboarding

/**
 * The weak-passphrase acknowledgement, as the extension's `weak-passphrase-ack.ts`: the row shows
 * only while the core says the value `needs_acknowledgement`; a tick is dropped as soon as the
 * acknowledgement stops applying (so a tick made for one weak value never carries over to a later
 * weak value), and is kept while it still applies.
 */
object WeakAck {
    /** The tick after the value changed to one whose acknowledgement need is [needs]. */
    fun sync(
        needs: Boolean,
        ticked: Boolean,
    ): Boolean = needs && ticked

    /** Gate: nothing weak is accepted silently, nothing acceptable is blocked. */
    fun accepts(
        needs: Boolean,
        ticked: Boolean,
    ): Boolean = !needs || ticked
}
