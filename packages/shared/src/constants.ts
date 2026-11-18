export const APP_NAME = 'DeltaGuard';
export const COMPANY_NAME = 'Deltacon Security';

// Keep in sync with the Postgres enums in supabase/migrations.
export const USER_ROLES = ['officer', 'supervisor', 'admin'] as const;
export const EMPLOYMENT_STATUSES = ['active', 'suspended', 'terminated'] as const;
export const DEVICE_PLATFORMS = ['ios', 'android'] as const;

// Private storage bucket for license scans. Object path: <user_id>/<file>.
export const LICENSES_BUCKET = 'licenses';
export const LICENSE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const LICENSE_FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
] as const;

export const DEFAULT_CLOCK_IN_RADIUS_M = 150;
