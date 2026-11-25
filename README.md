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

### Before the first production release

The production project (`deltacon-prod`) is still empty. Setting it up: link it, `supabase db push`,
deploy `send-notification` and `sos-dispatch`, enable the custom access token hook, set the Vault secret
`deltaguard_functions_url` and the Twilio secrets, the invite email template, TOTP MFA, password rules,
and set `settings.time_zone` to `America/Chicago`. Then relink the CLI to dev.
