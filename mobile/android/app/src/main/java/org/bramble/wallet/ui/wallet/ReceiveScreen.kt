package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import org.bramble.core.AccountRecord
import org.bramble.core.WalletContactCard
import org.bramble.core.accountLabel
import org.bramble.core.walletContactCardEncode
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleShadow
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTracking
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SegmentedControl
import org.bramble.wallet.design.brambleShadow
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.design.weight
import org.bramble.wallet.ui.AddressClipboard
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.QrCode

private const val QUIET_ZONE = 4

/**
 * `receive` from the activity-and-assets journey, port of the iOS `ReceiveView` /
 * `ReceiveAddressView`: QR card, full address, network line, copy, and, once the coordination key
 * is derived, the "Address / Bramble contact card" choice for the QR and "Copy wallet card". The
 * QR card is white in every skin (`.qr-card`) so scanners read it. Preparing or failing to prepare
 * the card never blocks the address.
 */
@Composable
fun ReceiveScreen(store: WalletStore, back: () -> Unit) {
    val skin = LocalSkin.current
    val context = LocalContext.current
    val active = store.activeRecord
    val address = active?.address.orEmpty()
    val networkName = store.networkInfo.name
    var copied by remember { mutableStateOf(false) }
    val coordination = store.coordination
    var showCard by remember { mutableStateOf(false) }
    LaunchedEffect(active?.publicKey) { if (active != null) coordination.loadNostrKey() }
    val card = active?.let { record ->
        coordination.nostrKey?.let { nostr ->
            runCatching { walletContactCardEncode(WalletContactCard(store.network, record.address, record.publicKey, nostr)) }.getOrNull()
        }
    }
    val offersCard = active != null && !coordination.nostrUnavailable
    val qrText = if (showCard && card != null) card else address
    val matrix = remember(qrText) { if (qrText.isEmpty()) null else QrCode.matrix(qrText) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader("Receive", network = store.networkLabel, back = back)
        if (matrix != null) {
            val card = RoundedCornerShape(BrambleRadius.md)
            Box(
                Modifier.padding(vertical = BrambleSpace.sm)
                    .brambleShadow(BrambleShadow.md, card)
                    .background(Color.White, card)
                    .padding(BrambleSpace.md)
                    .semantics {
                        contentDescription = if (showCard && card != null) "QR code for wallet contact card" else "QR code for your Starknet address"
                    },
            ) {
                Canvas(Modifier.size(BrambleLayout.qrSide)) {
                    // The extension's `viewBox="-4 -4 n+8 n+8"`: a four-module quiet zone.
                    val module = size.width / (matrix.size + 2 * QUIET_ZONE)
                    matrix.forEachIndexed { row, line ->
                        line.forEachIndexed { col, dark ->
                            val origin = Offset((col + QUIET_ZONE) * module, (row + QUIET_ZONE) * module)
                            if (dark) drawRect(Color.Black, origin, Size(module, module))
                        }
                    }
                }
            }
        }
        Text("Your Starknet address", color = skin.text, style = textStyle(BrambleTypeScale.display, BrambleWeight.bold, BrambleTracking.display))
        SelectionContainer {
            Text(address, color = skin.text, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.body, mono = true))
        }
        Text(
            buildAnnotatedString {
                append("Network: ")
                withStyle(SpanStyle(fontWeight = weight(BrambleWeight.semibold))) { append(networkName) }
            },
            color = skin.muted,
            style = textStyle(BrambleTypeScale.label),
        )
        Text(
            "Only send $networkName assets to this address.",
            color = skin.muted,
            textAlign = TextAlign.Center,
            style = textStyle(BrambleTypeScale.label),
        )
        PillButton(
            if (copied) "Copied" else "Copy address",
            modifier = Modifier.padding(top = BrambleSpace.sm),
            icon = BrambleIconName.COPY,
            enabled = address.isNotEmpty(),
        ) {
            copied = AddressClipboard.copy(context, address, store.appScope)
            if (!copied) store.showToast("Copy failed")
        }
        if (offersCard) {
            // The card option stays unselectable until the card exists, as `disabled` does.
            SegmentedControl(listOf("Address" to false, "Bramble contact card" to true), selection = showCard && card != null) {
                if (!it || card != null) showCard = it
            }
            Text(
                "The contact card is public: this address, the signer public key, and the coordination public key. It holds nothing secret.",
                color = skin.muted,
                textAlign = TextAlign.Center,
                style = textStyle(BrambleTypeScale.caption),
            )
            PillButton(
                if (card == null) "Preparing card…" else "Copy wallet card",
                kind = PillKind.SECONDARY,
                icon = BrambleIconName.COPY,
                enabled = card != null,
            ) {
                if (card != null && !AddressClipboard.copy(context, card, store.appScope)) store.showToast("Copy failed")
            }
        }
        if (active != null) WalletIdentity(store, active)
    }
}

/**
 * The collapsed "Wallet identity" disclosure (`receive-view.ts`, `docs/accounts.md` §2.5): the
 * signer and coordination public keys, truncated with the core's `accountLabel`, copied in full.
 */
@Composable
private fun WalletIdentity(store: WalletStore, active: AccountRecord) {
    val skin = LocalSkin.current
    var open by remember { mutableStateOf(false) }
    Box(Modifier.padding(top = BrambleSpace.sm)) {
        Disclosure("Wallet identity", open = open, onToggle = { open = !open }, detail = "Signer and coordination keys") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                    Text("Signer public key", color = skin.muted, style = textStyle(BrambleTypeScale.label))
                    Text(accountLabel(active.publicKey), color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold, mono = true))
                }
                CopyButton(store, active.publicKey, "Copy signer public key")
            }
            val coordination = store.coordination
            val nostr = coordination.nostrKey
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                    Text("Coordination public key", color = skin.muted, style = textStyle(BrambleTypeScale.label))
                    when {
                        coordination.nostrUnavailable ->
                            Text("Coordination is unavailable. Share the account address instead.", color = skin.muted, style = textStyle(BrambleTypeScale.caption))
                        nostr == null -> Text("Preparing secure coordination…", color = skin.muted, style = textStyle(BrambleTypeScale.caption))
                        else -> Text(accountLabel(nostr), color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold, mono = true))
                    }
                }
                if (nostr != null) CopyButton(store, nostr, "Copy coordination public key")
            }
        }
    }
}
