// Plain module (server and client): how training results read.

import type { BadgeTone } from '@/components/ui';

export const RESULT_STATUSES = [
  'not_started',
  'reading',
  'ready_for_quiz',
  'passed',
  'failed',
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  not_started: 'Not started',
  reading: 'Reading',
  ready_for_quiz: 'Ready for quiz',
  passed: 'Passed',
  failed: 'Failed',
};

export const RESULT_STATUS_TONES: Record<ResultStatus, BadgeTone> = {
  not_started: 'neutral',
  reading: 'neutral',
  ready_for_quiz: 'warn',
  passed: 'good',
  failed: 'bad',
};

/** 3725 -> "1 h 2 min"; 45 -> "45 s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatScore(score: number | string | null): string {
  if (score === null) return '—';
  const n = Number(score);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}
