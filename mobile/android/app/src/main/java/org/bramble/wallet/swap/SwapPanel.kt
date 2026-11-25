package org.bramble.wallet.swap

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import org.bramble.core.TokenConfig
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.SecretField
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.send.panelShape

/** `.swap-panel`: the side's label, its amount (typed, or quoted) and token, and the token list. */
@Composable
internal fun Panel(
    model: SwapFlowModel,
    side: SwapFlowModel.Side,
) {
    val skin = LocalSkin.current
    val selling = side == SwapFlowModel.Side.SELL
    val token = if (selling) model.sell else model.buy
    var picking by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().background(skin.panel, panelShape).padding(BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Text(
            if (selling) SwapCopy.sell else SwapCopy.buy,
            color = skin.muted,
            style = textStyle(BrambleTypeScale.caption),
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        ) {
            Box(Modifier.weight(1f)) { Amount(model, selling) }
            TokenPill(
                token?.let { it.address to it.symbol },
                if (selling) SwapCopy.chooseSellToken else SwapCopy.chooseBuyToken,
                enabled = model.stage == SwapFlowModel.Stage.EDIT,
            ) { picking = !picking }
        }
        if (selling) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                val max = model.maxAmount
                val editing = model.stage == SwapFlowModel.Stage.EDIT
                IconlessShortcut(SwapCopy.max, enabled = max != null && editing) { max?.let { model.amount = it } }
            }
        }
        if (picking) {
            TokenList(model.tokens, token?.id) { option ->
                picking = false
                model.choose(option, side)
            }
        }
    }
}

/** The tracked tokens as a menu, the [selected] one marked. */
@Composable
private fun TokenList(
    tokens: List<TokenConfig>,
    selected: String?,
    choose: (TokenConfig) -> Unit,
) {
    MenuGroup {
        tokens.forEachIndexed { index, option ->
            if (index > 0) MenuDivider()
            MenuRow(null, option.symbol, selected = option.id == selected, chevron = false) { choose(option) }
        }
    }
}

/** The sell side's amount field, or the buy side's quoted amount. */
@Composable
private fun Amount(
    model: SwapFlowModel,
    selling: Boolean,
) {
    val skin = LocalSkin.current
    if (selling) {
        SecretField(
            value = model.amount,
            onValueChange = { model.amount = it },
            accessibilityLabel = SwapCopy.amountToSell,
            kind = SecretKind.AMOUNT,
            placeholder = "0",
            textColor = if (model.insufficient) skin.danger else skin.text,
            style = BrambleTypeScale.amount,
        )
    } else {
        Text(
            model.quote?.buyAmount ?: "0",
            color = if (model.quote == null) skin.muted else skin.text,
            maxLines = 1,
            style = textStyle(BrambleTypeScale.amount, BrambleWeight.bold).copy(fontFeatureSettings = "tnum"),
        )
    }
}

/** The side's token (address and symbol, or "Select") as a capsule that opens the token list. */
@Composable
private fun TokenPill(
    token: Pair<String, String>?,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .semantics(mergeDescendants = true) { contentDescription = label }
            .fillPress(skin.elevated, skin.softPress, CircleShape, enabled = enabled, onClick = onClick)
            .heightIn(min = BrambleControl.hitSmall)
            .padding(horizontal = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        token?.let { (address, symbol) -> TokenMark(address, symbol) }
        Text(
            token?.second ?: SwapCopy.select,
            color = skin.text,
            style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
        )
        BrambleIcon(BrambleIconName.CHEVRON_DOWN, skin.muted, BrambleSpace.lg)
    }
}

/** `.swap-amount-shortcuts button`: Max as a small transparent pill. */
@Composable
private fun IconlessShortcut(
    title: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Box(
        Modifier
            .fillPress(Color.Transparent, skin.softPress, CircleShape, enabled = enabled, onClick = onClick)
            .heightIn(min = BrambleControl.hitSmall)
            .padding(horizontal = BrambleSpace.sm),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            color = if (enabled) skin.text else skin.muted,
            style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold),
        )
    }
}
