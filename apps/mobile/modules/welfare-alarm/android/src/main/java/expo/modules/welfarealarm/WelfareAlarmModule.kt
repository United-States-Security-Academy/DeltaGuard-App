package expo.modules.welfarealarm

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WelfareAlarmModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun openSettings(action: String) {
    val intent = Intent(action, Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(intent)
    } catch (_: Exception) {
      context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("WelfareAlarm")

    Function("schedule") { id: String, atMs: Double, title: String, body: String ->
      WelfareAlarmScheduler.schedule(context, id, atMs.toLong(), title, body)
    }

    Function("cancel") { id: String ->
      WelfareAlarmScheduler.cancel(context, id)
    }

    Function("canScheduleExactAlarms") {
      WelfareAlarmScheduler.canScheduleExact(context)
    }

    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        openSettings(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
      }
    }

    Function("canUseFullScreenIntent") {
      if (Build.VERSION.SDK_INT >= 34) {
        context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
      } else {
        true
      }
    }

    Function("openFullScreenIntentSettings") {
      if (Build.VERSION.SDK_INT >= 34) {
        openSettings(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
      }
    }

    Function("showOverLockScreen") { on: Boolean ->
      (appContext.currentActivity ?: WelfareAlarmLifecycle.activity)?.let {
        WelfareAlarmScheduler.showOverLockScreen(it, on)
      }
    }

    /** Media volume to maximum for the alarm; returns the previous level to restore. */
    Function("maxMediaVolume") {
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val previous = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
      try {
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0)
      } catch (_: SecurityException) {
        // Do Not Disturb can refuse volume changes.
      }
      previous
    }

    Function("restoreMediaVolume") { level: Int ->
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      try {
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, level, 0)
      } catch (_: SecurityException) {
      }
    }
  }
}
