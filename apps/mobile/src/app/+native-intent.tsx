import { safeAppPath } from '@/lib/deep-links';

// Every link that opens the app is checked here before Expo Router sees it
// (src/lib/deep-links.ts): only our own links, with valid parameters.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return safeAppPath(path, __DEV__);
  } catch {
    return '/';
  }
}
