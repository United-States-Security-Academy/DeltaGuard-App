import { NextResponse } from 'next/server';

import { getStaffSession } from '@/lib/auth';

import { questionTemplateCsv } from '../question-csv';

/** GET /training/questions-template: the CSV template for importing questions. */
export async function GET() {
  if (!(await getStaffSession())) return new NextResponse('Not allowed', { status: 403 });
  return new NextResponse(questionTemplateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="deltaguard-questions-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
