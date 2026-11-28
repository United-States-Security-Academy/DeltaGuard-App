import {
  formatTimeRange,
  INCIDENT_PHOTOS_BUCKET,
  INCIDENT_STATUS_LABELS,
  incidentCategoryLabel,
  recordIdSchema,
  SIGNED_URL_MAX_SECONDS,
} from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { IncidentStatusBadge, SeverityBadge } from '@/components/status';
import { Card, ErrorText } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../schedule/data';
import { formatWhen, loadIncident } from '../data';
import { ReviewForm } from './review-form';
import { caughtMessage } from '@/lib/server-errors';

type Props = PageProps<'/incidents/[id]'>;

/** Photos are shown through signed links that expire after this long. */
const PHOTO_URL_SECONDS = SIGNED_URL_MAX_SECONDS;

export default function IncidentPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/incidents" className="text-sm text-slate-500 hover:underline">
        ← Incidents
      </Link>
      <Suspense fallback={<p className="text-slate-500">Loading report…</p>}>
        <IncidentContent params={params} />
      </Suspense>
    </div>
  );
}

async function IncidentContent({ params }: Pick<Props, 'params'>) {
  const staff = await requireStaff();
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();

  const supabase = await createClient();
  let incident;
  try {
    incident = await loadIncident(supabase, id.data.id);
  } catch (e) {
    return <ErrorText>{caughtMessage(e, 'this report')}</ErrorText>;
  }
  if (!incident) notFound();
  const timeZone = await getTimeZone(supabase);
  const when = (iso: string) => formatWhen(iso, timeZone);

  const paths = incident.incident_photos.map((p) => p.storage_path);
  const signed = paths.length
    ? await supabase.storage.from(INCIDENT_PHOTOS_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS)
    : { data: [] };
  const photos = (signed.data ?? []).flatMap((s) =>
    s.signedUrl && s.path ? [{ path: s.path, signedUrl: s.signedUrl }] : [],
  );

  const reviewable =
    (incident.status === 'submitted' || incident.status === 'under_review') &&
    incident.officer_id !== staff.userId;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">
            {incidentCategoryLabel(incident.category)} at {incident.sites?.name ?? 'unknown site'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
            <span>{when(incident.occurred_at)}</span>
          </div>
        </div>
        <a
          href={`/incidents/${incident.id}/pdf`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Export PDF
        </a>
      </div>

      {reviewable ? (
        <Card title="Review">
          <ReviewForm id={incident.id} status={incident.status} />
        </Card>
      ) : incident.status === 'returned' ? (
        <Card title="Returned to the officer">
          <p className="text-sm whitespace-pre-wrap">{incident.review_notes}</p>
          <p className="mt-2 text-xs text-slate-500">
            Waiting for {incident.officer?.full_name ?? 'the officer'} to edit and resubmit it.
          </p>
        </Card>
      ) : incident.officer_id === staff.userId ? (
        <p className="text-sm text-slate-500">You filed this report, so someone else reviews it.</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="What happened">
            <p className="text-sm leading-6 whitespace-pre-wrap">{incident.description}</p>
          </Card>
          <Card title="People involved">
            <p className="text-sm leading-6 whitespace-pre-wrap">
              {incident.people_involved ?? 'None recorded.'}
            </p>
          </Card>
          <Card title={`Photos (${photos.length})`}>
            {photos.length === 0 ? (
              <p className="text-sm text-slate-500">No photos.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((p, i) => (
                  <a key={p.path} href={p.signedUrl} target="_blank" rel="noreferrer">
                    {/* Signed URL to a private bucket: next/image can't optimise it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.signedUrl}
                      alt={`Incident photo ${i + 1}`}
                      className="aspect-[4/3] w-full rounded-lg object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Details">
            <dl className="flex flex-col gap-3 text-sm">
              <Detail label="Reported by">
                <Link href={`/officers/${incident.officer_id}`} className="hover:underline">
                  {incident.officer?.full_name ?? 'Unknown'}
                </Link>
                {incident.officer?.phone ? ` · ${incident.officer.phone}` : ''}
              </Detail>
              <Detail label="Site">
                {incident.sites?.name ?? '—'}
                {incident.sites?.clients?.name ? ` (${incident.sites.clients.name})` : ''}
                {incident.sites?.address ? (
                  <span className="block text-slate-500">{incident.sites.address}</span>
                ) : null}
              </Detail>
              <Detail label="Shift">
                {incident.shifts
                  ? formatTimeRange(incident.shifts.starts_at, incident.shifts.ends_at, timeZone)
                  : 'Not linked to a shift'}
              </Detail>
              <Detail label="Police called">{incident.police_called ? 'Yes' : 'No'}</Detail>
              <Detail label="Submitted">{when(incident.submitted_at)}</Detail>
              {incident.reviewed_at ? (
                <Detail label="Reviewed">
                  {when(incident.reviewed_at)}
                  {incident.reviewer?.full_name ? ` by ${incident.reviewer.full_name}` : ''}
                </Detail>
              ) : null}
            </dl>
          </Card>

          <Card title="History">
            <ol className="flex flex-col gap-3 text-sm">
              {incident.history.map((h) => (
                <li key={h.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                  <p className="font-medium">
                    {h.from_status ? INCIDENT_STATUS_LABELS[h.from_status] : 'Filed'} →{' '}
                    {INCIDENT_STATUS_LABELS[h.to_status]}
                  </p>
                  <p className="text-slate-500">
                    {when(h.changed_at)}
                    {h.profiles?.full_name ? ` · ${h.profiles.full_name}` : ''}
                  </p>
                  {h.notes ? <p className="mt-1 whitespace-pre-wrap">{h.notes}</p> : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
