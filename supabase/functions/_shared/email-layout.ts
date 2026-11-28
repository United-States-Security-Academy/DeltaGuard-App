// Deltacon-branded email layout (ink #050E1D, navy #10213A, gold #D6B562).
// Plain tables + inline styles: email clients ignore <style> blocks and CSS layout.

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type LayoutOptions = {
  /** Shown in the inbox preview line; plain text. */
  preheader: string;
  heading: string;
  /** Paragraphs of plain text (escaped here). */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** A one-time code shown large instead of (or as well as) a button. */
  code?: string;
  /** Small print under the button; plain text. */
  footnote?: string;
};

export function renderEmail(o: LayoutOptions): { html: string; text: string } {
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#E6EAF0;">${escapeHtml(t)}</p>`;

  const button = o.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
<td style="border-radius:8px;background:#D6B562;">
<a href="${escapeHtml(o.button.url)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#050E1D;text-decoration:none;border-radius:8px;">${escapeHtml(o.button.label)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:12px;line-height:18px;color:#8C97A8;">If the button doesn't work, copy this link into your browser:<br>
<a href="${escapeHtml(o.button.url)}" style="color:#D6B562;word-break:break-all;">${escapeHtml(o.button.url)}</a></p>`
    : '';

  const code = o.code
    ? `<p style="margin:8px 0 24px;font-size:28px;letter-spacing:6px;font-weight:700;color:#D6B562;font-family:Menlo,Consolas,monospace;">${escapeHtml(o.code)}</p>`
    : '';

  const footnote = o.footnote
    ? `<p style="margin:0;font-size:12px;line-height:18px;color:#8C97A8;">${escapeHtml(o.footnote)}</p>`
    : '';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#050E1D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050E1D;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 4px 16px;font-size:13px;font-weight:700;letter-spacing:2px;color:#D6B562;">DELTAGUARD</td></tr>
<tr><td style="background:#10213A;border-radius:12px;border-top:3px solid #D6B562;padding:28px 24px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:#FFFFFF;">${escapeHtml(o.heading)}</h1>
${o.paragraphs.map(p).join('\n')}
${button}${code}${footnote}
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:11px;line-height:16px;color:#5F6B7D;">Deltacon Security · internal system. If you weren't expecting this email, you can ignore it.</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    o.heading,
    '',
    ...o.paragraphs.flatMap((t) => [t, '']),
    ...(o.button ? [`${o.button.label}: ${o.button.url}`, ''] : []),
    ...(o.code ? [o.code, ''] : []),
    ...(o.footnote ? [o.footnote, ''] : []),
    '— DeltaGuard',
  ].join('\n');

  return { html, text };
}
