'use client';

import { useRouter } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ATTENDANCE_SERIES } from './series';

type Day = { day: string; on_time: number; late: number; missed: number };

const AXIS_TICK = { fill: 'var(--muted)', fontSize: 11 };

function dayLabel(iso: string, long = false): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: long ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function TooltipBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-36 rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-ink">
      <p className="mb-1 font-semibold">{title}</p>
      {children}
    </div>
  );
}

/** Stacked daily bars: on time, late, missed. */
export function AttendanceBars({ days }: { days: Day[] }) {
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={days}
          margin={{ top: 8, right: 4, bottom: 0, left: -12 }}
          barCategoryGap="18%"
        >
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => dayLabel(d)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            allowDecimals={false}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as Day | undefined;
              if (!active || !row) return null;
              const total = row.on_time + row.late + row.missed;
              return (
                <TooltipBox title={dayLabel(row.day, true)}>
                  {total === 0 ? (
                    <p className="opacity-75">No clock-ins</p>
                  ) : (
                    ATTENDANCE_SERIES.map((s) => (
                      <p key={s.key} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: s.color }} />
                        <span className="flex-1">{s.label}</span>
                        <span className="font-semibold tabular-nums">{row[s.key]}</span>
                      </p>
                    ))
                  )}
                </TooltipBox>
              );
            }}
          />
          {ATTENDANCE_SERIES.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="attendance"
              fill={s.color}
              stroke="var(--surface)"
              strokeWidth={1}
              radius={i === ATTENDANCE_SERIES.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type SiteRow = {
  site_id: string;
  site_name: string;
  incidents: number;
  high_or_critical: number;
  href: string;
};

/** Horizontal bars, one per site; a bar opens that site's incidents. */
export function IncidentsBySiteBars({ sites }: { sites: SiteRow[] }) {
  const router = useRouter();
  return (
    <div className="w-full" style={{ height: sites.length * 40 + 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={sites}
          margin={{ top: 4, right: 32, bottom: 4, left: 0 }}
          barCategoryGap={10}
        >
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="site_name"
            width={128}
            tick={{ fill: 'var(--fg)', fontSize: 12 }}
            tickFormatter={(name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as SiteRow | undefined;
              if (!active || !row) return null;
              return (
                <TooltipBox title={row.site_name}>
                  <p>
                    {row.incidents} {row.incidents === 1 ? 'incident' : 'incidents'}
                  </p>
                  {row.high_or_critical > 0 ? <p>{row.high_or_critical} high or critical</p> : null}
                  <p className="mt-1 opacity-75">Click to open the list</p>
                </TooltipBox>
              );
            }}
          />
          <Bar
            dataKey="incidents"
            fill="var(--chart-1)"
            radius={[0, 4, 4, 0]}
            maxBarSize={20}
            isAnimationActive={false}
            className="cursor-pointer"
            onClick={(entry) => {
              const href = (entry.payload as SiteRow | undefined)?.href;
              if (href) router.push(href);
            }}
          >
            <LabelList dataKey="incidents" position="right" fill="var(--fg)" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
