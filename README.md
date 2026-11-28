# DeltaGuard

Internal app for Deltacon Security.

| Path                     | What                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `apps/mobile`            | Officer & supervisor app: Expo SDK 58, Expo Router, NativeWind v4       |
| `apps/admin`             | Web admin for admins & supervisors: Next.js 16 (App Router), Tailwind 4 |
| `packages/shared`        | Shared TypeScript types, Zod schemas, constants (`@deltaguard/shared`)  |
| `packages/eslint-config` | Shared ESLint rules (`@deltaguard/eslint-config`)                       |
| `supabase`               | Supabase CLI project: `migrations/`, `functions/`, `config.toml`        |

## Setup

Requires Node 22+ and pnpm (`npm i -g pnpm`).

```sh
pnpm install
cp apps/mobile/.env.example apps/mobile/.env
cp apps/admin/.env.example apps/admin/.env.local
```

Fill in the Supabase URL and anon key from the Supabase dashboard (Project Settings → API).

## Scripts

```sh
pnpm dev:mobile   # Expo dev server (scan the QR code with Expo Go)
pnpm dev:admin    # Next.js on http://localhost:3000
pnpm typecheck    # tsc across all workspaces (via Turborepo)
pnpm lint         # ESLint across all workspaces (via Turborepo)
pnpm format       # Prettier
pnpm supabase <command>   # Supabase CLI, e.g. `pnpm supabase migration new <name>`
```

## Mobile notes

- Expo Go runs only the SDK it was built for. Install the current Expo Go from the App Store / Play Store (SDK 58).
- Your phone and PC must be on the same Wi-Fi. If the QR code won't connect (guest Wi-Fi, firewall), use `pnpm dev:mobile --tunnel`.
- After changing `.env`, fully reload the app (press `r` in the terminal). Changing `babel.config.js`, `metro.config.js` or `tailwind.config.js` needs a restart with a cleared cache: `pnpm dev:mobile --clear`.
- Expo Go only includes Expo's built-in native modules. Adding a library with custom native code will require a development build (`eas build --profile development`).

## Release

### Mobile builds (EAS)

| Profile | Database (EAS environment) | Output | Update channel |
| --- | --- | --- | --- |
| `development` | dev | dev client APK / iOS internal | `development` |
| `preview` | dev | installable APK / iOS ad hoc, for testing | `preview` |
| `production` | prod (`deltacon-prod`) | Play Store AAB / App Store build | `production` |

The Supabase URL and anon key come from EAS environment variables (`eas env:list --environment <name>`),
not from `.env`. Run from `apps/mobile`:

- `pnpm build:preview:android` / `pnpm build:preview:ios`: test builds. iOS needs an Apple Developer
  account and each tester's iPhone registered first (`eas device:create`).
- `pnpm build:production`: store builds. Only once the production database is set up (below).

### Over-the-air fixes (EAS Update)

JavaScript-only fixes ship without a new build: `pnpm update:preview` or `pnpm update:production`
(add `--message "what changed"`). The runtime version uses the `fingerprint` policy: an update only
reaches builds with the same native code. After adding a native package or changing `app.json`
plugins, make a new build instead; the update would not apply to older builds.

### Admin console (Vercel)

Import the repo in Vercel with **Root Directory** `apps/admin` (framework: Next.js; Vercel detects the
pnpm workspace). Environment variables, per Vercel environment:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Sensitive; server only)
- `MOBILE_APP_LINK_BASE=deltaguard://`
- `ENABLE_EXPERIMENTAL_COREPACK=1` (uses the pnpm version pinned in `package.json`)

Never set `ADMIN_SKIP_MFA` on Vercel (production builds ignore it anyway). In Supabase, set
Authentication > URL Configuration > Site URL to the Vercel URL, and add it to Redirect URLs.

### Email (Resend)

Supabase Auth sends no email itself: the **Send Email hook** calls the `send-email` Edge Function,
which sends through Resend with the Deltacon templates (`supabase/functions/send-email/`, shared
sender in `supabase/functions/_shared/`). Per Supabase project:

1. Resend: verify a sending domain (e.g. `mail.deltaconsecurity.com`, DNS records from Resend) and
   create an API key. Until the domain is verified, Resend only delivers to the Resend account owner.
2. Deploy: `pnpm supabase functions deploy send-email --use-api --no-verify-jwt`.
3. Dashboard > Authentication > Hooks > **Send Email** > HTTPS, URL
   `https://<project-ref>.supabase.co/functions/v1/send-email`; generate the secret.
