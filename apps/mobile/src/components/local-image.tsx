import { Image, type ImageProps } from 'expo-image';

import { useLocalImageUri } from '@/lib/local-image';
import { useSession } from '@/lib/session';

/** An image stored on the phone (encrypted .enc files are decrypted in memory). */
export function LocalImage({ uri, mime, ...props }: Omit<ImageProps, 'source'> & { uri: string; mime?: string }) {
  const { state } = useSession();
  const userId = state.status === 'ready' ? state.profile.id : '';
  const shown = useLocalImageUri(userId, userId ? uri : null, mime);
  return <Image {...props} source={shown ? { uri: shown } : null} />;
}
