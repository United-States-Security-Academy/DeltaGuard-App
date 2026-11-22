import { acknowledgePostOrderSchema } from '@deltaguard/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from './supabase';

// Post orders of a site and whether the signed-in officer has acknowledged
// their current version. RLS only returns active post orders of sites the
// officer is assigned to, and only their own acknowledgements.

export type PostOrder = {
  id: string;
  title: string;
  body: string;
  version: number;
  publishedAt: string;
  /** Highest version this officer acknowledged, or null. */
  acknowledgedVersion: number | null;
  acknowledgedAt: string | null;
};

export const postOrderKeys = {
  site: (siteId: string, userId: string) => ['post-orders', siteId, userId] as const,
};

export const isAcknowledged = (o: PostOrder) =>
  o.acknowledgedVersion !== null && o.acknowledgedVersion >= o.version;

async function loadPostOrders(siteId: string, userId: string): Promise<PostOrder[]> {
  const [orders, acks] = await Promise.all([
    supabase
      .from('post_orders')
      .select('id, title, body, version, published_at')
      .eq('site_id', siteId)
      .is('archived_at', null)
      .order('title'),
    supabase
      .from('post_order_acknowledgements')
      .select('post_order_id, version, acknowledged_at')
      .eq('officer_id', userId),
  ]);
  if (orders.error) throw orders.error;
  if (acks.error) throw acks.error;

  return orders.data.map((o) => {
    const mine = acks.data
      .filter((a) => a.post_order_id === o.id)
      .sort((a, b) => b.version - a.version)[0];
    return {
      id: o.id,
      title: o.title,
      body: o.body,
      version: o.version,
      publishedAt: o.published_at,
      acknowledgedVersion: mine?.version ?? null,
      acknowledgedAt: mine?.acknowledged_at ?? null,
    };
  });
}

function postOrdersQuery(siteId: string, userId: string) {
  return {
    queryKey: postOrderKeys.site(siteId, userId),
    queryFn: () => loadPostOrders(siteId, userId),
  };
}

export function useSitePostOrders(siteId: string | null | undefined, userId: string) {
  return useQuery({
    ...postOrdersQuery(siteId ?? '', userId),
    enabled: Boolean(siteId),
  });
}

/**
 * Before a clock-in: the latest post orders straight from the server (an
 * admin may have just published a new version). Offline, the last copy this
 * phone loaded; `null` if it never loaded any (the server then decides).
 */
export async function checkPostOrders(
  client: QueryClient,
  siteId: string,
  userId: string,
): Promise<{ orders: PostOrder[]; fresh: boolean } | null> {
  try {
    const orders = await client.fetchQuery({ ...postOrdersQuery(siteId, userId), staleTime: 0 });
    return { orders, fresh: true };
  } catch {
    const cached = client.getQueryData<PostOrder[]>(postOrderKeys.site(siteId, userId));
    return cached ? { orders: cached, fresh: false } : null;
  }
}

export function useAcknowledgePostOrder(siteId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (order: Pick<PostOrder, 'id' | 'version'>) => {
      const input = acknowledgePostOrderSchema.parse({
        p_post_order_id: order.id,
        p_version: order.version,
      });
      const { error } = await supabase.rpc('acknowledge_post_order', input);
      if (error) throw new Error(error.message);
    },
    onSettled: () => client.invalidateQueries({ queryKey: postOrderKeys.site(siteId, userId) }),
  });
}
