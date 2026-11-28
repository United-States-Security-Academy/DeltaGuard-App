import { firstParam, FORM_TEMPLATES_BUCKET, recordIdSchema } from '@deltaguard/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import { ActionButton } from '@/components/action-form';
import { FormTemplateStatusBadge } from '@/components/status';
import { Badge, Card, EmptyState, ErrorText, Table } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../schedule/data';
import { deleteDraftForm, deleteFormAssignment, setFormArchived } from '../actions';
import {
  type LoadedFormTemplate,
  loadFormTemplate,
  PAGE_IMAGE_URL_SECONDS,
  signPaths,
} from '../data';
import { formatWhen } from '../format';
import { AssignForm } from './assign-form';
import { DetailsForm } from './details-form';
import { FieldEditor } from './field-editor';
import { PdfUpload } from './pdf-upload';
import { caughtMessage } from '@/lib/server-errors';

type Props = PageProps<'/forms/[id]'>;

const TABS = ['fields', 'assign', 'versions'] as const;
const tabSchema = z.preprocess(firstParam, z.enum(TABS)).catch('fields');

export default function FormTemplatePage({ params, searchParams }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/forms" className="text-sm text-slate-500 hover:underline">
        ← Forms
      </Link>
      <Suspense fallback={<p className="text-slate-500">Loading form…</p>}>
        <FormContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FormContent({ params, searchParams }: Props) {
  const staff = await requireStaff();
  const isAdmin = staff.role === 'admin';
  const id = recordIdSchema.safeParse(await params);
  if (!id.success) notFound();
  const query = await searchParams;
  const tab = tabSchema.parse(query.tab);

  const supabase = await createClient();
  let loaded;
  try {
    loaded = await loadFormTemplate(supabase, id.data.id);
  } catch (e) {
    return <ErrorText>{caughtMessage(e, 'this form')}</ErrorText>;
  }
  if (!loaded) notFound();
  const { template, fields, versions, assignments } = loaded;
  const timeZone = await getTimeZone(supabase);

  const latest = versions[0];
  const unpublished =
    template.status !== 'archived' &&
    (!latest || Date.parse(template.edited_at) > Date.parse(latest.published_at));
  const editable = isAdmin && template.status !== 'archived';

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{template.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <FormTemplateStatusBadge status={template.status} />
            {template.version > 0 ? <span>Published version {template.version}</span> : null}
            {unpublished && latest ? <Badge tone="warn">Unpublished changes</Badge> : null}
            {template.page_count ? (
              <span>
                · {template.page_count} page{template.page_count === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          {template.description ? (
            <p className="max-w-2xl text-sm text-muted">{template.description}</p>
          ) : null}
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            {template.status === 'published' ? (
              <ActionButton
                action={setFormArchived}
                fields={{ id: template.id, archive: 'true' }}
                label="Archive"
                confirm="Archive this form? Officers stop seeing it; submissions are kept."
              />
            ) : template.status === 'archived' ? (
              <ActionButton
                action={setFormArchived}
                fields={{ id: template.id, archive: 'false' }}
                label="Restore"
              />
            ) : (
              <ActionButton
                action={deleteDraftForm}
                fields={{ id: template.id }}
                label="Delete draft"
                variant="danger"
                confirm="Delete this draft form and its files? This can't be undone."
              />
            )}
          </div>
        ) : null}
      </div>

      {query.upload_error ? (
        <ErrorText>The PDF could not be uploaded. Try again with “Upload PDF”.</ErrorText>
      ) : null}

      <nav className="flex gap-1 border-b border-line text-sm" aria-label="Form sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === 'fields' ? `/forms/${template.id}` : `/forms/${template.id}?tab=${t}`}
            aria-current={tab === t ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${tab === t ? 'border-gold text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t === 'fields'
              ? 'Fields'
              : t === 'assign'
                ? `Assignments (${assignments.length})`
                : `Versions (${versions.length})`}
          </Link>
        ))}
      </nav>

      {tab === 'fields' ? (
        <FieldsTab
          templateId={template.id}
          pagePaths={template.page_image_paths}
          fields={fields}
          editable={editable}
          isAdmin={isAdmin}
          hasPdf={template.original_pdf_path !== null}
          title={template.title}
          description={template.description}
          version={template.version}
        />
      ) : tab === 'assign' ? (
        <AssignTab
          templateId={template.id}
          published={template.status === 'published'}
          isAdmin={isAdmin}
          assignments={assignments}
          timeZone={timeZone}
        />
      ) : (
        <Card title="Published versions">
          {versions.length === 0 ? (
            <EmptyState>Not published yet.</EmptyState>
          ) : (
            <Table head={['Version', 'Published', 'By', 'Fields']}>
              {versions.map((v) => (
                <tr key={v.version}>
                  <td className="px-3 py-3 font-medium">
                    v{v.version}
                    {v.version === template.version ? (
                      <span className="ml-2 text-xs text-muted">(current)</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">{formatWhen(v.published_at, timeZone)}</td>
                  <td className="px-3 py-3">{v.publisher?.full_name ?? '—'}</td>
                  <td className="px-3 py-3">{Array.isArray(v.fields) ? v.fields.length : 0}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-sm text-muted">
            Each submission keeps the version it was filled on. Publishing a new version doesn’t
            change forms already started or submitted.
          </p>
        </Card>
      )}
    </>
  );
}

async function FieldsTab({
  templateId,
  pagePaths,
  fields,
  editable,
  isAdmin,
  hasPdf,
  title,
  description,
  version,
}: {
  templateId: string;
  pagePaths: string[];
  fields: LoadedFormTemplate['fields'];
  editable: boolean;
  isAdmin: boolean;
  hasPdf: boolean;
  title: string;
  description: string | null;
  version: number;
}) {
  await requireStaff(); // each data-loading component checks access itself
  const supabase = await createClient();
  const pageUrls = await signPaths(
    supabase,
    FORM_TEMPLATES_BUCKET,
    pagePaths,
    PAGE_IMAGE_URL_SECONDS,
  );
  return (
    <div className="flex flex-col gap-6">
      {editable ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Details">
            <DetailsForm id={templateId} title={title} description={description} />
          </Card>
          <Card title="PDF">
            <p className="mb-3 text-sm text-muted">
              Pages are rendered in your browser and fillable fields found in the PDF are added for
              you.
            </p>
            <PdfUpload templateId={templateId} hasPdf={hasPdf} />
          </Card>
        </div>
      ) : null}
      <FieldEditor
        // Remount with fresh fields after a save + refresh.
        key={
          fields.map((f) => `${f.key}:${f.x}:${f.y}:${f.width}:${f.height}`).join('|') +
          pagePaths.join('|')
        }
        templateId={templateId}
        pageUrls={pageUrls}
        initialFields={fields}
        readOnly={!editable}
        canPublish={isAdmin && hasPdf}
        publishedVersion={version}
      />
    </div>
  );
}

async function AssignTab({
  templateId,
  published,
  isAdmin,
  assignments,
  timeZone,
}: {
  templateId: string;
  published: boolean;
  isAdmin: boolean;
  assignments: LoadedFormTemplate['assignments'];
  timeZone: string;
}) {
  await requireStaff(); // each data-loading component checks access itself
  const supabase = await createClient();
  const [officers, sites] = isAdmin
    ? await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name')
          .eq('role', 'officer')
          .eq('employment_status', 'active')
          .order('full_name'),
        supabase.from('sites').select('id, name').eq('active', true).order('name'),
      ])
    : [{ data: [] }, { data: [] }];

  const now = new Date().getTime();
  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? (
        <Card title="Assign">
          {published ? (
            <AssignForm
              templateId={templateId}
              officers={(officers.data ?? []).map((o) => ({
                value: o.id,
                label: o.full_name ?? 'Unnamed',
              }))}
              sites={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            />
          ) : (
            <p className="text-sm text-muted">Publish the form before assigning it.</p>
          )}
        </Card>
      ) : null}
      {assignments.length === 0 ? (
        <EmptyState>Not assigned to anyone yet.</EmptyState>
      ) : (
        <Table
          head={[
            'Assigned to',
            'Due',
            'Version at assignment',
            'Assigned',
            ...(isAdmin ? [''] : []),
          ]}
        >
          {assignments.map((a) => (
            <tr key={a.id}>
              <td className="px-3 py-3 font-medium">
                {a.officer_id
                  ? (a.officer?.full_name ?? 'Officer')
                  : a.site_id
                    ? `Everyone at ${a.sites?.name ?? 'a site'}`
                    : `All ${a.role}s`}
              </td>
              <td className="px-3 py-3 whitespace-nowrap">
                {a.due_at ? (
                  <span className="flex items-center gap-2">
                    {formatWhen(a.due_at, timeZone)}
                    {Date.parse(a.due_at) < now ? <Badge tone="bad">Past due</Badge> : null}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-3">v{a.template_version}</td>
              <td className="px-3 py-3 whitespace-nowrap">{formatWhen(a.created_at, timeZone)}</td>
              {isAdmin ? (
                <td className="px-3 py-3">
                  <ActionButton
                    action={deleteFormAssignment}
                    fields={{ id: a.id }}
                    label="Remove"
                    confirm="Remove this assignment? Forms already started are kept."
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      )}
      <p className="text-sm">
        <Link
          href={`/forms/submissions?form=${templateId}&status=all`}
          className="text-muted hover:underline"
        >
          See this form’s submissions →
        </Link>
      </p>
    </div>
  );
}
