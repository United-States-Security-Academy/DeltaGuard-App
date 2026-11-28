import { base } from '@deltaguard/eslint-config/base';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...base,
  {
    // Security (XSS): nothing is ever rendered as raw HTML. The one exception
    // (the static theme script in app/layout.tsx) carries a disable comment.
    rules: {
      'react/no-danger': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Never write HTML strings into the DOM.' },
        { property: 'outerHTML', message: 'Never write HTML strings into the DOM.' },
        { property: 'insertAdjacentHTML', message: 'Never write HTML strings into the DOM.' },
      ],
      // Service-role and other secrets stay in server code (see lib/supabase/admin.ts).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/SERVICE_ROLE|SECRET|TOKEN|PRIVATE|PASSWORD/]",
          message: 'Secrets are read only in src/lib/supabase/admin.ts (server-only).',
        },
      ],
    },
  },
  {
    files: ['src/lib/supabase/admin.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
