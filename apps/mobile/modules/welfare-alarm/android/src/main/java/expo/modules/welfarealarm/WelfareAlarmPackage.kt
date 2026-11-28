package expo.modules.welfarealarm

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

// Registers WelfareAlarmLifecycle with the app's main activity (found by Expo
// autolinking, which looks for *Package classes).
class WelfareAlarmPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(WelfareAlarmLifecycle, AppSwitcherPrivacy)
}
