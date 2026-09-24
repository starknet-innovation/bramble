package org.bramble.wallet.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.bramble.core.NetworkId
import org.bramble.core.coreInfo
import org.bramble.core.explorerAccountUrl
import org.bramble.core.formatTokenAmount
import org.bramble.core.isValidRecoveryPhrase
import org.bramble.wallet.R
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.*

/** Route switch; same four routes as the iOS RootView. */
@Composable
fun Root(store: WalletStore) {
    val skin = LocalSkin.current
    Box(Modifier.fillMaxSize().background(skin.bg).systemBarsPadding().imePadding()) {
        when (store.route) {
            WalletStore.Route.WELCOME -> Welcome(store)
            WalletStore.Route.BACKUP -> Backup(store)
            WalletStore.Route.LOCKED -> Unlock(store)
            WalletStore.Route.HOME -> Home(store)
        }
    }
}

@Composable
private fun Screen(title: String, subtitle: String? = null, content: @Composable ColumnScope.() -> Unit) {
    val skin = LocalSkin.current
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.xl),
    ) {
        if (title.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Text(title, color = skin.text, style = textStyle(BrambleTypeScale.headline, BrambleWeight.bold, BrambleTracking.display))
            if (subtitle != null) Text(subtitle, color = skin.muted, style = textStyle(BrambleTypeScale.body))
        }
        content()
    }
}

@Composable
private fun BrandMark() {
    val skin = LocalSkin.current
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Image(painterResource(R.drawable.brand_mark), null, Modifier.size(BrambleSize.brand), colorFilter = ColorFilter.tint(skin.text))
        Text("Bramble", color = skin.text, style = textStyle(BrambleTypeScale.display, BrambleWeight.bold, BrambleTracking.display))
    }
}

@Composable
private fun Welcome(store: WalletStore) {
    var step by remember { mutableStateOf("") }
    when (step) {
        "create" -> CreatePassword(store)
        "import" -> Import(store)
        else -> Column(
            Modifier.fillMaxSize().padding(BrambleSpace.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        ) {
            Spacer(Modifier.weight(1f))
            BrandMark()
            Text("A Starknet wallet whose keys never leave this device.", color = LocalSkin.current.muted, style = textStyle(BrambleTypeScale.body))
            Spacer(Modifier.weight(1f))
            PrimaryButton("Create a new wallet") { step = "create" }
            SecondaryButton("I already have a recovery phrase") { step = "import" }
        }
    }
}

private fun passwordProblem(password: String, confirmation: String): String? = when {
    password.trim().length < 8 -> "Use at least 8 characters."
    password != confirmation -> "Passwords don't match."
    else -> null
}

@Composable
private fun CreatePassword(store: WalletStore) {
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Screen("Set a password", "It encrypts your wallet on this device. Bramble can't recover it for you.") {
        BrambleField("Password", password, { password = it }, secure = true)
        BrambleField("Confirm password", confirmation, { confirmation = it }, secure = true)
        ErrorText(error)
        PrimaryButton("Create wallet", busy = store.busy) {
            error = passwordProblem(password, confirmation) ?: run {
                scope.launch { runCatching { store.create(password) }.onFailure { error = describe(it) } }
                null
            }
        }
    }
}

@Composable
private fun PhraseGrid(words: List<String>) {
    val skin = LocalSkin.current
    LazyVerticalGrid(GridCells.Fixed(2), Modifier.heightIn(max = 480.dp), verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        itemsIndexed(words) { index, word ->
            Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                Text("${index + 1}", color = skin.muted, style = textStyle(BrambleTypeScale.mono, mono = true), modifier = Modifier.width(20.dp))
                Text(word, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.medium, mono = true))
            }
        }
    }
}

@Composable
private fun Backup(store: WalletStore) {
    val scope = rememberCoroutineScope()
    val skin = LocalSkin.current
    var confirmed by remember { mutableStateOf(false) }
    Screen("Write down your recovery phrase", "These 12 words are the only way to restore this wallet. Keep them offline, in order, and never share them.") {
        Card { PhraseGrid(store.pendingBackup) }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { confirmed = !confirmed }) {
            Checkbox(confirmed, { confirmed = it }, colors = CheckboxDefaults.colors(checkedColor = skin.accent))
            Text("I've written it down somewhere safe", color = skin.text, style = textStyle(BrambleTypeScale.body))
        }
        PrimaryButton("Continue", enabled = confirmed) { scope.launch { store.confirmBackup() } }
    }
}

@Composable
private fun Import(store: WalletStore) {
    val scope = rememberCoroutineScope()
    var phrase by remember { mutableStateOf("") }
    var passphrase by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Screen("Import a wallet", "Enter your 12–24 word recovery phrase.") {
        BrambleField("Recovery phrase", phrase, { phrase = it }, minLines = 4)
        BrambleField("BIP-39 passphrase (optional)", passphrase, { passphrase = it }, secure = true)
        BrambleField("Password", password, { password = it }, secure = true)
        BrambleField("Confirm password", confirmation, { confirmation = it }, secure = true)
        ErrorText(error)
        PrimaryButton("Import wallet", busy = store.busy) {
            error = when {
                !isValidRecoveryPhrase(phrase) -> "That isn't a valid recovery phrase."
                else -> passwordProblem(password, confirmation)
            } ?: run {
                scope.launch {
                    runCatching { store.importWallet(phrase, password, passphrase.ifEmpty { null }) }
                        .onSuccess { phrase = "" }
                        .onFailure { error = describe(it) }
                }
                null
            }
        }
    }
}

