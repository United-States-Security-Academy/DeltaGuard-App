'use client';

import {
  FORM_FIELD_TYPE_LABELS,
  FORM_FIELD_TYPES,
  type FormFieldInput,
  type FormFieldType,
  fieldKeyFrom,
  formValueProblems,
  formValuesSchema,
} from '@deltaguard/shared';
import {
  type PointerEvent as ReactPointerEvent,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import { Button, FormMessage } from '@/components/ui';

import { publishFormTemplate, saveFormFields } from '../actions';

type EditorField = FormFieldInput & { uid: string };
type Drag =
  | { kind: 'create'; page: number; x0: number; y0: number; rect: DOMRect }
  | { kind: 'move'; uid: string; dx: number; dy: number; rect: DOMRect }
  | { kind: 'resize'; uid: string; rect: DOMRect };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 10000) / 10000;
const MIN_W = 0.01;
const MIN_H = 0.008;

function withoutUid(field: EditorField): FormFieldInput {
  const { uid, ...rest } = field;
  void uid;
  return rest;
}

function withUids(fields: FormFieldInput[]): EditorField[] {
  return fields.map((f) => ({ ...f, uid: crypto.randomUUID() }));
}

export function FieldEditor({
  templateId,
  pageUrls,
  initialFields,
  readOnly,
  canPublish,
  publishedVersion,
}: {
  templateId: string;
  pageUrls: (string | null)[];
  initialFields: FormFieldInput[];
  readOnly: boolean;
  canPublish: boolean;
  publishedVersion: number;
}) {
  const [fields, setFields] = useState<EditorField[]>(() => withUids(initialFields));
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [ghost, setGhost] = useState<{
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [saveState, setSaveState] = useState<{ ok: boolean; message: string } | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const [publishState, publishAction, publishing] = useActionState(publishFormTemplate, null);
  const autoKey = useRef(new Set<string>());
  const drag = useRef<Drag | null>(null);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function change(next: EditorField[]) {
    setFields(next);
    setDirty(true);
    setSaveState(null);
  }

  function update(uid: string, patch: Partial<EditorField>) {
    change(fields.map((f) => (f.uid === uid ? { ...f, ...patch } : f)));
  }

  function addField(page: number, x: number, y: number, w: number, h: number) {
    const taken = new Set(fields.map((f) => f.key));
    const label = `Field ${fields.length + 1}`;
    const field: EditorField = {
      uid: crypto.randomUUID(),
      key: fieldKeyFrom(label, taken),
      label,
      type: 'text',
      options: null,
      required: false,
      page,
      x: round(x),
      y: round(y),
      width: round(w),
      height: round(h),
      font_size: 10,
      sort_order: fields.length,
      acroform_name: null,
    };
    autoKey.current.add(field.uid);
    change([...fields, field]);
    setSelected(field.uid);
  }

  function remove(uid: string) {
    change(fields.filter((f) => f.uid !== uid));
    if (selected === uid) setSelected(null);
  }

  function move(uid: string, by: -1 | 1) {
    const i = fields.findIndex((f) => f.uid === uid);
    const j = i + by;
    if (i < 0 || j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j]!, next[i]!];
    change(next);
  }

  function sortByPosition() {
    change([...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x));
  }

  // --- Pointer handling (fractions of the page, from the top-left) ---------

  const point = (e: ReactPointerEvent, rect: DOMRect) => ({
    x: clamp01((e.clientX - rect.left) / rect.width),
    y: clamp01((e.clientY - rect.top) / rect.height),
  });

  function onPagePointerDown(e: ReactPointerEvent<HTMLDivElement>, page: number) {
    if (readOnly || e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!drag.current) {
      const p = point(e, rect);
      drag.current = { kind: 'create', page, x0: p.x, y0: p.y, rect };
      setGhost({ page, x: p.x, y: p.y, w: 0, h: 0 });
      setSelected(null);
    } else {
      drag.current = { ...drag.current, rect };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPagePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const p = point(e, d.rect);
    if (d.kind === 'create') {
      setGhost({
        page: d.page,
        x: Math.min(d.x0, p.x),
        y: Math.min(d.y0, p.y),
        w: Math.abs(p.x - d.x0),
        h: Math.abs(p.y - d.y0),
      });
    } else if (d.kind === 'move') {
      setFields((list) =>
        list.map((f) =>
          f.uid === d.uid
            ? {
                ...f,
                x: round(clamp01(Math.min(p.x - d.dx, 1 - f.width))),
                y: round(clamp01(Math.min(p.y - d.dy, 1 - f.height))),
              }
            : f,
        ),
      );
      setDirty(true);
    } else {
      setFields((list) =>
        list.map((f) =>
          f.uid === d.uid
            ? {
                ...f,
                width: round(Math.max(MIN_W, Math.min(p.x - f.x, 1 - f.x))),
                height: round(Math.max(MIN_H, Math.min(p.y - f.y, 1 - f.y))),
              }
            : f,
        ),
      );
      setDirty(true);
    }
  }

  function onPagePointerUp() {
    const d = drag.current;
    drag.current = null;
    // A drag draws a field; a plain click only clears the selection.
    if (d?.kind === 'create' && ghost && (ghost.w >= MIN_W || ghost.h >= MIN_H)) {
      const w = Math.max(ghost.w, MIN_W);
      const h = Math.max(ghost.h, MIN_H);
      addField(ghost.page, Math.min(ghost.x, 1 - w), Math.min(ghost.y, 1 - h), w, h);
    }
    setGhost(null);
    setSaveState(null);
  }

  function startMove(e: ReactPointerEvent, f: EditorField) {
    if (readOnly || e.button !== 0) return;
    setSelected(f.uid);
    const page = (e.currentTarget as HTMLElement).closest('[data-page]') as HTMLElement;
    const rect = page.getBoundingClientRect();
    const p = point(e, rect);
    drag.current = { kind: 'move', uid: f.uid, dx: p.x - f.x, dy: p.y - f.y, rect };
  }

  function startResize(e: ReactPointerEvent, f: EditorField) {
    if (readOnly || e.button !== 0) return;
    setSelected(f.uid);
    const page = (e.currentTarget as HTMLElement).closest('[data-page]') as HTMLElement;
    drag.current = { kind: 'resize', uid: f.uid, rect: page.getBoundingClientRect() };
  }

  // --- Save -----------------------------------------------------------------

  function save() {
    const payload = fields.map((f, i) => ({ ...withoutUid(f), sort_order: i }));
    startSaving(async () => {
      const result = await saveFormFields(templateId, payload);
      setSaveState(result);
      const byUid: Record<string, string> = {};
      for (const [index, message] of Object.entries(result.problems ?? {})) {
        const f = fields[Number(index)];
        if (f) byUid[f.uid] = message;
      }
      setProblems(byUid);
      if (result.ok) setDirty(false);
    });
  }

  const current = fields.find((f) => f.uid === selected) ?? null;
  const pageCount = pageUrls.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line bg-surface p-0.5 text-sm">
          {(['edit', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 font-medium ${mode === m ? 'bg-ink text-white dark:bg-gold dark:text-ink' : 'text-muted'}`}
            >
              {m === 'edit' ? (readOnly ? 'Fields' : 'Edit fields') : 'Officer preview'}
            </button>
          ))}
        </div>
        {!readOnly ? (
          <>
            <Button type="button" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : dirty ? 'Save fields' : 'Saved'}
            </Button>
            <form action={publishAction}>
              <input type="hidden" name="id" value={templateId} />
              <Button
                type="submit"
                variant="secondary"
                disabled={!canPublish || dirty || publishing || fields.length === 0}
                title={dirty ? 'Save your changes first' : undefined}
                onClick={(e) => {
                  if (
                    !window.confirm(
                      `Publish version ${publishedVersion + 1}? Officers will fill in this version from now on; forms already started or submitted keep their version.`,
                    )
                  )
                    e.preventDefault();
                }}
              >
                {publishing ? 'Publishing…' : `Publish v${publishedVersion + 1}`}
              </Button>
            </form>
            <FormMessage state={saveState} />
            <FormMessage state={publishState} />
          </>
        ) : null}
      </div>

      {mode === 'preview' ? (
        <OfficerPreview fields={fields} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-4">
            {pageCount === 0 ? (
              <p className="rounded-3xl border border-dashed border-line p-8 text-center text-sm text-muted">
                Upload the PDF to place fields.
              </p>
            ) : null}
            {pageUrls.map((url, i) => {
              const page = i + 1;
              return (
                <div key={page} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted">Page {page}</span>
                  <div
                    data-page={page}
                    className={`relative overflow-hidden rounded-lg border border-line bg-white shadow-sm ${readOnly ? '' : 'cursor-crosshair touch-none'}`}
                    onPointerDown={(e) => onPagePointerDown(e, page)}
                    onPointerMove={onPagePointerMove}
                    onPointerUp={onPagePointerUp}
                    onPointerCancel={onPagePointerUp}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
                      <img
                        src={url}
                        alt={`Page ${page}`}
                        draggable={false}
                        className="block w-full select-none"
                      />
                    ) : (
                      <div className="flex aspect-[8.5/11] items-center justify-center text-sm text-slate-500">
                        Page image unavailable
                      </div>
                    )}
                    {fields
                      .filter((f) => f.page === page)
                      .map((f) => (
                        <div
                          key={f.uid}
                          onPointerDown={(e) => startMove(e, f)}
                          className={`absolute flex items-start overflow-hidden rounded-sm border-2 text-[10px] leading-tight ${
                            f.uid === selected
                              ? 'z-10 border-gold bg-gold/25 text-ink'
                              : problems[f.uid]
                                ? 'border-red-500 bg-red-500/15 text-red-900'
                                : 'border-navy/70 bg-navy/10 text-navy'
                          } ${readOnly ? '' : 'cursor-move'}`}
                          style={{
                            left: `${f.x * 100}%`,
                            top: `${f.y * 100}%`,
                            width: `${f.width * 100}%`,
                            height: `${f.height * 100}%`,
                          }}
                          title={`${f.label} (${FORM_FIELD_TYPE_LABELS[f.type]})`}
                        >
                          <span className="truncate px-0.5 font-medium">
                            {f.label}
                            {f.required ? ' *' : ''}
                          </span>
                          {!readOnly && f.uid === selected ? (
                            <span
                              onPointerDown={(e) => startResize(e, f)}
                              className="absolute right-0 bottom-0 size-3 cursor-se-resize bg-gold"
                              aria-label="Resize"
                            />
                          ) : null}
                        </div>
                      ))}
                    {ghost && ghost.page === page ? (
                      <div
                        className="pointer-events-none absolute border-2 border-dashed border-gold bg-gold/10"
                        style={{
                          left: `${ghost.x * 100}%`,
                          top: `${ghost.y * 100}%`,
                          width: `${ghost.w * 100}%`,
                          height: `${ghost.h * 100}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="flex flex-col gap-4 panel p-4 lg:sticky lg:top-4">
            {!readOnly ? (
              <p className="text-xs text-muted">
                Drag on a page to draw a field. Drag a field to move it; drag its gold corner to
                resize. Click a field to edit it.
              </p>
            ) : null}
            {current && !readOnly ? (
              <FieldProperties
                field={current}
                problem={problems[current.uid]}
                pageCount={pageCount}
                onChange={(patch) => {
                  if (patch.key !== undefined) autoKey.current.delete(current.uid);
                  if (patch.label !== undefined && autoKey.current.has(current.uid)) {
                    const taken = new Set(
                      fields.filter((f) => f.uid !== current.uid).map((f) => f.key),
                    );
                    patch = { ...patch, key: fieldKeyFrom(patch.label || 'field', taken) };
                  }
                  update(current.uid, patch);
                }}
                onDelete={() => remove(current.uid)}
              />
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                Fields ({fields.length}){' '}
                <span className="font-normal text-muted">· order on the phone</span>
              </h3>
              {!readOnly && fields.length > 1 ? (
                <button
                  type="button"
                  onClick={sortByPosition}
                  className="text-xs text-muted hover:underline"
                >
                  Sort by position
                </button>
              ) : null}
            </div>
            <ol className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto text-sm">
              {fields.map((f, i) => (
                <li
                  key={f.uid}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${f.uid === selected ? 'bg-gold/20' : 'hover:bg-surface-2'}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(f.uid)}
                    className="flex min-w-0 flex-1 flex-col text-left"
                  >
                    <span className="truncate font-medium">
                      {f.label}
                      {f.required ? <span className="text-red-600"> *</span> : null}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {FORM_FIELD_TYPE_LABELS[f.type]} · page {f.page}
                      {f.page > pageCount ? ' (missing!)' : ''}
                      {f.acroform_name ? ' · PDF field' : ''}
                    </span>
                    {problems[f.uid] ? (
                      <span className="text-xs text-red-600">{problems[f.uid]}</span>
                    ) : null}
                  </button>
                  {!readOnly ? (
                    <span className="flex shrink-0 gap-0.5">
                      <IconButton
                        label="Move up"
                        disabled={i === 0}
                        onClick={() => move(f.uid, -1)}
                      >
                        ↑
                      </IconButton>
                      <IconButton
                        label="Move down"
                        disabled={i === fields.length - 1}
                        onClick={() => move(f.uid, 1)}
                      >
                        ↓
                      </IconButton>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="size-6 rounded-full border border-line text-xs disabled:opacity-30"
      {...props}
    >
      {children}
    </button>
  );
}

const inputClass =
  'rounded-lg border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-gold';

function FieldProperties({
  field,
  problem,
  pageCount,
  onChange,
  onDelete,
}: {
  field: EditorField;
  problem?: string;
  pageCount: number;
  onChange: (patch: Partial<EditorField>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gold/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Selected field</h3>
        <button type="button" onClick={onDelete} className="text-xs text-red-600 hover:underline">
          Delete
        </button>
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Label (what the officer sees)
        <input
          className={inputClass}
          value={field.label}
          maxLength={200}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Type
          <select
            className={inputClass}
            value={field.type}
            onChange={(e) => {
              const type = e.target.value as FormFieldType;
              onChange({
                type,
                options: type === 'select' ? (field.options ?? ['Option 1', 'Option 2']) : null,
              });
            }}
          >
            {FORM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FORM_FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Text size (pt)
          <input
            className={inputClass}
            type="number"
            min={4}
            max={72}
            step={0.5}
            value={field.font_size}
            onChange={(e) => onChange({ font_size: Number(e.target.value) || 10 })}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>
      {field.type === 'select' ? (
        <label className="flex flex-col gap-1 text-xs font-medium">
          Choices (one per line)
          <textarea
            className={`${inputClass} min-h-20`}
            value={(field.options ?? []).join('\n')}
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split('\n')
                  .map((o) => o.trimStart())
                  .slice(0, 100),
              })
            }
            onBlur={() => {
              const options = (field.options ?? []).map((o) => o.trim()).filter(Boolean);
              onChange({ options: options.length ? options : ['Option 1'] });
            }}
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-medium">
        Key (in exports)
        <input
          className={`${inputClass} font-mono`}
          value={field.key}
          maxLength={63}
          onChange={(e) => onChange({ key: e.target.value.toLowerCase() })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Page
        <select
          className={inputClass}
          value={field.page}
          onChange={(e) => onChange({ page: Number(e.target.value) })}
        >
          {Array.from({ length: Math.max(pageCount, field.page) }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      {field.acroform_name ? (
        <p className="text-xs text-muted">
          Filled into the PDF’s own field “{field.acroform_name}”.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => onChange({ acroform_name: null })}
          >
            Draw at this position instead
          </button>
        </p>
      ) : null}
      {problem ? <p className="text-xs text-red-600">{problem}</p> : null}
    </div>
  );
}

/** The form as the phone shows it: one field after another, in order. */
function OfficerPreview({ fields }: { fields: EditorField[] }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [signed, setSigned] = useState(false);
  const [checked, setChecked] = useState<{ ok: boolean; problems: Record<string, string> } | null>(
    null,
  );
  const rules = useMemo(() => fields.map(withoutUid), [fields]);

  function set(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
    setChecked(null);
  }

  function check() {
    const result = formValuesSchema(rules, signed).safeParse(values);
    setChecked(
      result.success
        ? { ok: true, problems: {} }
        : {
            ok: false,
            problems: Object.fromEntries(
              formValueProblems(result.error).map((p) => [p.key, p.message]),
            ),
          },
    );
  }

  const input =
    'w-full rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-gold';

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="w-[360px] max-w-full rounded-[40px] border-8 border-slate-800 bg-ink p-5 text-white shadow-xl">
        <div className="mb-4 text-center text-sm font-extrabold">Form preview</div>
        <div className="flex flex-col gap-4">
          {fields.map((f) => (
            <div key={f.uid} className="flex flex-col gap-1.5">
              {f.type !== 'checkbox' ? (
                <span className="text-[10px] font-bold tracking-[2px] text-white/60 uppercase">
                  {f.label}
                  {f.required ? ' *' : ''}
                </span>
              ) : null}
              {f.type === 'text' ? (
                <input className={input} onChange={(e) => set(f.key, e.target.value)} />
              ) : f.type === 'multiline' ? (
                <textarea
                  className={`${input} min-h-24 rounded-3xl`}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : f.type === 'number' ? (
                <input
                  className={input}
                  type="number"
                  onChange={(e) =>
                    set(f.key, e.target.value === '' ? undefined : Number(e.target.value))
                  }
                />
              ) : f.type === 'date' ? (
                <input className={input} type="date" onChange={(e) => set(f.key, e.target.value)} />
              ) : f.type === 'checkbox' ? (
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-[#D6B562]"
                    onChange={(e) => set(f.key, e.target.checked)}
                  />
                  {f.label}
                  {f.required ? ' *' : ''}
                </label>
              ) : f.type === 'select' ? (
                <select
                  className={input}
                  defaultValue=""
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  <option value="">Choose…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSigned((s) => !s);
                    setChecked(null);
                  }}
                  className="flex h-24 items-center justify-center rounded-3xl border border-dashed border-gold/60 text-sm text-white/70"
                >
                  {signed ? (
                    <span className="font-serif text-2xl text-gold italic">Signed</span>
                  ) : (
                    'Tap to sign'
                  )}
                </button>
              )}
              {checked?.problems[f.key] ? (
                <span className="text-xs text-red-400">{checked.problems[f.key]}</span>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={check}
            className="mt-2 rounded-full bg-gold py-3 text-sm font-bold text-ink"
          >
            Submit
          </button>
          {checked ? (
            <p
              className={`text-center text-sm ${checked.ok ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {checked.ok
                ? 'All answers are valid: the officer could submit.'
                : 'Some answers need fixing.'}
            </p>
          ) : null}
        </div>
      </div>
      <p className="max-w-sm text-sm text-muted">
        This preview uses the fields as they are in the editor (saved or not) and the same answer
        rules the phone and the server use. Nothing is sent.
      </p>
    </div>
  );
}
