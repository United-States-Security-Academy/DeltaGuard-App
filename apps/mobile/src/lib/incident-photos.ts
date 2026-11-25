import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { type LocalPhoto, reportDir } from './incident-store';

// Taking or choosing incident photos, and preparing them for upload.
//
// Every photo is decoded and re-encoded as a new JPEG before it is kept:
//   * at most 1600 px on its longest side, quality 0.6: typically 200-500 KB
//     instead of 3-8 MB, so it uploads on a weak mobile connection;
//   * the new file carries no EXIF metadata at all, so the GPS position,
//     phone model and time the camera wrote into the original are gone.
// The original stays where the camera / gallery put it; only the clean copy
// is saved in the app's folder and uploaded.

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.6;

export type PickResult =
  { kind: 'picked'; uris: string[] } | { kind: 'cancelled' } | { kind: 'denied'; message: string };

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  // Full quality in, compressed once by the manipulator below.
  quality: 1,
  exif: false,
};

export async function takePhoto(): Promise<PickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return {
      kind: 'denied',
      message: 'Camera access is off for Deltacon Guard. Allow it in Settings to take photos.',
    };
  }
  const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
  return result.canceled
    ? { kind: 'cancelled' }
    : { kind: 'picked', uris: result.assets.map((a) => a.uri) };
}

export async function choosePhotos(limit: number): Promise<PickResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    ...PICKER_OPTIONS,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
  });
  return result.canceled
    ? { kind: 'cancelled' }
    : { kind: 'picked', uris: result.assets.map((a) => a.uri) };
}

/** Compresses one photo, strips its metadata and saves it with the report. */
export async function preparePhoto(
  userId: string,
  incidentId: string,
  sourceUri: string,
): Promise<LocalPhoto> {
  const context = ImageManipulator.manipulate(sourceUri, {
    // Downsampled while decoding: a 48 MP photo never sits in memory full size.
    maxWidth: MAX_EDGE_PX,
    maxHeight: MAX_EDGE_PX,
  });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });

  const id = Crypto.randomUUID();
  const dir = reportDir(userId, incidentId);
  dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, `${id}.jpg`);
  // saveAsync writes to the cache folder, which the OS may clear: move it.
  await new File(saved.uri).move(target);
  return { id, localUri: target.uri, uploaded: false };
}

/** Removes a photo the officer took out of a draft. */
export function deleteLocalPhoto(photo: LocalPhoto): void {
  try {
    const file = new File(photo.localUri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}
