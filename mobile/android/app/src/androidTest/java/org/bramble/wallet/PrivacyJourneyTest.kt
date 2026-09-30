package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.bramble.core.DeploymentState
import org.bramble.core.NetworkId
import org.bramble.core.PrivacyBlocker
import org.bramble.core.PrivacyReading
import org.bramble.wallet.privacy.PrivacyCopy
import org.bramble.wallet.privacy.PrivacyJourneyBlock
import org.bramble.wallet.privacy.PrivacyJourneyReads
import org.bramble.wallet.privacy.resolvePrivacyJourney
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The privacy journey (`startJourney` / `continueJourney`, iOS `PrivacyJourney.start`) asks the
 * core's `privacyEntry` with the deployment and STRK funding it has, reads the deployment only
 * when the core asks, and stops at the core's blocker with its hint. Runs against the real core,
 * with no wallet and no network.
 */
@RunWith(AndroidJUnit4::class)
class PrivacyJourneyTest {
    private class Reads(
        private val deployment: DeploymentState,
    ) {
        var deploymentChecks = 0
        var privacyReads = 0

        fun run(
            network: NetworkId,
            known: DeploymentState,
            strkFunded: Boolean? = null,
        ): PrivacyJourneyBlock =
            runBlocking {
                resolvePrivacyJourney(
                    network,
                    known,
                    strkFunded,
                    PrivacyJourneyReads(
                        reading = { PrivacyReading.Idle },
                        checkDeployment = {
                            deploymentChecks += 1
                            deployment
                        },
                        read = { privacyReads += 1 },
                    ),
                )
            }
    }

    @Test
    fun unknownIsReadThenDeployFirst() {
        val reads = Reads(DeploymentState.UNDEPLOYED)
        val block = reads.run(NetworkId.MAINNET, DeploymentState.UNKNOWN)
        assertEquals(PrivacyJourneyBlock(PrivacyBlocker.DEPLOY, PrivacyCopy.deployRequired), block)
        assertEquals(1, reads.deploymentChecks)
        assertEquals(1, reads.privacyReads)
    }

    @Test
    fun knownDeploymentIsNotReread() {
        val reads = Reads(DeploymentState.UNKNOWN)
        val block = reads.run(NetworkId.MAINNET, DeploymentState.UNDEPLOYED)
        assertEquals(PrivacyBlocker.DEPLOY, block.blocker)
        assertEquals(0, reads.deploymentChecks)
    }

    @Test
    fun unfundedUndeployedAsksForStrk() {
        val reads = Reads(DeploymentState.UNKNOWN)
        val block = reads.run(NetworkId.MAINNET, DeploymentState.UNDEPLOYED, strkFunded = false)
        assertEquals(PrivacyJourneyBlock(PrivacyBlocker.FUND, PrivacyCopy.fundsRequired), block)
        // A funded or unread balance keeps the deployment path.
        assertEquals(PrivacyBlocker.DEPLOY, reads.run(NetworkId.MAINNET, DeploymentState.UNDEPLOYED, true).blocker)
    }

    @Test
    fun uncheckedDeploymentIsService() {
        val reads = Reads(DeploymentState.UNKNOWN)
        val block = reads.run(NetworkId.MAINNET, DeploymentState.UNKNOWN)
        assertEquals(PrivacyJourneyBlock(PrivacyBlocker.SERVICE, PrivacyCopy.deploymentUnchecked), block)
        assertEquals(0, reads.privacyReads)
    }

    @Test
    fun unsettledReadIsService() {
        val reads = Reads(DeploymentState.DEPLOYED)
        val block = reads.run(NetworkId.MAINNET, DeploymentState.DEPLOYED)
        assertEquals(PrivacyJourneyBlock(PrivacyBlocker.SERVICE, PrivacyCopy.blockedServiceTitle), block)
        assertEquals(1, reads.privacyReads)
    }

    @Test
    fun sepoliaHasNoPool() {
        val reads = Reads(DeploymentState.DEPLOYED)
        assertEquals(PrivacyBlocker.NETWORK, reads.run(NetworkId.SEPOLIA, DeploymentState.UNKNOWN).blocker)
        assertEquals(0, reads.deploymentChecks)
    }
}
