import type { UserRole } from '@deltaguard/shared';

export type TabName = 'index' | 'shifts' | 'reports' | 'messages' | 'profile';

/**
 * Which tabs each role sees. Admins run scheduling and reporting from the
 * web console, so on the phone they only get Home, Messages and Profile.
 * This only hides buttons: what data each role can read is enforced by RLS.
 */
export const TAB_ACCESS: Record<TabName, readonly UserRole[]> = {
  index: ['officer', 'supervisor', 'admin'],
  shifts: ['officer', 'supervisor'],
  reports: ['officer', 'supervisor'],
  messages: ['officer', 'supervisor', 'admin'],
  profile: ['officer', 'supervisor', 'admin'],
};

export const canSeeTab = (tab: TabName, role: UserRole) => TAB_ACCESS[tab].includes(role);
