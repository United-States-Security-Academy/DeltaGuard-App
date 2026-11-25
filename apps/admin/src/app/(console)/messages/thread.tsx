'use client';

import {
  CHAT_ATTACHMENTS_BUCKET,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_PAGE_SIZE,
  chatAttachmentFileSchema,
  chatAttachmentPath,
  type Database,
  sendMessageSchema,
} from '@deltaguard/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ArrowRightIcon, CloseIcon, GroupIcon, ImageIcon, SendIcon } from '@/components/icons';
import { Avatar } from '@/components/ui';
import { consoleError, withSessionRetry } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';

import { chatTime, type Conversation } from './messages-app';
import { MembersPanel } from './panels';

export type Person = Database['public']['Functions']['conversation_people']['Returns'][number];

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  attachment_path: string | null;
  created_at: string;
  pending?: 'sending' | 'failed';
  error?: string;
};

const COLUMNS = 'id, conversation_id, sender_id, body, attachment_path, created_at';
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Oldest first; ids are unique. */
function merge(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}

export function Thread({
  conversationId,
  conversation,
  userId,
  onBack,
  onChanged,
  onLeft,
}: {
  conversationId: string;
  conversation: Conversation | null;
  userId: string;
  onBack: () => void;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [showMembers, setShowMembers] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const loadPeople = useCallback(async () => {
    const { data } = await supabase.rpc('conversation_people', {
      p_conversation_id: conversationId,
    });
    if (data) setPeople(data);
  }, [supabase, conversationId]);

  // The parent passes a new function each render; read it through a ref so the
  // effects below don't resubscribe every time.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const markRead = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
    onChangedRef.current();
  }, [supabase, conversationId]);

  /** One page, newest first, older than `before` (keyset on created_at, id). */
  const fetchPage = useCallback(
    async (before: Message | null) => {
      let query = supabase
        .from('messages')
        .select(COLUMNS)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(CHAT_PAGE_SIZE);
      if (before) {
        query = query.or(
          `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
        );
      }
      const { data, error } = await withSessionRetry(supabase, () => query);
      if (error) throw error;
      return data;
    },
    [supabase, conversationId],
  );

  // First page, people, read receipt, and live updates.
  useEffect(() => {
    let disposed = false;
    let channel: RealtimeChannel | null = null;

    void (async () => {
      try {
        const [page] = await Promise.all([fetchPage(null), loadPeople()]);
        if (disposed) return;
        setMessages(merge([], page));
        setHasOlder(page.length === CHAT_PAGE_SIZE);
        void markRead();
      } catch (e) {
        if (!disposed) setError(consoleError(e, 'load the messages'));
      } finally {
        if (!disposed) setLoading(false);
      }

      await supabase.realtime.setAuth();
      if (disposed) return;
      channel = supabase
        .channel(`console-chat:${conversationId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const m = payload.new as Message;
            setMessages((current) => merge(current, [m]));
            if (m.sender_id !== userId) void markRead();
            else void loadPeople();
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversation_reads',
            filter: `conversation_id=eq.${conversationId}`,
          },
          () => void loadPeople(),
        )
        .subscribe((state) => {
          // (Re)connected: pick up anything sent meanwhile.
          if (state === 'SUBSCRIBED') {
            void fetchPage(null).then((page) => setMessages((current) => merge(current, page)));
          }
        });
    })();

    const onVisible = () => void markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, conversationId, userId, fetchPage, loadPeople, markRead]);

  // Signed links for photos we don't have yet (private bucket, 1 hour).
  useEffect(() => {
    const missing = messages
      .map((m) => m.attachment_path)
      .filter((p): p is string => Boolean(p) && !(p! in urls));
    if (missing.length === 0) return;
    void supabase.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .createSignedUrls(missing, 60 * 60)
      .then(({ data }) => {
        const found = Object.fromEntries(
          (data ?? []).flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl]] : [])),
        );
        setUrls((current) => ({ ...current, ...found }));
      });
  }, [messages, urls, supabase]);

  // Stay at the bottom as messages arrive, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    const oldest = messages.find((m) => !m.pending);
    if (!oldest) return;
    const el = scroller.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    setLoadingOlder(true);
    try {
      const page = await fetchPage(oldest);
      setHasOlder(page.length === CHAT_PAGE_SIZE);
      stickToBottom.current = false;
      setMessages((current) => merge(current, page));
      // Keep the view where it was.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - fromBottom;
      });
    } catch (e) {
      setError(consoleError(e, 'load older messages'));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(body: string, file: File | null) {
    const id = crypto.randomUUID();
    const optimistic: Message = {
      id,
      conversation_id: conversationId,
      sender_id: userId,
      body: body.trim() || null,
      attachment_path: null,
      created_at: new Date().toISOString(),
      pending: 'sending',
    };
    stickToBottom.current = true;
    setMessages((current) => merge(current, [optimistic]));
    try {
      let attachmentPath: string | null = null;
      if (file) {
        const checked = chatAttachmentFileSchema.parse({ type: file.type, size: file.size });
        attachmentPath = chatAttachmentPath(conversationId, userId, id, EXTENSIONS[checked.type]!);
        const upload = await supabase.storage
          .from(CHAT_ATTACHMENTS_BUCKET)
          .upload(attachmentPath, file, { contentType: checked.type, upsert: false });
        if (upload.error) throw upload.error;
      }
      const row = sendMessageSchema.parse({
        id,
        conversation_id: conversationId,
        body,
        attachment_path: attachmentPath,
      });
      const { data, error } = await supabase
        .from('messages')
        .insert({ ...row, sender_id: userId })
        .select(COLUMNS)
        .single();
      if (error) throw error;
      setMessages((current) => merge(current, [data]));
      onChanged();
    } catch (e) {
      const message =
        (e as { issues?: { message: string }[] }).issues?.[0]?.message ?? consoleError(e, 'send');
      setMessages((current) =>
        merge(current, [{ ...optimistic, pending: 'failed', error: message }]),
      );
    }
  }

  const names = new Map(people.map((p) => [p.user_id, p.full_name ?? 'Unnamed']));
  const others = people.filter((p) => p.is_member && p.user_id !== userId);
  const isGroup = conversation?.type === 'group';
  const lastMine = [...messages].reverse().find((m) => m.sender_id === userId && !m.pending);
  const receipt = (m: Message) => {
    const seen = others.filter((p) => p.last_read_at && p.last_read_at >= m.created_at).length;
    if (seen === 0) return 'Sent';
    if (!isGroup) return 'Seen';
    return seen === others.length ? 'Seen by everyone' : `Seen by ${seen}`;
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full p-1.5 text-muted hover:bg-surface-2 md:hidden"
            aria-label="Back to conversations"
          >
            <ArrowRightIcon className="size-4 rotate-180" />
          </button>
          {isGroup ? (
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-navy text-gold ring-2 ring-gold/50">
              <GroupIcon className="size-4" />
            </span>
          ) : (
            <Avatar name={conversation?.title ?? '?'} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{conversation?.title ?? 'Conversation'}</p>
            <p className="text-xs text-muted">
              {isGroup ? `${people.filter((p) => p.is_member).length} members` : 'Direct message'}
            </p>
          </div>
          {isGroup ? (
            <button
              type="button"
              onClick={() => setShowMembers((v) => !v)}
              aria-pressed={showMembers}
              className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium hover:text-fg"
            >
              Members
            </button>
          ) : null}
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          {loading ? (
            <p className="text-center text-sm text-muted">Loading messages…</p>
          ) : error ? (
            <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {hasOlder ? (
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="mx-auto mb-2 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted hover:text-fg disabled:opacity-50"
                >
                  {loadingOlder ? 'Loading…' : 'Load older messages'}
                </button>
              ) : messages.length > 0 ? (
                <p className="mb-2 text-center text-xs text-muted">Start of the conversation</p>
              ) : (
                <p className="text-center text-sm text-muted">No messages yet. Say hello.</p>
              )}
              {messages.map((m, i) => {
                const mine = m.sender_id === userId;
                const showName = isGroup && !mine && messages[i - 1]?.sender_id !== m.sender_id;
                return (
                  <Bubble
                    key={m.id}
                    message={m}
                    mine={mine}
                    senderName={showName ? (names.get(m.sender_id) ?? 'Former member') : null}
                    photoUrl={m.attachment_path ? (urls[m.attachment_path] ?? null) : null}
                    receipt={m.id === lastMine?.id ? receipt(m) : null}
                  />
                );
              })}
            </div>
          )}
        </div>

        <Composer onSend={(body, file) => void send(body, file)} />
      </div>

      {showMembers && isGroup ? (
        <MembersPanel
          conversationId={conversationId}
          people={people}
          userId={userId}
          onClose={() => setShowMembers(false)}
          onChanged={() => {
            void loadPeople();
            onChanged();
          }}
          onLeft={onLeft}
        />
      ) : null}
    </div>
  );
}

function Bubble({
  message: m,
  mine,
  senderName,
  photoUrl,
  receipt,
}: {
  message: Message;
  mine: boolean;
  senderName: string | null;
  photoUrl: string | null;
  receipt: string | null;
}) {
  return (
    <div
      className={`flex max-w-[75%] flex-col gap-1 ${mine ? 'items-end self-end' : 'items-start self-start'}`}
    >
      {senderName ? <span className="mt-2 ml-3 text-xs text-accent-ink">{senderName}</span> : null}
      <div
        className={`overflow-hidden rounded-2xl ${
          mine
            ? 'rounded-br-md bg-ink text-white dark:bg-gold dark:text-ink'
            : 'rounded-bl-md bg-surface-2'
        } ${m.pending === 'sending' ? 'opacity-70' : ''}`}
      >
        {m.attachment_path ? (
          photoUrl ? (
            <a href={photoUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={photoUrl} alt="Photo" className="max-h-72 w-64 object-cover" />
            </a>
          ) : (
            <div className="flex h-48 w-64 items-center justify-center text-xs opacity-70">
              Loading photo…
            </div>
          )
        ) : null}
        {m.body ? (
          <p className="px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
            {m.body}
          </p>
        ) : null}
      </div>
      <span
        className={`mx-1 text-[0.7rem] ${m.pending === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}
      >
        {m.pending === 'sending'
          ? 'Sending…'
          : m.pending === 'failed'
            ? `Not sent: ${m.error ?? 'try again'}`
            : `${chatTime(m.created_at)}${receipt ? ` · ${receipt}` : ''}`}
      </span>
    </div>
  );
}

function Composer({ onSend }: { onSend: (body: string, file: File | null) => void }) {
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = body.trim().length > 0 || file !== null;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    onSend(body, file);
    setBody('');
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line p-3">
      {fileError ? <p className="text-xs text-red-600 dark:text-red-400">{fileError}</p> : null}
      {file && preview ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <img src={preview} alt="" className="size-14 rounded-xl object-cover" />
          <span className="flex-1 truncate text-sm text-muted">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileInput.current) fileInput.current.value = '';
            }}
            className="rounded-full p-1.5 text-muted hover:bg-surface-2"
            aria-label="Remove photo"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <label
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-muted hover:text-fg"
          title="Add a photo"
        >
          <ImageIcon className="size-5" />
          <span className="sr-only">Add a photo</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setFileError(null);
              if (!picked) return setFile(null);
              const checked = chatAttachmentFileSchema.safeParse({
                type: picked.type,
                size: picked.size,
              });
              if (!checked.success) {
                setFileError(checked.error.issues[0]?.message ?? 'This file can’t be sent.');
                e.target.value = '';
                return;
              }
              setFile(picked);
            }}
          />
        </label>
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <textarea
          id="chat-message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          placeholder="Write a message"
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-opacity disabled:opacity-40 dark:bg-gold dark:text-ink"
        >
          <SendIcon className="size-4" />
        </button>
      </div>
    </form>
  );
}
