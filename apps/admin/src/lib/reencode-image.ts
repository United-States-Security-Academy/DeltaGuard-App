// Browser only. Redraws a picked image on a canvas and saves it as a new
// JPEG: only real pixels are uploaded (no metadata, nothing appended or hidden
// in the file), and a file that isn't really an image fails here. The server
// checks every upload again (verify-upload Edge Function).

export class UnreadableImageError extends Error {
  constructor() {
    super('This image could not be read. Choose a JPEG or PNG photo or scan.');
  }
}

export async function reencodeImage(
  file: Blob,
  { maxEdge = 2400, quality = 0.85 }: { maxEdge?: number; quality?: number } = {},
): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UnreadableImageError();
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UnreadableImageError();
  // White behind transparent PNGs (JPEG has no transparency).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) throw new UnreadableImageError();
  return blob;
}
