'use client';

import { addMembersSchema, createGroupSchema, type Database } from '@deltaguard/shared';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';

import { CloseIcon } from '@/components/icons';
import { Avatar, Button, Field, Select } from '@/components/ui';
import { consoleError, withSessionRetry } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';

import type { Site } from './messages-app';
import type { Person } from './thread';

type Contact = Database['public']['Functions']['chat_contacts']['Returns'][number];

const ROLE: Record<string, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  officer: 'Officer',
};

/** People this staff member can message or add (chat_contacts: every other active user). */
function useContacts() {
  const supabase = useMemo(() => createClient(), []);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void withSessionRetry(supabase, () => supabase.rpc('chat_contacts')).then(({ data, error }) => {
      if (error) setError(consoleError(error, 'load contacts'));
      else setContacts(data);
    });
  }, [supabase]);
  return { contacts, error, supabase };
}

function PanelShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="size-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search people"
      aria-label="Search people"
      className="w-full rounded-full bg-surface-2 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/50"
    />
  );
}

const matches = (c: { full_name: string | null }, q: string) =>
  !q.trim() || (c.full_name ?? '').toLowerCase().includes(q.trim().toLowerCase());

/** Start (or reopen) a 1:1 chat. */
export function NewChatPanel({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: (id: string) => void;
}) {
  const { contacts, error, supabase } = useContacts();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  async function start(userId: string) {
    setBusy(userId);
    setStartError(null);
    const { data, error } = await supabase.rpc('start_direct_conversation', { p_user_id: userId });
    setBusy(null);
    if (error) setStartError(consoleError(error, 'start the chat'));
    else onOpened(data);
  }

  return (
    <PanelShell title="New message" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <SearchBox value={query} onChange={setQuery} />
        {error || startError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error ?? startError}</p>
        ) : null}
        {contacts === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <ul className="flex flex-col">
            {contacts
              .filter((c) => matches(c, query))
              .map((c) => (
                <li key={c.user_id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void start(c.user_id)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
                  >
                    <Avatar name={c.full_name ?? '?'} />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{c.full_name ?? 'Unnamed'}</span>
                      <span className="block text-xs text-muted">{ROLE[c.role]}</span>
                    </span>
                    {busy === c.user_id ? (
                      <span className="text-xs text-muted">Opening…</span>
                    ) : null}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </PanelShell>
  );
}

/** A named group, optionally tied to a site (its assigned people join and stay in step). */
export function NewGroupPanel({
  sites,
  onClose,
  onCreated,
}: {
  sites: Site[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { contacts, error, supabase } = useContacts();
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createGroupSchema.safeParse({
      p_name: name,
      p_member_ids: [...chosen],
      p_site_id: siteId || null,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    setBusy(true);
    setFormError(null);
    const { data, error } = await supabase.rpc('create_group_conversation', {
      p_name: parsed.data.p_name,
      p_member_ids: parsed.data.p_member_ids,
      ...(parsed.data.p_site_id ? { p_site_id: parsed.data.p_site_id } : {}),
    });
    setBusy(false);
    if (error) setFormError(consoleError(error, 'create the group'));
    else onCreated(data);
  }

  return (
    <PanelShell title="New group" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field
          label="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="e.g. Lekki Mall night team"
          required
        />
        <Select
          label="Site (optional)"
          value={siteId}
          onChange={(e) => {
            setSiteId(e.target.value);
            if (!name && e.target.value) {
              setName(sites.find((s) => s.id === e.target.value)?.name ?? '');
            }
          }}
        >
          <option value="">No site</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        {siteId ? (
          <p className="-mt-2 text-xs text-muted">
            Everyone assigned to this site joins now. Officers assigned or unassigned later join or
            leave automatically.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Add people{' '}
            {chosen.size > 0 ? <span className="text-muted">({chosen.size})</span> : null}
          </span>
          <SearchBox value={query} onChange={setQuery} />
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <ul className="flex max-h-72 flex-col overflow-y-auto rounded-2xl border border-line p-1">
            {(contacts ?? [])
              .filter((c) => matches(c, query))
              .map((c) => (
                <li key={c.user_id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={chosen.has(c.user_id)}
                      onChange={(e) =>
                        setChosen((current) => {
                          const next = new Set(current);
                          if (e.target.checked) next.add(c.user_id);
                          else next.delete(c.user_id);
                          return next;
                        })
                      }
                      className="accent-gold"
                    />
                    <span className="flex-1 text-sm">{c.full_name ?? 'Unnamed'}</span>
                    <span className="text-xs text-muted">{ROLE[c.role]}</span>
                  </label>
                </li>
              ))}
          </ul>
        </div>

        {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
        <Button type="submit" disabled={busy} className="self-start">
          {busy ? 'Creating…' : 'Create group'}
        </Button>
      </form>
    </PanelShell>
  );
}

/** Group members: add (staff), remove (staff), leave. */
export function MembersPanel({
  conversationId,
  people,
  userId,
  onClose,
  onChanged,
  onLeft,
}: {
  conversationId: string;
  people: Person[];
  userId: string;
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const { contacts, supabase } = useContacts();
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const members = people.filter((p) => p.is_member);
  const memberIds = new Set(members.map((p) => p.user_id));
  const candidates = (contacts ?? []).filter((c) => !memberIds.has(c.user_id));

  async function add() {
    const parsed = addMembersSchema.safeParse({
      p_conversation_id: conversationId,
      p_user_ids: adding ? [adding] : [],
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Choose someone');
    const { error } = await supabase.rpc('add_conversation_members', parsed.data);
    if (error) setError(consoleError(error, 'add them'));
    else {
      setError(null);
      setAdding('');
      onChanged();
    }
  }

  async function remove(person: Person) {
    const leaving = person.user_id === userId;
    if (
      !window.confirm(
        leaving
          ? 'Leave this group?'
          : `Remove ${person.full_name ?? 'this person'} from the group?`,
      )
    ) {
      return;
    }
    const { error } = await supabase.rpc('remove_conversation_member', {
      p_conversation_id: conversationId,
      p_user_id: person.user_id,
    });
    if (error) return setError(consoleError(error, leaving ? 'leave the group' : 'remove them'));
    if (leaving) onLeft();
    else onChanged();
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="font-semibold">Members ({members.length})</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close members"
          className="rounded-full p-1.5 text-muted hover:bg-surface-2"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      <div className="flex gap-2 px-4 pb-3">
        <select
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          aria-label="Person to add"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Add someone…</option>
          {candidates.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              {c.full_name ?? 'Unnamed'} ({ROLE[c.role]})
            </option>
          ))}
        </select>
        <Button type="button" variant="secondary" onClick={() => void add()} disabled={!adding}>
          Add
        </Button>
      </div>
      {error ? <p className="px-4 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {members.map((p) => (
          <li key={p.user_id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
            <Avatar name={p.full_name ?? '?'} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {p.full_name ?? 'Unnamed'}
                {p.user_id === userId ? <span className="text-muted"> (you)</span> : null}
              </span>
              <span className="block text-xs text-muted">{ROLE[p.role]}</span>
            </span>
            <button
              type="button"
              onClick={() => void remove(p)}
              className="rounded-full px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-red-600"
            >
              {p.user_id === userId ? 'Leave' : 'Remove'}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
