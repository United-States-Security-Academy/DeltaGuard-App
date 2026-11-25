import {
  COMPANY_NAME,
  formatTimeRange,
  INCIDENT_PHOTOS_BUCKET,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  incidentCategoryLabel,
  recordIdSchema,
  toZoned,
} from '@deltaguard/shared';
import { NextResponse } from 'next/server';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

import { getStaffSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

import { getTimeZone } from '../../../schedule/data';
import { formatWhen, type LoadedIncident, loadIncident } from '../../data';

/**
 * GET /incidents/<id>/pdf: one incident report as a PDF (details, history,
 * photos). Loaded as the signed-in staff member, so RLS decides access.
 */
export async function GET(_request: Request, { params }: RouteContext<'/incidents/[id]/pdf'>) {
  const staff = await getStaffSession();
  if (!staff) return new NextResponse('Not allowed', { status: 403 });

  const id = recordIdSchema.safeParse(await params);
  if (!id.success) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const incident = await loadIncident(supabase, id.data.id).catch(() => null);
  if (!incident) return new NextResponse('Not found', { status: 404 });
  const timeZone = await getTimeZone(supabase);

  // Photos straight from the private bucket (never through a public link).
  const photos: Uint8Array[] = [];
  for (const p of incident.incident_photos) {
    const { data } = await supabase.storage.from(INCIDENT_PHOTOS_BUCKET).download(p.storage_path);
    if (data) photos.push(new Uint8Array(await data.arrayBuffer()));
  }

  const bytes = await renderPdf(incident, photos, timeZone, staff.email ?? staff.role);
  const day = toZoned(incident.occurred_at, timeZone).date;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="incident-${day}-${incident.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 50;
const CONTENT_WIDTH = PAGE.width - 2 * MARGIN;
const INK = rgb(0.02, 0.055, 0.11); // #050E1D
const MUTED = rgb(0.4, 0.42, 0.47);
const GOLD = rgb(0.84, 0.71, 0.38); // #D6B562

class Writer {
  page: PDFPage;
  y = PAGE.height - MARGIN;
  private canEncode = new Map<string, boolean>();

  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
  }

  /** The standard PDF fonts only cover Western European characters. */
  clean(text: string): string {
    return Array.from(text.replace(/\t/g, '    ').replace(/\r\n?/g, '\n'))
      .map((ch) => {
        if (ch === '\n') return ch;
        let ok = this.canEncode.get(ch);
        if (ok === undefined) {
          try {
            this.font.widthOfTextAtSize(ch, 10);
            ok = true;
          } catch {
            ok = false;
          }
          this.canEncode.set(ch, ok);
        }
        return ok ? ch : '?';
      })
      .join('');
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 20) {
      this.page = this.doc.addPage([PAGE.width, PAGE.height]);
      this.y = PAGE.height - MARGIN;
    }
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of this.clean(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) {
          line = next;
          continue;
        }
        if (line) lines.push(line);
        // A single word longer than the line: cut it.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width) {
          let cut = rest.length;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  }

  text(
    text: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    const lineHeight = size * 1.4;
    for (const line of this.wrap(text, font, size, CONTENT_WIDTH - indent)) {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y,
        size,
        font,
        color: opts.color ?? INK,
      });
    }
  }

  gap(points: number) {
    this.y -= points;
  }

  heading(title: string) {
    this.gap(14);
    this.ensure(40);
    this.text(title, { size: 12, bold: true });
    this.gap(4);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.75,
      color: GOLD,
    });
    this.gap(4);
  }

  field(label: string, value: string) {
    this.ensure(30);
    this.text(label.toUpperCase(), { size: 7.5, color: MUTED });
    this.text(value, { size: 10 });
    this.gap(4);
  }
}

async function renderPdf(
  incident: LoadedIncident,
  photos: Uint8Array[],
  timeZone: string,
  generatedBy: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const title = `Incident report: ${incidentCategoryLabel(incident.category)}`;
  doc.setTitle(title);
  doc.setAuthor(COMPANY_NAME);
  doc.setCreator('Deltacon Guard');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  const when = (iso: string) => formatWhen(iso, timeZone);

  w.text(COMPANY_NAME.toUpperCase(), { size: 8, bold: true, color: GOLD });
  w.text(title, { size: 18, bold: true });
  w.text(
    `${when(incident.occurred_at)} · ${incident.sites?.name ?? 'Unknown site'} · Severity: ${
      INCIDENT_SEVERITY_LABELS[incident.severity]
    } · Status: ${INCIDENT_STATUS_LABELS[incident.status]}`,
    { size: 9.5, color: MUTED },
  );
  w.text(`Reference ${incident.id}`, { size: 8, color: MUTED });

  w.heading('Details');
  w.field(
    'Site',
    [incident.sites?.name, incident.sites?.clients?.name, incident.sites?.address]
      .filter(Boolean)
      .join(' · ') || '-',
  );
  w.field(
    'Reported by',
    `${incident.officer?.full_name ?? 'Unknown'}${incident.officer?.phone ? ` (${incident.officer.phone})` : ''}`,
  );
  w.field(
    'Shift',
    incident.shifts
      ? formatTimeRange(incident.shifts.starts_at, incident.shifts.ends_at, timeZone)
      : 'Not linked to a shift',
  );
  w.field('Occurred', when(incident.occurred_at));
  w.field('Submitted', when(incident.submitted_at));
  w.field('Police called', incident.police_called ? 'Yes' : 'No');
  if (incident.reviewed_at) {
    w.field(
      'Reviewed',
      `${when(incident.reviewed_at)}${incident.reviewer?.full_name ? ` by ${incident.reviewer.full_name}` : ''}`,
    );
  }

  w.heading('What happened');
  w.text(incident.description);

  w.heading('People involved');
  w.text(incident.people_involved ?? 'None recorded.');

  if (incident.review_notes) {
    w.heading('Reviewer notes');
    w.text(incident.review_notes);
  }

  w.heading('History');
  for (const h of incident.history) {
    w.text(
      `${when(h.changed_at)}  ${h.from_status ? INCIDENT_STATUS_LABELS[h.from_status] : 'Filed'} -> ${
        INCIDENT_STATUS_LABELS[h.to_status]
      }${h.profiles?.full_name ? `  (${h.profiles.full_name})` : ''}`,
      { size: 9.5 },
    );
    if (h.notes) w.text(h.notes, { size: 9.5, color: MUTED, indent: 12 });
  }

  if (photos.length > 0) {
    w.heading(`Photos (${photos.length})`);
    for (const [i, bytes] of photos.entries()) {
      let image;
      try {
        image = await doc.embedJpg(bytes);
      } catch {
        w.text(`Photo ${i + 1} could not be included (unsupported format).`, { color: MUTED });
        continue;
      }
      const scale = Math.min(CONTENT_WIDTH / image.width, 330 / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      w.ensure(height + 24);
      w.text(`Photo ${i + 1}`, { size: 8, color: MUTED });
      w.gap(4);
      w.y -= height;
      w.page.drawImage(image, { x: MARGIN, y: w.y, width, height });
      w.gap(10);
    }
  }

  // Footer on every page.
  const generated = when(new Date().toISOString());
  const pages = doc.getPages();
  for (const [i, page] of pages.entries()) {
    page.drawText(
      w.clean(
        `${COMPANY_NAME} · Confidential · Generated ${generated} by ${generatedBy} · Page ${i + 1} of ${pages.length}`,
      ),
      { x: MARGIN, y: MARGIN / 2, size: 7.5, font, color: MUTED },
    );
  }

  return doc.save();
}
