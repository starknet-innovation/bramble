package org.bramble.wallet

import android.view.View
import android.view.WindowManager
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Window and storage protections (threats T1, T2, T5, T6). */
@RunWith(AndroidJUnit4::class)
class SecurityTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @Test
    fun flagSecureIsSet() {
        val flags = rule.activity.window.attributes.flags
        assertTrue(flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
    }

    @Test
    fun vaultLivesInNoBackupFilesDir() {
        val vault = File(rule.activity.noBackupFilesDir, "vault")
        assertTrue("the core creates its directory at start", vault.isDirectory)
        assertFalse(vault.absolutePath.startsWith(rule.activity.filesDir.absolutePath + File.separator))
    }

    @Test
    fun autofillIsExcludedAndObscuredTouchesAreDropped() {
        val decor = rule.activity.window.decorView
        assertEquals(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, decor.importantForAutofill)
        assertTrue(decor.filterTouchesWhenObscured)
    }

    @Test
    fun backupIsOff() {
        val info = rule.activity.applicationInfo
        assertEquals(0, info.flags and android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP)
    }
}
