package org.bramble.wallet.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import org.bramble.wallet.design.*

// Compose counterparts of the ui-kit components; twins of the iOS Components.swift.

@Composable
fun PrimaryButton(title: String, enabled: Boolean = true, busy: Boolean = false, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Box(
        Modifier.fillMaxWidth().heightIn(min = BrambleSize.control).alpha(if (enabled) 1f else 0.4f)
            .background(skin.accent, RoundedCornerShape(BrambleRadius.md))
            .clickable(enabled = enabled && !busy, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) CircularProgressIndicator(color = skin.accentText, modifier = Modifier.size(BrambleControl.icon))
        else Text(title, color = skin.accentText, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
    }
}

@Composable
fun SecondaryButton(title: String, destructive: Boolean = false, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Box(
        Modifier.fillMaxWidth().heightIn(min = BrambleSize.control)
            .background(skin.panel, RoundedCornerShape(BrambleRadius.md))
            .border(BorderStroke(1.dp, skin.hairline), RoundedCornerShape(BrambleRadius.md))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(title, color = if (destructive) skin.danger else skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
    }
}

@Composable
fun ActionTile(title: String, glyph: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Column(
        modifier.heightIn(min = BrambleSize.actionTile).alpha(if (enabled) 1f else 0.4f)
            .background(skin.accentSoft, RoundedCornerShape(BrambleRadius.lg))
            .clickable(enabled = enabled, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs, Alignment.CenterVertically),
    ) {
        Text(glyph, color = skin.accent, style = textStyle(BrambleTypeScale.title, BrambleWeight.bold))
        Text(title, color = skin.accent, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
    }
}

@Composable
fun Card(content: @Composable ColumnScope.() -> Unit) {
    val skin = LocalSkin.current
    Column(
        Modifier.fillMaxWidth()
            .background(skin.panel, RoundedCornerShape(BrambleRadius.lg))
            .border(BorderStroke(1.dp, skin.hairline), RoundedCornerShape(BrambleRadius.lg))
            .padding(BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        content = content,
    )
}

@Composable
fun BrambleField(label: String, value: String, onValueChange: (String) -> Unit, secure: Boolean = false, minLines: Int = 1) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.medium))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            minLines = minLines,
            textStyle = textStyle(BrambleTypeScale.row, mono = minLines > 1).copy(color = skin.text),
            cursorBrush = SolidColor(skin.accent),
            visualTransformation = if (secure) PasswordVisualTransformation() else VisualTransformation.None,
            // No suggestions or learning: the keyboard must never remember a phrase or password.
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = if (secure) KeyboardType.Password else KeyboardType.Ascii,
            ),
            modifier = Modifier.fillMaxWidth()
                .background(skin.sunken, RoundedCornerShape(BrambleRadius.sm))
                .border(BorderStroke(1.dp, skin.border), RoundedCornerShape(BrambleRadius.sm))
                .padding(BrambleSpace.md),
        )
    }
}

@Composable
fun ErrorText(message: String?) {
    if (message != null) Text(message, color = LocalSkin.current.danger, style = textStyle(BrambleTypeScale.label))
}

@Composable
fun AccountAvatar(index: UInt) {
    val skin = LocalSkin.current
    Box(
        Modifier.size(BrambleSize.avatar).background(skin.avatars[(index % 4u).toInt()], CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text("${index + 1u}", color = skin.accountAvatarPaper, style = textStyle(BrambleTypeScale.label, BrambleWeight.bold))
    }
}

/** `accountLabel` (6…4), computed by the core so every platform truncates identically. */
fun shortAddress(address: String): String = org.bramble.core.accountLabel(address)
