import { FORM_SUBMISSIONS_BUCKET, type FormFieldType, recordIdSchema } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { FormSubmissionStatusBadge } from '@/components/status';
import { Badge, Card, ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../../schedule/data';
import { signPaths, VIEW_URL_SECONDS } from '../../data';
import { formatAnswer, formatWhen } from '../../format';
import { ReviewForm } from './review-form';
import { loadFailed } from '@/lib/server-errors';

type Props = PageProps<'/forms/submissions/[id]'>;

type SnapshotField = { key: string; label: string; type: FormFieldType };

export default function SubmissionPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/forms/submissions" className="text-sm text-slate-500 hover:underline">
        ← Submissions
      </Link>
      <Suspense fallback={<p className="text-slate-500">Loading submission…</p>}>
        <SubmissionContent params={params} />
      </Suspense>
    </div>
  );
}

async function SubmissionContent({ params }: Pick<Props, 'params'>) {
  const staff = await requireStaff();
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();

  const supabase = await createClient();
  const { data: s, error } = await supabase
    .from('form_submissions')
    .select(
      `*,
       form_templates(title),
       officer:profiles!form_submissions_officer_id_fkey(full_name),
       reviewer:profiles!form_submissions_reviewer_id_fkey(full_name),
       form_assignments(due_at)`,
    )
    .eq('id', id.data.id)
    .maybeSingle();
  if (error) return <ErrorText>{loadFailed('this submission', error)}</ErrorText>;
  if (!s) notFound();

  const [version, timeZone, [pdfUrl, signatureUrl]] = await Promise.all([
    supabase
      .from('form_template_versions')
      .select('fields')
      .eq('template_id', s.template_id)
      .eq('version', s.template_version)
      .maybeSingle(),
    getTimeZone(supabase),
    signPaths(
      supabase,
      FORM_SUBMISSIONS_BUCKET,
      [s.filled_pdf_path, s.signature_path].filter((p): p is string => !!p),
      VIEW_URL_SECONDS,
    ).then((urls) => {
      const pdf = s.filled_pdf_path ? (urls.shift() ?? null) : null;
      const signature = s.signature_path ? (urls.shift() ?? null) : null;
      return [pdf, signature] as const;
    }),
  ]);

  const fields = (
    Array.isArray(version.data?.fields) ? version.data.fields : []
  ) as SnapshotField[];
  const values = (s.values ?? {}) as Record<string, unknown>;
  const due = s.form_assignments?.due_at ?? null;
  const overdue =
    due !== null &&
    Date.parse(due) < new Date().getTime() &&
    ['draft', 'returned'].includes(s.status);
  const reviewable = s.status === 'submitted' && s.officer_id !== staff.userId;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">
            {s.form_templates?.title ?? 'Form'}{' '}
            <span className="text-base font-normal text-muted">v{s.template_version}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <FormSubmissionStatusBadge status={s.status} />
            {overdue ? <Badge tone="bad">Overdue</Badge> : null}
            <span>by {s.officer?.full_name ?? 'unknown officer'}</span>
            {s.submitted_at ? (
              <span>· submitted {formatWhen(s.submitted_at, timeZone)}</span>
            ) : null}
            {due ? <span>· due {formatWhen(due, timeZone)}</span> : null}
          </div>
        </div>
        {s.filled_pdf_path ? (
          <a
            href={`/forms/submissions/${s.id}/pdf`}
            className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Download PDF
          </a>
        ) : null}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card title="Filled form">
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              title="Filled PDF"
              className="h-[80vh] w-full rounded-lg border border-line bg-white"
            />
          ) : (
            <p className="text-sm text-muted">
              No PDF yet: the officer hasn’t submitted this form. The answers saved so far are
              listed here.
            </p>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          {reviewable ? (
            <Card title="Review">
              <ReviewForm id={s.id} />
            </Card>
          ) : null}

          {s.review_notes || s.reviewed_at ? (
            <Card title="Last review">
              <p className="text-sm">
                {s.reviewer?.full_name ?? 'A reviewer'} · {formatWhen(s.reviewed_at, timeZone)}
              </p>
              {s.review_notes ? (
                <p className="mt-2 text-sm whitespace-pre-wrap">{s.review_notes}</p>
              ) : null}
            </Card>
          ) : null}

          <Card title="Answers">
            {fields.length === 0 ? (
              <p className="text-sm text-muted">The form version could not be loaded.</p>
            ) : (
              <dl className="flex flex-col gap-3 text-sm">
                {fields.map((f) => (
                  <div key={f.key}>
                    <dt className="text-xs font-medium text-muted">{f.label}</dt>
                    <dd className="whitespace-pre-wrap">
                      {f.type === 'signature' ? (
                        signatureUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
                          <img
                            src={signatureUrl}
                            alt="Signature"
                            className="mt-1 h-16 rounded bg-white p-1"
                          />
                        ) : (
                          '—'
                        )
                      ) : (
                        formatAnswer(f.type, values[f.key])
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {s.filled_pdf_sha256 ? (
            <Card title="Integrity">
              <p className="text-xs text-muted">
                Signed {formatWhen(s.signed_at, timeZone)} (server time). SHA-256 of the PDF:
              </p>
              <p className="mt-1 font-mono text-xs break-all">{s.filled_pdf_sha256}</p>
              {s.device_id ? <p className="mt-2 text-xs text-muted">Device {s.device_id}</p> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
