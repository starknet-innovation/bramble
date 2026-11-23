package org.bramble.wallet.ui.wallet

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import org.bramble.core.ActivityEntry
import org.bramble.core.activityCsv
import org.bramble.core.activityCsvFileName
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import java.io.File
import java.util.UUID

/** The Activity header's "Export CSV" control, disabled while the feed is empty. */
@Composable
internal fun ExportCsvButton(store: WalletStore) {
    val context = LocalContext.current
    IconButton(
        BrambleIconName.RECEIVE,
        "Export CSV",
        tint = LocalSkin.current.muted,
        enabled = store.portfolio.activityEntries.isNotEmpty(),
    ) { shareActivityCsv(context, store) }
}

/**
 * Exports the scope's whole feed (`activityCsv`, every row the core holds for it, not the filtered
 * view) as `activityCsvFileName()` through the share sheet: the file is written to the cache's
 * `exports/` folder, which only the app's FileProvider serves, with read access granted to the app
 * the person picks. The toast follows `activityExportToast`: a feed whose on-chain history was
 * unavailable is named as this device's records only, in the error tone.
 */
internal fun shareActivityCsv(
    context: Context,
    store: WalletStore,
) {
    val portfolio = store.portfolio
    val entries = portfolio.activityEntries
    if (entries.isEmpty()) return
    val file = writeActivityCsv(context.cacheDir, entries) ?: return store.showToast(EXPORT_FAILED)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}$EXPORT_AUTHORITY", file)
    val send =
        Intent(Intent.ACTION_SEND)
            .setType(CSV_TYPE)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, null))
    if (portfolio.activityView?.historyUnavailable == true) {
        store.showToast(EXPORTED_DEVICE_ONLY)
    } else {
        store.showToast(EXPORTED, positive = true)
    }
}

/**
 * Writes [entries] as the core's CSV (`activityCsv`) as `activityCsvFileName()` in a fresh folder
 * under the cache's `exports/`, first removing every earlier export; null when the file cannot be
 * written. The fresh folder gives each export its own content URI, so an app granted an earlier
 * one cannot read a later export through it.
 */
internal fun writeActivityCsv(
    cacheDir: File,
    entries: List<ActivityEntry>,
): File? =
    runCatching {
        val exports = File(cacheDir, EXPORT_DIRECTORY).apply { deleteRecursively() }
        File(exports, UUID.randomUUID().toString()).apply { mkdirs() }.resolve(activityCsvFileName()).apply {
            writeText(activityCsv(entries))
        }
    }.getOrNull()

/** Removes the export, which holds the account's whole history, with the wallet. */
internal fun deleteActivityExports(context: Context) {
    File(context.cacheDir, EXPORT_DIRECTORY).deleteRecursively()
}

/** The cache folder the export is written to; `res/xml/export_paths.xml` names the same one. */
private const val EXPORT_DIRECTORY = "exports"

/** The FileProvider's authority after the package name, as the manifest declares it. */
private const val EXPORT_AUTHORITY = ".exports"
private const val CSV_TYPE = "text/csv"

/** `activityExportToast`'s two lines, and `activity-ui.ts`'s fallback when the export fails. */
private const val EXPORTED = "Activity exported"
private const val EXPORTED_DEVICE_ONLY = "Exported this device's records only — on-chain history was unavailable."
private const val EXPORT_FAILED = "Export failed"
