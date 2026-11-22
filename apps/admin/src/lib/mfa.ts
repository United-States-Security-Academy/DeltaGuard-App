/**
 * Whether staff must pass TOTP MFA (aal2) to use the console.
 *
 * Always on in production builds (`next build` / `next start`). Only a local
 * `next dev` run can turn it off, with ADMIN_SKIP_MFA=true in .env.local, so a
 * deployed console can never ship without it.
 */
export const MFA_REQUIRED =
  process.env.NODE_ENV === 'production' || process.env.ADMIN_SKIP_MFA !== 'true';
