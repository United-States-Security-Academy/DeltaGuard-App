-- Phase 20d: only a FAILED phone flags a clock-in / clock-out.
--
-- Phase 20 also added 'device_unverified' to every clock event from a phone
-- whose check hadn't run. The dashboard, the live board and the flagged
-- clock-in alerts count any flag (other than 'late') as an exception, so
-- until App Attest / Play Integrity are configured EVERY clock-in would have
-- shown as flagged. "Not verified yet" is shown per phone on the Users page
-- instead; the attendance flag now means a real problem: 'device_failed'.
-- (Quiz attempts and form submissions still record 'unverified' in their
-- device_integrity column, which is informational and counts nowhere.)
create or replace function public.attendance_events_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Refused attempts (wrong phone) are stored as evidence, never blocked here.
  if not new.accepted then
    return new;
  end if;
  if public.device_integrity_gate(new.officer_id, 'clock in or out') = 'failed' then
    new.flags := array_append(new.flags, 'device_failed');
  end if;
  return new;
end;
$$;
