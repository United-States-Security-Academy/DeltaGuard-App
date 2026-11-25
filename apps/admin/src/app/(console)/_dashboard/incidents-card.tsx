import {
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  type IncidentSeverity,
  incidentCategoryLabel,
} from '@deltaguard/shared';
import Link from 'next/link';

import { ArrowRightIcon, CameraIcon } from '@/components/icons';
import { Avatar } from '@/components/ui';

import { formatWhen } from '../incidents/data';
import type { IncidentToReview } from './data';

// The front card is always white on the dark panel, so its tags use fixed light colours.
const SEVERITY_TAG: Record<IncidentSeverity, string> = {
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-amber-50 text-amber-800',
  high: 'bg-red-50 text-red-800',
  critical: 'bg-red-600 text-white',
};

export function IncidentsCard({
  incidents,
  total,
  timeZone,
}: {
  incidents: IncidentToReview[];
  total: number;
  timeZone: string;
}) {
  const first = incidents[0];
  const behind = Math.min(2, total - 1);

  return (
    <section className="flex flex-col gap-5 overflow-hidden rounded-3xl bg-ink p-5 text-white shadow-[var(--panel-shadow)] sm:p-6 dark:bg-navy">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Incidents to review</h2>
          <p className="text-sm text-white/60">
            {total === 0 ? 'Nothing is waiting' : `${total} waiting, most severe first`}
          </p>
        </div>
        <Link
          href="/incidents"
          className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/15"
        >
          View all
        </Link>
      </div>

      {first ? (
        <div className="relative flex flex-1 items-center pr-14">
          {/* Cards waiting behind the first one. */}
          {Array.from({ length: behind }, (_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="absolute inset-y-3 rounded-2xl bg-slate-300"
              style={{
                left: `${(i + 1) * 1.25}rem`,
                right: `${2.25 - i * 1.25}rem`,
                opacity: 0.55 - i * 0.2,
                zIndex: 2 - i,
              }}
            />
          ))}

          <Link
            href={`/incidents/${first.id}`}
            className="relative z-10 flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-white p-4 text-ink shadow-xl transition-transform hover:-translate-y-0.5"
          >
            <div className="flex flex-wrap gap-1.5 text-xs font-medium">
              <span className={`rounded-md px-2 py-1 ${SEVERITY_TAG[first.severity]}`}>
                {INCIDENT_SEVERITY_LABELS[first.severity]}
              </span>
              <span className="rounded-md bg-sky-50 px-2 py-1 text-sky-800">
                {incidentCategoryLabel(first.category)}
              </span>
              {first.police_called ? (
                <span className="rounded-md bg-indigo-50 px-2 py-1 text-indigo-800">
                  Police called
                </span>
              ) : null}
            </div>

            <div>
              <p className="font-semibold">{first.sites?.name ?? 'Unknown site'}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{first.description}</p>
              <p className="mt-1.5 text-xs text-slate-500">
                {formatWhen(first.submitted_at, timeZone)} · {INCIDENT_STATUS_LABELS[first.status]}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={first.officer?.full_name ?? '?'} size="sm" />
                <span className="truncate">{first.officer?.full_name ?? 'Unknown officer'}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <CameraIcon className="size-3.5" />
                {first.incident_photos[0]?.count ?? 0} photos
              </span>
            </div>
          </Link>

          <Link
            href={total > 1 ? '/incidents' : `/incidents/${first.id}`}
            aria-label={total > 1 ? 'See all incidents waiting for review' : 'Open this incident'}
            className="absolute right-0 z-20 flex size-11 items-center justify-center rounded-full bg-white text-ink shadow-lg transition-colors hover:bg-gold"
          >
            <ArrowRightIcon className="size-5" />
          </Link>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-white/20 p-8 text-center">
          <p className="font-medium">All caught up</p>
          <p className="text-sm text-white/60">New incident reports from officers appear here.</p>
        </div>
      )}
    </section>
  );
}
