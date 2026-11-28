import { Directory, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Notifications from 'expo-notifications';

import { readQueue } from './clock-queue';
import { readAllForms } from './form-store';
import { readAll as readAllIncidents } from './incident-store';
import { queryClient } from './query-client';
import { secureStorage } from './secure-storage';
import { readTraining } from './training-store';
import { destroyVaultKey } from './vault';
import { cancelWelfareAlerts } from './welfare-alerts';
import { readWelfare } from './welfare-store';

// Removing everything the app keeps on the phone for a user: on sign-out, and
// when the server says the account was suspended / terminated or this phone
// was reset (session.tsx). Kept: the device id (it identifies the phone, not
// the user) and the App Attest key (it belongs to the app installation).

/** Folders under Documents holding a user's drafts, queues and cached files. */
const USER_FOLDERS = ['incidents', 'forms', 'training', 'welfare', 'dar'];

/**
 * Things not yet sent to the server: lost if the user signs out now. Shown
 * before a voluntary sign-out so nobody loses a report by accident.
 */
export async function countUnsent(userId: string): Promise<number> {
  const [incidents, forms, clock, training, welfare] = await Promise.all([
    readAllIncidents(userId).catch(() => []),
    readAllForms(userId).catch(() => []),
    readQueue(userId).catch(() => []),
    readTraining(userId).catch(() => null),
    readWelfare(userId).catch(() => null),
  ]);
  return (
    incidents.filter((i) => i.state !== 'draft').length +
    forms.filter((f) => f.state !== 'draft').length +
    clock.length +
    (training?.submissions.length ?? 0) +
    (welfare?.queue.length ?? 0)
  );
}

function deleteDirectory(dir: Directory): void {
  try {
    if (dir.exists) dir.delete();
  } catch {
    // Best effort: the data is unreadable anyway once the vault key is gone.
  }
}

/** Wipes everything this app keeps on the phone for `userId`. Never throws. */
export async function wipeLocalData(userId: string): Promise<void> {
  // 1. Alarms and notifications first (the welfare state says which to cancel).
  try {
    const welfare = await readWelfare(userId);
    await cancelWelfareAlerts(welfare.nativeIds);
  } catch {
    // Nothing scheduled, or already unreadable.
  }
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);

  // 2. The encryption key: every encrypted draft becomes unreadable at once.
  await destroyVaultKey(userId);

  // 3. Files: drafts, photos, signatures, cached forms and lessons, state.
  for (const folder of USER_FOLDERS) deleteDirectory(new Directory(Paths.document, folder, userId));
  // Temporary copies (camera / picker / image manipulator) and image caches.
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      try {
        entry.delete();
      } catch {
        // In use by the OS: skipped.
      }
    }
  } catch {
    // No cache folder.
  }
  await Image.clearDiskCache().catch(() => undefined);
  await Image.clearMemoryCache().catch(() => undefined);

  // 4. Secure store items: queued clock-ins, pending SOS, cached SOS contacts.
  for (const key of [
    `deltaguard.clock_queue.${userId}`,
    `sos.pending.${userId}`,
    `sos.contacts.${userId}`,
  ]) {
    await secureStorage.removeItem(key).catch(() => undefined);
  }

  // 5. Everything fetched from the server and held in memory.
  queryClient.clear();
}
