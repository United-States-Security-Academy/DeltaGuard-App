-- Phase 20c: phase 20 rebuilt the attendance_events flags constraint from the
-- phase 3 list and dropped flags added since ('delayed' from phase 5,
-- 'post_orders_unread' from phase 6), so offline (queued) clock-ins and
-- clock-ins with unread post orders were refused. This restores the full list.
-- (Phase 20's own file now has the full list too, for fresh databases.)
alter table public.attendance_events drop constraint attendance_events_flags_check;
alter table public.attendance_events add constraint attendance_events_flags_check check (
  flags <@ array[
    'late', 'early_leave', 'out_of_range', 'mock_location', 'low_accuracy', 'wrong_device',
    'delayed', 'post_orders_unread', 'device_unverified', 'device_failed'
  ]
);
