package expo.modules.welfarealarm

import android.app.Activity
import android.os.Build
import android.os.Bundle
import expo.modules.core.interfaces.ReactActivityLifecycleListener

// Hides DeltaGuard's screen in Android's recent-apps switcher (a blank card
// instead of a snapshot of reports or personal data), without blocking
// screenshots app-wide. Android 13+ (API 33). Sensitive screens additionally
// block screenshots and recording with expo-screen-capture (FLAG_SECURE),
// which also blanks the switcher card on older Android versions.
object AppSwitcherPrivacy : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      activity.setRecentsScreenshotEnabled(false)
    }
  }
}
