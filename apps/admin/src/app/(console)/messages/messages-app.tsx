'use client';

import type { Database } from '@deltaguard/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { GroupIcon, MessagesIcon, PlusIcon } from '@/components/icons';
import { Avatar } from '@/components/ui';
import { consoleError, withSessionRetry } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';

import { NewChatPanel, NewGroupPanel } from './panels';
import { Thread } from './thread';

export type Conversation = Database['public']['Functions']['list_conversations']['Returns'][number];
export type Site = { id: string; name: string };

const ROLE: Record<string, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  officer: 'Officer',
};

/** "14:05" today, "Mon" this week, else "12 Mar" (browser's clock and zone). */
export function chatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  if ((now.getTime() - d.getTime()) / 86_400_000 < 6) {
    return d.toLocaleDateString('en-GB', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The console's chat: conversation list on the left, the open thread on the
 * right. Reads and writes use the staff member's own session, so RLS applies;
 * Realtime keeps the list and unread counts live.
 */
export function MessagesApp({
  userId,
  sites,
  initialConversationId,
}: {
  userId: string;
  sites: Site[];
  initialConversationId: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialConversationId);
  const [panel, setPanel] = useState<'new' | 'group' | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await withSessionRetry(supabase, () =>
      supabase.rpc('list_conversations'),
    );
    if (error) setError(consoleError(error, 'load conversations'));
    else {
      setError(null);
      setConversations(data);
    }
  }, [supabase]);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 300);
    };
    void (async () => {
      await supabase.realtime.setAuth(); // the user's token, so RLS lets their rows through
      if (disposed) return;
      channel = supabase
        .channel(`console-chat-list:${userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refresh)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversation_reads',
            filter: `user_id=eq.${userId}`,
          },
          refresh,
        )
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') refresh();
        });
    })();
    // Back in the tab, or back online after the internet dropped.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, userId, reload]);

  function open(id: string) {
    setSelected(id);
    setPanel(null);
    // Keeps the open conversation in the URL (shareable, survives a refresh).
    window.history.replaceState(null, '', `/messages?c=${id}`);
  }

  const current = conversations?.find((c) => c.id === selected) ?? null;

  return (
    <div className="grid h-[calc(100dvh-9rem)] min-h-[32rem] grid-cols-1 overflow-hidden panel md:grid-cols-[20rem_1fr]">
      <aside
        className={`flex min-h-0 flex-col border-line md:border-r ${selected || panel ? 'hidden md:flex' : 'flex'}`}
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
          <h1 className="text-xl font-semibold">Messages</h1>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPanel('group')}
              className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium hover:text-fg"
              title="New group"
            >
              <GroupIcon className="size-4" /> Group
            </button>
            <button
              type="button"
              onClick={() => setPanel('new')}
              className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white dark:bg-gold dark:text-ink"
              title="New message"
            >
              <PlusIcon className="size-4" /> New
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {error ? (
            <p className="p-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : conversations === null ? (
            <div className="flex flex-col gap-2 p-2" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-2xl bg-surface-2" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              No conversations yet. Start one with <strong>New</strong>, or create a group.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((c) => (
                <li key={c.id}>
                  <ConversationRow
                    conversation={c}
                    userId={userId}
                    active={c.id === selected}
                    onOpen={() => open(c.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={`min-h-0 ${selected || panel ? 'flex' : 'hidden md:flex'} flex-col`}>
        {panel === 'new' ? (
          <NewChatPanel
            onClose={() => setPanel(null)}
            onOpened={(id) => void reload().then(() => open(id))}
          />
        ) : panel === 'group' ? (
          <NewGroupPanel
            sites={sites}
            onClose={() => setPanel(null)}
            onCreated={(id) => void reload().then(() => open(id))}
          />
        ) : selected ? (
          <Thread
            key={selected}
            conversationId={selected}
            conversation={current}
            userId={userId}
            onBack={() => {
              setSelected(null);
              window.history.replaceState(null, '', '/messages');
            }}
            onChanged={() => void reload()}
            onLeft={() => {
              setSelected(null);
              window.history.replaceState(null, '', '/messages');
              void reload();
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted">
            <MessagesIcon className="size-10 text-gold" />
            <p>Choose a conversation, or start a new one.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationRow({
  conversation: c,
  userId,
  active,
  onOpen,
}: {
  conversation: Conversation;
  userId: string;
  active: boolean;
  onOpen: () => void;
}) {
  const unread = c.unread_count > 0;
  const preview = c.last_message_preview
    ? `${c.last_message_sender_id === userId ? 'You: ' : ''}${c.last_message_preview}`
    : c.type === 'group'
      ? `${c.member_count} members`
      : 'No messages yet';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-surface-2' : 'hover:bg-surface-2/70'
      }`}
    >
      {c.type === 'group' ? (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-navy text-gold ring-2 ring-gold/50">
          <GroupIcon className="size-4" />
        </span>
      ) : (
        <Avatar name={c.title} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`flex-1 truncate text-sm ${unread ? 'font-bold' : 'font-medium'}`}>
            {c.title}
            {c.type === 'direct' && c.other_user_role ? (
              <span className="font-normal text-muted"> · {ROLE[c.other_user_role]}</span>
            ) : null}
          </span>
          {c.last_message_at ? (
            <span className={`shrink-0 text-xs ${unread ? 'text-accent-ink' : 'text-muted'}`}>
              {chatTime(c.last_message_at)}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <span className={`flex-1 truncate text-xs ${unread ? 'text-fg' : 'text-muted'}`}>
            {preview}
          </span>
          {unread ? (
            <span className="min-w-5 rounded-full bg-gold px-1.5 text-center text-xs font-semibold text-ink tabular-nums">
              {c.unread_count > 99 ? '99+' : c.unread_count}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