@Composable
private fun Unlock(store: WalletStore) {
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().padding(BrambleSpace.lg), verticalArrangement = Arrangement.spacedBy(BrambleSpace.xl, Alignment.CenterVertically)) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { BrandMark() }
        BrambleField("Password", password, { password = it }, secure = true)
        ErrorText(error)
        PrimaryButton("Unlock", busy = store.busy) {
            scope.launch {
                runCatching { store.unlock(password) }.onSuccess { password = "" }.onFailure { error = describe(it) }
            }
        }
    }
}

@Composable
private fun Home(store: WalletStore) {
    val skin = LocalSkin.current
    val uri = LocalUriHandler.current
    var sheet by remember { mutableStateOf("") }
    if (sheet == "settings") return Settings(store) { sheet = "" }

    fun amount(symbol: String): String? {
        val raw = store.balances[symbol] ?: return null
        val token = store.networkInfo.tokens.firstOrNull { it.symbol == symbol } ?: return null
        return runCatching { formatTokenAmount(raw, token.decimals, 4u) }.getOrNull()
    }

    Screen(title = "") {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
            AccountAvatar(store.account?.index ?: 0u)
            Column(Modifier.weight(1f)) {
                Text("Account ${(store.account?.index ?: 0u) + 1u}", color = skin.text, style = textStyle(BrambleTypeScale.title, BrambleWeight.semibold))
                Text(shortAddress(store.account?.address ?: ""), color = skin.muted, style = textStyle(BrambleTypeScale.mono, mono = true))
            }
            Text(if (store.network == NetworkId.MAINNET) "Mainnet" else "Sepolia", color = skin.muted,
                style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold),
                modifier = Modifier.background(skin.elevated, RoundedCornerShape(BrambleRadius.full)).padding(horizontal = BrambleSpace.sm, vertical = BrambleSpace.xs))
            Text("⚙", color = skin.text, style = textStyle(BrambleTypeScale.title), modifier = Modifier.clickable { sheet = "settings" }.padding(BrambleSpace.sm))
        }
        Column {
            Text(amount("STRK") ?: "—", color = skin.text, style = textStyle(BrambleTypeScale.portfolio, BrambleWeight.heavy, BrambleTracking.amount))
            Text("STRK", color = skin.muted, style = textStyle(BrambleTypeScale.body, BrambleWeight.medium))
            ErrorText(store.balanceError)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            ActionTile("Send", "↗", enabled = false, modifier = Modifier.weight(1f)) {}
            ActionTile("Receive", "▦", modifier = Modifier.weight(1f)) { sheet = "receive" }
            ActionTile("Explorer", "⧉", modifier = Modifier.weight(1f)) {
                store.account?.let { explorerAccountUrl(store.network, it.address)?.let(uri::openUri) }
            }
        }
        if (sheet == "receive") Card {
            Text("Receive on ${store.networkInfo.name}", color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
            Text(store.account?.address ?: "", color = skin.text, style = textStyle(BrambleTypeScale.mono, mono = true))
        }
        Card {
            Text("Tokens", color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
            store.networkInfo.tokens.forEach { token ->
                Row(Modifier.heightIn(min = BrambleSize.rowCompact), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(token.symbol, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
                        Text(token.name, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
                    }
                    Text(amount(token.symbol) ?: "—", color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
                }
            }
        }
    }
}

@Composable
private fun Settings(store: WalletStore, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    val skin = LocalSkin.current
    var password by remember { mutableStateOf("") }
    var revealed by remember { mutableStateOf(emptyList<String>()) }
    var error by remember { mutableStateOf<String?>(null) }
    Screen("Settings") {
        SecondaryButton("Back to wallet", onClick = close)
        Card {
            Text("Network", color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
            SecondaryButton(if (store.network == NetworkId.SEPOLIA) "Switch to Mainnet" else "Switch to Sepolia") {
                scope.launch { store.switchNetwork(if (store.network == NetworkId.SEPOLIA) NetworkId.MAINNET else NetworkId.SEPOLIA) }
            }
            SecondaryButton("Add account") { scope.launch { runCatching { store.addAccount() }.onFailure { error = describe(it) } } }
        }
        Card {
            Text("Security", color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
            SecondaryButton("Lock now") { store.lock() }
            BrambleField("Password (to reveal or remove)", password, { password = it }, secure = true)
            SecondaryButton("Show recovery phrase") {
                scope.launch { runCatching { store.revealPhrase(password) }.onSuccess { revealed = it; password = "" }.onFailure { error = describe(it) } }
            }
            if (revealed.isNotEmpty()) PhraseGrid(revealed)
            SecondaryButton("Remove wallet from this device", destructive = true) {
                scope.launch { runCatching { store.deleteWallet(password) }.onFailure { error = describe(it) } }
            }
            ErrorText(error)
        }
        val info = coreInfo()
        Text("Bramble core ${info.coreVersion} · Krusty KMS ${info.krustyVersion}", color = skin.muted, style = textStyle(BrambleTypeScale.caption, mono = true))
    }
    DisposableEffect(Unit) { onDispose { revealed = emptyList() } }
}
