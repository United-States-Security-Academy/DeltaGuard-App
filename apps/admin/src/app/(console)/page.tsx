import { COMPANY_NAME } from '@deltaguard/shared';
import { Suspense } from 'react';

import { requireStaff } from '@/lib/auth';

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium tracking-widest text-slate-500 uppercase">{COMPANY_NAME}</p>
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
        <Welcome />
      </Suspense>
    </div>
  );
}

async function Welcome() {
  const staff = await requireStaff();
  return (
    <p className="text-slate-500">
      Signed in as {staff.role}. The management dashboard is coming in a later phase.
    </p>
  );
}
