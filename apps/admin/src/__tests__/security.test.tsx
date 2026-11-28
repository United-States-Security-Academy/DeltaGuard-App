// Security behaviour that isn't per-action: headers, cookies, redirects,
// error text, exports, and rendering of user content.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown } from '@/components/markdown';
import { csvCell, neutralizeFormula, toCsv } from '@/lib/csv';
import { safeNext } from '@/lib/safe-next';
import { contentSecurityPolicy, staticSecurityHeaders } from '@/lib/security-headers';
import { caughtMessage, LoadError, publicMessage } from '@/lib/server-errors';
import { hardenCookieOptions, SESSION_COOKIE_MAX_AGE } from '@/lib/supabase/cookies';

const prodEnv = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
} as unknown as NodeJS.ProcessEnv;

describe('Content-Security-Policy', () => {
  const csp = contentSecurityPolicy('NONCE123', prodEnv);
  const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('allows scripts only with the nonce: no unsafe-inline or unsafe-eval', () => {
    const scripts = directive('script-src');
    expect(scripts).toContain("'nonce-NONCE123'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/default-src[^;]*\*/);
  });

  it('allows only our Supabase project, map tiles and the geocoder over the network', () => {
    expect(directive('connect-src').split(' ').slice(1).sort()).toEqual(
      [
        "'self'",
        'https://abc.supabase.co',
        'https://nominatim.openstreetmap.org',
        'wss://abc.supabase.co',
      ].sort(),
    );
    expect(directive('img-src')).toContain('https://tile.openstreetmap.org');
    expect(directive('img-src')).toContain('https://abc.supabase.co');
    expect(csp).not.toContain('http://');
  });

  it('adds Sentry only when a DSN is configured', () => {
    expect(csp).not.toContain('sentry');
    const withSentry = contentSecurityPolicy('n', {
      ...prodEnv,
      NEXT_PUBLIC_SENTRY_DSN: 'https://key@o1.ingest.us.sentry.io/2',
    } as unknown as NodeJS.ProcessEnv);
    expect(withSentry).toContain('https://o1.ingest.us.sentry.io');
  });

  it('blocks framing, plugins and foreign forms', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('form-action')).toBe("form-action 'self'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
});

describe('other security headers', () => {
  const headers = Object.fromEntries(staticSecurityHeaders(prodEnv));
  it('sets HSTS, no framing, no sniffing, a referrer policy and no camera/microphone/location', () => {
    expect(headers['Strict-Transport-Security']).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
      expect(headers['Permissions-Policy']).toContain(feature);
    }
  });
});

describe('session cookies', () => {
  it('are httpOnly, Secure in production, SameSite=Lax and short-lived', () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      const o = hardenCookieOptions({ maxAge: 400 * 24 * 3600, httpOnly: false, sameSite: 'none' });
      expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
      expect(o.maxAge).toBe(SESSION_COOKIE_MAX_AGE);
      expect(SESSION_COOKIE_MAX_AGE).toBeLessThanOrEqual(12 * 3600);
      expect(hardenCookieOptions({ maxAge: 0 }).maxAge).toBe(0); // sign-out still clears
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? 'test';
    }
  });
});

describe('redirect targets after re-authentication', () => {
  it.each([
    ['/users', '/users'],
    ['/timesheets/1/export?format=csv', '/timesheets/1/export?format=csv'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    [null, '/'],
  ])('%s -> %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});

describe('error text shown to people', () => {
  it('never contains SQL, table or constraint names', () => {
    const sql = {
      code: '42P01',
      message: 'relation "public.profiles" does not exist',
      details: 'Key (email)=(jo@example.com)',
    };
    const text = publicMessage(sql, 'save');
    expect(text).not.toMatch(/relation|profiles|jo@example|Key \(/);
    expect(
      publicMessage({
        code: '23505',
        message: 'duplicate key value violates unique constraint "x_key"',
      }),
    ).toBe('That already exists.');
  });
  it('keeps our own database messages (written for people)', () => {
    expect(
      publicMessage({ code: 'P0001', message: 'Only a check that is under way can be resolved' }),
    ).toContain('Only a check that is under way can be resolved');
  });
  it('passes only LoadError text through from caught exceptions', () => {
    expect(caughtMessage(new LoadError('the dashboard'))).toBe(
      'Couldn’t load the dashboard. Try again.',
    );
    expect(caughtMessage(new Error('select * from secrets'), 'this page')).not.toContain('select');
  });
});

describe('CSV / XLSX formula injection', () => {
  it.each(['=cmd|"/c calc"!A1', '+1+1', '-2+3', '@SUM(A1)', ' =1+1', '\t=1', '\r=1', '＝1+1'])(
    '%j is made inert',
    (value) => {
      expect(neutralizeFormula(value).startsWith("'")).toBe(true);
      expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );
  it('leaves normal text and numbers alone', () => {
    expect(neutralizeFormula('Jane Doe')).toBe('Jane Doe');
    expect(csvCell(-5)).toBe('-5');
    expect(toCsv([['a', '=b']])).toContain("'=b");
  });
});

describe('user content rendering', () => {
  const evil =
    '# Hi <script>alert(1)</script>\n\n<img src=x onerror=alert(1)> [click](javascript:alert(1))\n\n- <iframe src=//evil>';
  const html = renderToStaticMarkup(<Markdown source={evil} />);

  it('renders Markdown as text: no tags, links or handlers from the source', () => {
    // Real elements or attributes, not the escaped text of them.
    expect(html).not.toMatch(/<(script|img|iframe|a|object|embed|svg)[\s>]/i);
    expect(html).not.toMatch(/\s(href|src|on\w+)="/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('every data-loading server component checks access itself', () => {
  const root = join(__dirname, '..', 'app');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name)) files.push(path);
    }
  };
  walk(root);

  /** Pre-sign-in pages: no staff data. */
  const PUBLIC = /[\\/](login|mfa|auth|reauth)[\\/]/;

  it('found the pages', () => expect(files.length).toBeGreaterThan(50));

  it('no async server component reads data without requireStaff/requireAdmin', () => {
    const offenders: string[] = [];
    for (const file of files.filter((f) => !PUBLIC.test(f))) {
      const source = readFileSync(file, 'utf8');
      if (/^\s*['"]use client['"]/.test(source)) continue;
      const fns = [...source.matchAll(/(?:export )?async function (\w+)\(/g)];
      fns.forEach((m, i) => {
        const end = fns[i + 1]?.index ?? source.length;
        const body = source.slice(m.index, end);
        const readsData = /createClient\(\)|supabase\.(from|rpc|storage)/.test(body);
        const checks = /require(Staff|Admin)\(|getStaffSession\(/.test(body);
        if (readsData && !checks) offenders.push(`${file.slice(root.length)}: ${m[1]}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no file uses dangerouslySetInnerHTML except the static theme script', () => {
    const users = files.filter((f) => readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'));
    expect(users.map((f) => f.slice(root.length).replace(/\\/g, '/'))).toEqual(['/layout.tsx']);
  });
});
