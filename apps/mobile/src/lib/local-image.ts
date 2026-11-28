import { useEffect, useState } from 'react';

import { imageDataUri } from './vault';

/**
 * A displayable URI for a local photo or signature. Encrypted files (.enc)
 * are decrypted into memory as a data URI, never written to disk in the clear.
 */
export function useLocalImageUri(
  userId: string,
  uri: string | null,
  mime = 'image/jpeg',
): string | null {
  const [shown, setShown] = useState<{ from: string; uri: string } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    imageDataUri(uri, userId, mime).then(
      (result) => !cancelled && setShown({ from: uri, uri: result }),
      () => undefined, // missing or unreadable: show nothing
    );
    return () => {
      cancelled = true;
    };
  }, [uri, userId, mime]);
  return uri && shown?.from === uri ? shown.uri : null;
}
