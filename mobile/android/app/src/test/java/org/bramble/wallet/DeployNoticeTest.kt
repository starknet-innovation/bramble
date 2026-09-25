package org.bramble.wallet

import org.bramble.core.DeploymentState
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Home's `deployNotice`: only an account the core judged undeployed shows it; a STRK balance
 * read as zero asks for funding first, and an unread balance still offers deployment.
 */
class DeployNoticeTest {
    @Test
    fun onlyUndeployedShowsNotice() {
        for (raw in listOf(null, "0", "5")) {
            assertEquals(DeployNotice.HIDDEN, deployNotice(DeploymentState.DEPLOYED, raw))
            assertEquals(DeployNotice.HIDDEN, deployNotice(DeploymentState.UNKNOWN, raw))
        }
    }

    @Test
    fun zeroStrkAsksForFunding() {
        assertEquals(DeployNotice.FUND, deployNotice(DeploymentState.UNDEPLOYED, "0"))
        assertEquals(DeployNotice.FUND, deployNotice(DeploymentState.UNDEPLOYED, "000"))
    }

    @Test
    fun fundedOrUnreadOffersDeploy() {
        assertEquals(DeployNotice.DEPLOY, deployNotice(DeploymentState.UNDEPLOYED, "1"))
        assertEquals(DeployNotice.DEPLOY, deployNotice(DeploymentState.UNDEPLOYED, "1000000000000000000"))
        assertEquals(DeployNotice.DEPLOY, deployNotice(DeploymentState.UNDEPLOYED, null))
    }
}
