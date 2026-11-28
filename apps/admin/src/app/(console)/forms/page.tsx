import Link from 'next/link';
import { Suspense } from 'react';

import { FormTemplateStatusBadge } from '@/components/status';
import { Badge, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../schedule/data';
import { formatWhen } from './format';
import { loadFailed } from '@/lib/server-errors';

export default function FormsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<p className="text-slate-500">Loading forms…</p>}>
        <FormsContent />
      </Suspense>
    </div>
  );
}

async function FormsContent() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [templates, waiting, timeZone] = await Promise.all([
    supabase
      .from('form_templates')
      .select(
        `id, title, status, version, page_count, edited_at, updated_at,
         form_fields(count), form_assignments(count),
         form_template_versions(version, published_at)`,
      )
      .order('status')
      .order('title'),
    supabase
      .from('form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted'),
    getTimeZone(supabase),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Forms</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/forms/submissions"
            className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Submissions
            {waiting.count ? (
              <span className="ml-2 rounded-full bg-gold px-2 py-0.5 text-xs text-ink">
                {waiting.count}
              </span>
            ) : null}
          </Link>
          {staff.role === 'admin' ? (
            <Link
              href="/forms/new"
              className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-navy dark:bg-gold dark:text-ink"
            >
              New form
            </Link>
          ) : null}
        </div>
      </div>

      {templates.error ? (
        <ErrorText>{loadFailed('forms', templates.error)}</ErrorText>
      ) : templates.data.length === 0 ? (
        <EmptyState>
          {staff.role === 'admin'
            ? 'No forms yet. Upload a PDF form to get started.'
            : 'No published forms yet.'}
        </EmptyState>
      ) : (
        <Table
          head={['Form', 'Status', 'Version', 'Pages', 'Fields', 'Assignments', 'Last published']}
        >
          {templates.data.map((t) => {
            const latest = [...t.form_template_versions].sort((a, b) => b.version - a.version)[0];
            const unpublished =
              t.status !== 'archived' &&
              (!latest || Date.parse(t.edited_at) > Date.parse(latest.published_at));
            return (
              <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                <td className="px-3 py-3">
                  <Link href={`/forms/${t.id}`} className="font-medium hover:underline">
                    {t.title}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <span className="flex flex-wrap gap-1.5">
                    <FormTemplateStatusBadge status={t.status} />
                    {unpublished && latest ? <Badge tone="warn">Unpublished changes</Badge> : null}
                  </span>
                </td>
                <td className="px-3 py-3">{t.version > 0 ? `v${t.version}` : '—'}</td>
                <td className="px-3 py-3">{t.page_count ?? '—'}</td>
                <td className="px-3 py-3">{t.form_fields[0]?.count ?? 0}</td>
                <td className="px-3 py-3">{t.form_assignments[0]?.count ?? 0}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {latest ? formatWhen(latest.published_at, timeZone) : 'Never'}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
