package expo.modules.welfarealarm

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

// Welfare check alarm for Android: at the check's time, post a high-priority
// notification with a FULL-SCREEN INTENT, so DeltaGuard opens over the lock
// screen (or as a heads-up banner if the phone is in use / the user hasn't
// allowed full-screen alerts). expo-notifications can't attach a full-screen
// intent, hence this small module. The sound comes from the notification
// channel (created by the app with expo-notifications).

object WelfareAlarmScheduler {
  const val CHANNEL_ID = "welfare_prompt"
  const val EXTRA_FROM_ALARM = "deltaguard.welfare.fromAlarm"
  private const val ACTION = "deltaguard.welfare.ALARM"
  private const val NOTIFICATION_ID = 7301

  private fun broadcast(context: Context, id: String, title: String, body: String): PendingIntent {
    val intent = Intent(context, WelfareAlarmReceiver::class.java)
      .setAction(ACTION)
      // The data URI makes each check's alarm a distinct PendingIntent (so it can be cancelled).
      .setData(Uri.parse("deltaguard-welfare://alarm/$id"))
      .putExtra("id", id)
      .putExtra("title", title)
      .putExtra("body", body)
    return PendingIntent.getBroadcast(
      context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /** Opens the app (its launcher activity), marked as coming from the alarm. */
  fun openApp(context: Context, id: String): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.putExtra(EXTRA_FROM_ALARM, true)
    return PendingIntent.getActivity(
      context, id.hashCode(), launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
  }

  /** Returns true when scheduled exactly, false when only approximately (no exact-alarm permission). */
  fun schedule(context: Context, id: String, atMs: Long, title: String, body: String): Boolean {
    val alarms = context.getSystemService(AlarmManager::class.java)
    val fire = broadcast(context, id, title, body)
    val show = openApp(context, id)
    return if (canScheduleExact(context) && show != null) {
      // Alarm-clock alarms are delivered on time even in Doze.
      alarms.setAlarmClock(AlarmManager.AlarmClockInfo(atMs, show), fire)
      true
    } else {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, fire)
      false
    }
  }

  fun cancel(context: Context, id: String) {
    context.getSystemService(AlarmManager::class.java).cancel(broadcast(context, id, "", ""))
    NotificationManagerCompat.from(context).cancel(id, NOTIFICATION_ID)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    // Fallback only: the app creates this channel (with its sound) at startup.
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Welfare checks", NotificationManager.IMPORTANCE_HIGH)
    )
  }

  @SuppressLint("MissingPermission")
  fun post(context: Context, id: String, title: String, body: String) {
    ensureChannel(context)
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    val open = openApp(context, id) ?: return
    val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 } ?: context.applicationInfo.icon
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      .setAutoCancel(true)
      .build()
    try {
      manager.notify(id, NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // Notification permission withdrawn: nothing to show.
    }
  }

  /** Show the activity over the lock screen and turn the screen on (or stop doing so). */
  fun showOverLockScreen(activity: Activity, on: Boolean) {
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(on)
        activity.setTurnScreenOn(on)
      } else {
        @Suppress("DEPRECATION")
        val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        if (on) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
      }
    }
  }
}

class WelfareAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: return
    WelfareAlarmScheduler.post(
      context,
      id,
      intent.getStringExtra("title") ?: "Welfare check",
      intent.getStringExtra("body") ?: "Open DeltaGuard and confirm you are alert."
    )
  }
}

/**
 * When the alarm's full-screen intent opens the app, show it over the lock
 * screen straight away (before JavaScript runs). The app turns this off again
 * once the officer has answered (WelfareAlarmModule.showOverLockScreen(false)).
 */
object WelfareAlarmLifecycle : ReactActivityLifecycleListener {
  private var current: WeakReference<Activity>? = null

  val activity: Activity? get() = current?.get()

  private fun apply(activity: Activity, intent: Intent?) {
    if (intent?.getBooleanExtra(WelfareAlarmScheduler.EXTRA_FROM_ALARM, false) == true) {
      WelfareAlarmScheduler.showOverLockScreen(activity, true)
    }
  }

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    current = WeakReference(activity)
    apply(activity, activity.intent)
  }

  override fun onResume(activity: Activity) {
    current = WeakReference(activity)
  }

  override fun onNewIntent(intent: Intent): Boolean {
    activity?.let { apply(it, intent) }
    return false
  }
}
