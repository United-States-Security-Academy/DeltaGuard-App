import 'server-only';

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Where to centre the map for a site without coordinates: the newest site that has some. */
export async function fallbackMapCenter(supabase: Supabase): Promise<[number, number] | null> {
  const { data } = await supabase
    .from('sites')
    .select('latitude, longitude')
    .not('latitude', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.latitude != null && data.longitude != null ? [data.latitude, data.longitude] : null;
}
