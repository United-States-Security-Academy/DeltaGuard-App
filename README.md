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
