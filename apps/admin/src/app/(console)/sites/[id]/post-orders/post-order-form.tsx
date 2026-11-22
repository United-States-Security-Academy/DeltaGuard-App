'use client';

import { useActionState, useState } from 'react';

import { Markdown } from '@/components/markdown';
import { Button, Field, FormMessage, Textarea } from '@/components/ui';

import { createPostOrder, updatePostOrder } from '../../post-order-actions';

export type PostOrderValues = {
  id?: string;
  siteId: string;
  title: string;
  body: string;
  version?: number;
};

/**
 * Create (no id) or edit a post order. There are no drafts: saving publishes,
 * and a changed title or body becomes a new version officers must acknowledge.
 */
export function PostOrderForm({ values }: { values: PostOrderValues }) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState(
    editing ? updatePostOrder : createPostOrder,
    null,
  );
  const [body, setBody] = useState(values.body);
  const err = state?.fieldErrors ?? {};
  const nextVersion = (values.version ?? 0) + 1;

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          editing &&
          !window.confirm(
            `Publish version ${nextVersion}? Every officer at this site will have to read and acknowledge it before they can clock in. (Nothing happens if you didn't change the title or text.)`,
          )
        ) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="site_id" value={values.siteId} />
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {values.version ? <input type="hidden" name="version" value={values.version} /> : null}

      <Field
        label="Title"
        name="title"
        required
        maxLength={200}
        placeholder="e.g. Access control at the main gate"
        defaultValue={values.title}
        error={err.title}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Textarea
          label="Instructions"
          name="body"
          required
          rows={18}
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={err.body}
          className="min-h-96 rounded-lg border border-slate-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-slate-900 dark:border-slate-700 dark:focus:border-slate-200"
        />
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Preview (as officers see it)</span>
          <div className="min-h-96 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <Markdown source={body} />
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Formatting: <code># Heading</code>, <code>## Smaller heading</code>, <code>- bullet</code>,{' '}
        <code>1. numbered</code>, <code>**bold**</code>, <code>*italic*</code>. Leave a blank line
        between paragraphs.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Publishing…' : editing ? `Publish version ${nextVersion}` : 'Publish'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
