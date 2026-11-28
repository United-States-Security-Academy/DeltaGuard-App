import { firstParam, FORM_INBOX_STATUS_LABELS, FORM_INBOX_STATUSES } from '@deltaguard/shared';
import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';

import { FormSubmissionStatusBadge } from '@/components/status';
import { Badge, Button, EmptyState, ErrorText, Select } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../schedule/data';
import { formatWhen } from '../format';
import { BulkDownload, SelectAll } from './bulk';
import { loadFailed } from '@/lib/server-errors';

const LIMIT = 300;

const filtersSchema = z.object({
  // Default: waiting for review.
  status: z.preprocess(firstParam, z.enum(['all', ...FORM_INBOX_STATUSES])).catch('submitted'),
  form: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  site: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  officer: z.preprocess(firstParam, z.uuid().optional()).catch(undefined),
  overdue: z.preprocess(firstParam, z.literal('1').optional()).catch(undefined),
});

export default function SubmissionsPage({ searchParams }: PageProps<'/forms/submissions'>) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/forms" className="text-sm text-slate-500 hover:underline">
        ← Forms
      </Link>
      <h1 className="text-2xl font-bold">Form submissions</h1>
      <Suspense fallback={<p className="text-slate-500">Loading submissions…</p>}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Inbox({
  searchParams,
}: {
  searchParams: PageProps<'/forms/submissions'>['searchParams'];
}) {
  await requireStaff();
  const f = filtersSchema.parse(await searchParams);
  const supabase = await createClient();

  const [rows, templates, sites, officers, timeZone] = await Promise.all([
    supabase.rpc('form_inbox', {
      p_template_id: f.form,
      p_site_id: f.site,
      p_officer_id: f.officer,
      p_status: f.status === 'all' ? undefined : f.status,
      p_overdue: f.overdue === '1',
      p_limit: LIMIT,
    }),
    supabase.from('form_templates').select('id, title').neq('status', 'draft').order('title'),
    supabase.from('sites').select('id, name').order('name'),
    supabase.from('profiles').select('id, full_name').eq('role', 'officer').order('full_name'),
    getTimeZone(supabase),
  ]);
  if (rows.error) return <ErrorText>{loadFailed('submissions', rows.error)}</ErrorText>;
  const list = rows.data;
  const downloadable = list.filter((r) => r.has_pdf && r.submission_id).length;

  return (
    <>
      <Form action="/forms/submissions" className="flex flex-wrap items-end gap-3">
        <Select label="Status" name="status" defaultValue={f.status}>
          <option value="all">All</option>
          {FORM_INBOX_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FORM_INBOX_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select label="Form" name="form" defaultValue={f.form ?? ''}>
          <option value="">All forms</option>
          {(templates.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
        <Select label="Site" name="site" defaultValue={f.site ?? ''}>
          <option value="">All sites</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select label="Officer" name="officer" defaultValue={f.officer ?? ''}>
          <option value="">Anyone</option>
          {(officers.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.full_name ?? 'Unnamed'}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={f.overdue === '1'} />
          Overdue only
        </label>
        <Button type="submit">Apply</Button>
        <Link href="/forms/submissions" className="py-2 text-sm text-slate-500 hover:underline">
          Reset
        </Link>
      </Form>

      {list.length === 0 ? (
        <EmptyState>
          {f.status === 'submitted' && !f.overdue
            ? 'Nothing is waiting for review.'
            : 'No submissions match these filters.'}
        </EmptyState>
      ) : (
        <>
          {/* Native POST: the ZIP is built server-side from the selected rows. */}
          <form id="bulk" method="post" action="/forms/submissions/zip" />
          <div className="flex flex-wrap items-center gap-3">
            <BulkDownload formId="bulk" available={downloadable} />
          </div>
          <div className="overflow-x-auto panel px-2 py-1 sm:px-3">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="w-8 px-3 py-3">
                    <SelectAll formId="bulk" disabled={downloadable === 0} />
                  </th>
                  {['Form', 'Officer', 'Status', 'Due', 'Submitted', 'Reviewed'].map((h) => (
                    <th key={h} className="px-3 py-3 text-xs font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&>tr]:border-t [&>tr]:border-line">
                {list.map((r) => (
                  <tr key={r.row_key} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                    <td className="px-3 py-3">
                      {r.submission_id && r.has_pdf ? (
                        <input
                          type="checkbox"
                          name="id"
                          value={r.submission_id}
                          form="bulk"
                          aria-label={`Select ${r.template_title} by ${r.officer_name ?? 'officer'}`}
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {r.submission_id ? (
                        <Link
                          href={`/forms/submissions/${r.submission_id}`}
                          className="font-medium hover:underline"
                        >
                          {r.template_title}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.template_title}</span>
                      )}
                      {r.template_version ? (
                        <span className="ml-1 text-xs text-muted">v{r.template_version}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">{r.officer_name ?? '—'}</td>
                    <td className="px-3 py-3">
                      <span className="flex flex-wrap gap-1.5">
                        <FormSubmissionStatusBadge
                          status={r.status as (typeof FORM_INBOX_STATUSES)[number]}
                        />
                        {r.overdue ? <Badge tone="bad">Overdue</Badge> : null}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {formatWhen(r.due_at, timeZone)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {formatWhen(r.submitted_at, timeZone)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {formatWhen(r.reviewed_at, timeZone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length === LIMIT ? (
            <p className="text-sm text-slate-500">
              Showing {LIMIT}. Narrow the filters to see more.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