4. Secrets: `pnpm supabase secrets set RESEND_API_KEY=... EMAIL_FROM="DeltaGuard <no-reply@your-domain>"
   SEND_EMAIL_HOOK_SECRET="v1,whsec_..." ADMIN_CONSOLE_URL=https://<admin-url>`.
5. Authentication > Rate Limits: raise "emails sent per hour" (the default 2 applies to the hook too).

Invite links go to `ADMIN_CONSOLE_URL/auth/accept`, so the Dashboard email templates are no longer used.

### SMS and voice calls (Twilio)

`sos-dispatch` (SOS texts) and `welfare-escalation` (welfare check calls and texts) send through
Twilio. Per Supabase project: `pnpm supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=...`
plus `TWILIO_MESSAGING_SERVICE_SID=...` (SMS) and/or `TWILIO_FROM_NUMBER=+1...`. Voice calls need a
voice-capable Twilio number: `TWILIO_FROM_NUMBER`, or `TWILIO_VOICE_FROM_NUMBER` if SMS uses a
Messaging Service. Without these, calls and SMS are logged as skipped (push still works).

Phones need a build that includes the welfare check alarm (a local Android module in
`apps/mobile/modules/welfare-alarm`, expo-audio, expo-battery, expo-brightness, expo-keep-awake). iOS
Critical Alerts (alarm sounds on silent and in Focus): once Apple grants the entitlement, add
`"IOS_CRITICAL_ALERTS": "1"` to the build profile's `env` in `eas.json` and make a new build. Without
it, iOS alarms are time-sensitive notifications.

Welfare checks start only once an admin picks a policy: `settings.welfare_policy_id` (company
default) or `sites.welfare_policy_id`. A "Standard" policy is seeded but not selected.

### Phone app security (phase 20)

- **App integrity** (Edge Function `device-integrity`, deploy with `--use-api --no-verify-jwt`). Secrets:
  `APPLE_TEAM_ID` (iOS App Attest; App ID = TeamID.com.deltaconsecurity.deltaguard),
  `GOOGLE_SERVICE_ACCOUNT_JSON` (Android: a Google Cloud service account linked to the app in Play Console →
  App integrity), optional `ANDROID_CERT_SHA256` (base64 SHA-256 of the app signing certificate),
  `APP_ATTEST_ALLOW_DEVELOPMENT=1` only on dev. The phone needs `EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER`
  (EAS env var; not a secret). Until these are set, checks are recorded as "unavailable": flagged, never
  blocked. Admins choose Flag or Block in Settings → Phone security.
- **Signed updates.** `apps/mobile/certs/certificate.pem` (public, committed) is built into the app; every
  `eas update` must be signed with `apps/mobile/keys/private-key.pem` (`pnpm update:preview|production` pass
  `--private-key-path`). The private key is NOT in git: keep it in a password manager / CI secret. Losing it
  means no more updates to installed builds until a new store build ships with a new certificate.
- **Bundle check:** `npx expo export --platform android --platform ios --output-dir dist` (from `C:\...`), then
  `pnpm --filter @deltaguard/mobile check:bundle`: fails if anything but the public Supabase URL / anon key is
  in the JS bundles.
- These need a new native build: `@expo/app-integrity`, `expo-screen-capture`, `expo-build-properties`
  (no cleartext HTTP), the App Attest entitlement, `allowBackup: false`, and the Android app-switcher privacy
  listener in `modules/welfare-alarm`.

### Before the first production release

The production project (`deltacon-prod`) is still empty. Setting it up: link it, `supabase db push`,
deploy `send-notification`, `sos-dispatch`, `send-email`, `generate-filled-pdf`, `welfare-escalation` and `verify-upload` (deploy `verify-upload` before pushing migrations, so uploads are checked from the start) (all `--use-api --no-verify-jwt`), enable the custom access token hook and the Send Email hook (see Email above), set the Vault secret
`deltaguard_functions_url`, the Twilio and Resend secrets, TOTP MFA, password rules,
and set `settings.time_zone` to `America/Chicago`. Then relink the CLI to dev.

Security settings (phase 18; the functions refuse database calls until both secrets match):

- Shared secret for database → Edge Function calls: generate one random value (48+ characters) and
  store it twice: `supabase secrets set CRON_SECRET=...` and, in SQL,
  `select vault.create_secret('...', 'deltaguard_cron_secret');`.
- Auth settings in the dashboard (config.toml is not pushed): minimum password length 10, password
  requirement "letters and digits", sign-in rate limit 20 per 5 minutes per IP. Consider CAPTCHA
  (Turnstile) on the console sign-in.
- The audit log (`public.audit_log`) is append-only by design; plan retention before it grows.
