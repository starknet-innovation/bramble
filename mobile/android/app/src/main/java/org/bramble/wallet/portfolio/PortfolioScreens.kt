package org.bramble.wallet.portfolio

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.bramble.core.ActivityRow
import org.bramble.core.activityEmptyCopy
import org.bramble.core.activityUnavailableNotice
import org.bramble.core.portfolioAmount
import org.bramble.core.tokenRowFiat

/**
 * Compose renderings of the portfolio hero, token list and Activity feed (UNCOMPILED; not yet
 * wired into `ui/Screens.kt`, which the design and accounts workstreams also edit). All text comes
 * from the core; styling follows the generated tokens once wired into the Bramble theme.
 */
@Composable
fun PortfolioHeroSection(store: PortfolioStore) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(store.hero.totalText ?: "—", Modifier.semantics { contentDescription = "Portfolio total" })
        store.hero.delta?.let { Text("${it.amountText} ${it.windowText}") }
    }
}

@Composable
fun PortfolioTokenList(store: PortfolioStore) {
    val prices = store.priceView ?: return
    Column {
        store.balanceError?.let { Text(it) }
        store.home?.visible?.forEach { balance ->
            val fiat = tokenRowFiat(balance, prices)
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(balance.token.symbol)
                    Text(portfolioAmount(balance.formatted))
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(fiat.valueText ?: "—")
                    fiat.change?.let { Text(it.text) }
                }
            }
        }
        store.home?.notShown?.takeIf { it > 0u }?.let { Text("Manage tokens · $it not shown") }
    }
}

@Composable
fun PortfolioActivity(store: PortfolioStore) {
    val unavailable = store.activityView?.historyUnavailable == true
    Column {
        if (unavailable) Text(activityUnavailableNotice())
        if (store.groups.isEmpty()) Text(activityEmptyCopy(unavailable))
        store.groups.forEach { group ->
            Text(group.heading)
            group.rows.forEach { ActivityRowItem(it) }
        }
    }
}

@Composable
private fun ActivityRowItem(row: ActivityRow) {
    val uri = LocalUriHandler.current
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics { contentDescription = row.accessibilityLabel }) {
        Column(Modifier.weight(1f)) {
            // The explorer opens in the system browser (ACTION_VIEW through the URI handler).
            val link = row.explorerUrl
            Text(row.title, if (link != null) Modifier.clickable { uri.openUri(link) } else Modifier)
            row.detail?.let { Text(it) }
            row.statusWord?.let { Text(it) }
        }
        Spacer(Modifier.padding(4.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(row.fiatText ?: "—")
            Text(row.amountText ?: "—")
        }
    }
}
