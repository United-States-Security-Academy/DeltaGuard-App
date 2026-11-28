// Upload content checks, shared by the console (before uploading) and the
// verify-upload Edge Function (authoritative, after uploading). Pure
// TypeScript, no imports: runs in browsers, Deno and Node (unit tests:
// supabase/functions/_shared/image-check.test.ts).
//
// Images must be JPEG or PNG and are parsed structure by structure:
//   * the signature matches the file extension;
//   * every JPEG segment / PNG chunk is well formed (lengths in bounds, PNG
//     CRCs correct, the required parts present, in order);
//   * NOTHING follows the end of the image (EOI / IEND): that is where
//     "image + script" polyglots usually hide their payload;
//   * metadata (JPEG APPn / COM segments, PNG text and other ancillary chunks)
//     contains no HTML / script / PHP markers; compressed PNG text (zTXt,
//     compressed iTXt) can't be checked, so it is refused;
//   * the declared pixel size is sane.
// sanitizeImage() then rebuilds an accepted image from its image data only
// (no metadata), so what is stored is a file the server wrote itself.
//
// PDFs: the %PDF- signature and %%EOF trailer, not encrypted, and no active
// content anywhere: JavaScript, launch actions, embedded / attached files,
// rich media, XFA or data import. Object streams (compressed dictionaries, a
// common hiding place) are inflated and checked too, and escaped names
// (/J#61vaScript) are decoded first.

export type FileKind = 'jpeg' | 'png' | 'pdf';
export type CheckResult = { ok: true; kind: FileKind } | { ok: false; reason: string };

const MAX_PIXELS = 100_000_000; // 100 megapixels
const MAX_SIDE = 20_000;

/** Markers of HTML, script, PHP, ASP/JSP or shell content. */
const SCRIPT_MARKERS: RegExp[] = [
  /<\s*script/i,
  /<\s*\/\s*script/i,
  /<\?php/i,
  /<%@\s*page/i,
  /<\s*(html|body|iframe|svg|object|embed|img\s|meta\s|link\s|style|form\s)/i,
  /\bon(error|load|click|mouseover|focus)\s*=/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
  /\beval\s*\(/i,
  /\bdocument\s*\.\s*(cookie|write|location)/i,
  /\bwindow\s*\.\s*location/i,
  /#!\s*\/(usr|bin)\//,
];

/** Bytes as a Latin-1 string (one char per byte) for pattern matching. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

function findScript(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  const text = latin1(bytes);
  for (const re of SCRIPT_MARKERS) {
    if (re.test(text)) return re.source;
  }
  return null;
}

/** Only zero / whitespace padding may follow the end of an image. */
function onlyPadding(bytes: Uint8Array, from: number): boolean {
  for (let i = from; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b !== 0x00 && b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09) return false;
  }
  return true;
}

function sizeOk(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_SIDE &&
    height <= MAX_SIDE &&
    width * height <= MAX_PIXELS
  );
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

function checkJpeg(b: Uint8Array): CheckResult {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return { ok: false, reason: 'not a JPEG' };
  let i = 2;
  let sawFrame = false;
  let sawScan = false;
  const metadata: Uint8Array[] = [];

  while (i < b.length) {
    if (b[i] !== 0xff) return { ok: false, reason: `JPEG: expected a marker at byte ${i}` };
    while (i < b.length && b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) return { ok: false, reason: 'JPEG: truncated' };
    const marker = b[i]!;
    i++;

    if (marker === 0xd9) {
      // EOI: the image ends here.
      if (!sawFrame || !sawScan) return { ok: false, reason: 'JPEG: no image data' };
      if (!onlyPadding(b, i)) return { ok: false, reason: 'JPEG: data after the end of the image' };
      const found = metadata.map(findScript).find((x) => x !== null);
      if (found) return { ok: false, reason: `JPEG: script-like content in metadata (${found})` };
      return { ok: true, kind: 'jpeg' };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (marker === 0xd8 || marker === 0x00) return { ok: false, reason: 'JPEG: unexpected marker' };

    if (i + 2 > b.length) return { ok: false, reason: 'JPEG: truncated segment' };
    const length = (b[i]! << 8) | b[i + 1]!;
    if (length < 2 || i + length > b.length)
      return { ok: false, reason: 'JPEG: bad segment length' };
    const data = b.subarray(i + 2, i + length);

    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      metadata.push(data); // APPn, COM
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      // SOFn: precision, height, width.
      if (data.length < 6) return { ok: false, reason: 'JPEG: bad frame header' };
      const height = (data[1]! << 8) | data[2]!;
      const width = (data[3]! << 8) | data[4]!;
      if (!sizeOk(width, height)) return { ok: false, reason: 'JPEG: impossible image size' };
      sawFrame = true;
    }
    i += length;

    if (marker === 0xda) {
      // SOS: entropy-coded data runs to the next marker that isn't a stuffed
      // byte (FF00), a restart marker (FFD0-D7) or fill (FFFF).
      if (!sawFrame) return { ok: false, reason: 'JPEG: scan before frame' };
      sawScan = true;
      while (i < b.length) {
        if (b[i] === 0xff) {
          const next = b[i + 1];
          if (next === undefined) return { ok: false, reason: 'JPEG: truncated scan' };
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            i += 2;
            continue;
          }
          if (next === 0xff) {
            i += 1;
            continue;
          }
          break;
        }
        i++;
      }
    }
  }
  return { ok: false, reason: 'JPEG: no end-of-image marker' };
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Chunk types a PNG may contain (anything else is refused). */
const PNG_CHUNKS = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCv',
  'cLLi',
  'tEXt',
  'iTXt',
  'bKGD',
  'hIST',
  'pHYs',
  'sPLT',
  'eXIf',
  'tIME',
  'acTL',
  'fcTL',
  'fdAT',
]);

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function checkPng(b: Uint8Array): CheckResult {
  if (b.length < 8 || PNG_SIGNATURE.some((v, k) => b[k] !== v)) {
    return { ok: false, reason: 'not a PNG' };
  }
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8;
  let first = true;
  let sawData = false;
  const metadata: Uint8Array[] = [];

  while (i + 12 <= b.length) {
    const length = view.getUint32(i);
    if (length > 0x7fffffff || i + 12 + length > b.length) {
      return { ok: false, reason: 'PNG: bad chunk length' };
    }
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const data = b.subarray(i + 8, i + 8 + length);
    const crc = view.getUint32(i + 8 + length);
    if (crc32(b.subarray(i + 4, i + 8 + length)) !== crc) {
      return { ok: false, reason: `PNG: corrupt ${type} chunk` };
    }
    if (!PNG_CHUNKS.has(type)) return { ok: false, reason: `PNG: unexpected chunk ${type}` };
    if (first && type !== 'IHDR') return { ok: false, reason: 'PNG: IHDR must come first' };
    first = false;

    if (type === 'IHDR') {
      if (length !== 13) return { ok: false, reason: 'PNG: bad header' };
      if (!sizeOk(view.getUint32(i + 8), view.getUint32(i + 12))) {
        return { ok: false, reason: 'PNG: impossible image size' };
      }
    } else if (type === 'IDAT' || type === 'fdAT') {
      sawData = true;
    } else if (type === 'iCCP') {
      // A compressed colour profile: binary, not text; skipped by the scan.
    } else if (type === 'iTXt' && data.includes(0)) {
      // keyword \0 compression-flag ...: compressed text can't be checked.
      const flag = data[data.indexOf(0) + 1];
      if (flag !== 0) return { ok: false, reason: 'PNG: compressed text chunk' };
      metadata.push(data);
    } else if (type === 'IEND') {
      if (!sawData) return { ok: false, reason: 'PNG: no image data' };
      if (!onlyPadding(b, i + 12 + length)) {
        return { ok: false, reason: 'PNG: data after the end of the image' };
      }
      const found = metadata.map(findScript).find((x) => x !== null);
      if (found) return { ok: false, reason: `PNG: script-like content in metadata (${found})` };
      return { ok: true, kind: 'png' };
    } else {
      metadata.push(data);
    }
    i += 12 + length;
  }
  return { ok: false, reason: 'PNG: no IEND chunk' };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** PDF names that run code, open other files or carry hidden ones. */
const ACTIVE_PDF_NAMES =
  /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|ImportData|GoToE|XFA)(?![A-Za-z0-9])/;
/** Most inflated bytes looked at, in total (a zip bomb stops here). */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/** /J#61vaScript -> /JavaScript (PDF name escapes). */
function decodeNames(text: string): string {
  return text.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

// Web stream APIs (browsers, Deno, Node 18+), typed here so this package
// needs no DOM type library.
interface ByteReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}
interface ByteStream {
  getReader(): ByteReader;
  pipeThrough(transform: unknown): ByteStream;
}
const web = globalThis as unknown as {
  Blob: new (parts: Uint8Array[]) => { stream(): ByteStream };
  DecompressionStream: new (format: 'deflate') => unknown;
};

/** zlib-inflates a stream, giving up past `limit` bytes. Null if it isn't valid zlib. */
async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array | null> {
  try {
    const reader = new web.Blob([bytes])
      .stream()
      .pipeThrough(new web.DecompressionStream('deflate'))
      .getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
    return concatBytes(parts);
  } catch {
    return null;
  }
}

async function checkPdf(b: Uint8Array): Promise<CheckResult> {
  const text = latin1(b);
  if (!text.startsWith('%PDF-')) return { ok: false, reason: 'not a PDF' };
  if (!text.slice(Math.max(0, text.length - 1024)).includes('%%EOF')) {
    return { ok: false, reason: 'PDF: no end-of-file marker' };
  }

  // Dictionaries outside streams, and object streams (inflated).
  let outside = '';
  let from = 0;
  let budget = MAX_INFLATED_BYTES;
  const streamStart = /\bstream(\r\n|\n|\r)/g;
  let m: RegExpExecArray | null;
  while ((m = streamStart.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) return { ok: false, reason: 'PDF: unterminated stream' };
    const head = decodeNames(text.slice(Math.max(from, text.lastIndexOf('obj', m.index)), m.index));
    outside += text.slice(from, m.index);
    if (/\/Type\s*\/ObjStm/.test(head)) {
      if (!/\/FlateDecode/.test(head) || /\/DecodeParms/.test(head)) {
        return { ok: false, reason: 'PDF: object stream that can’t be checked' };
      }
      let raw = b.subarray(start, end);
      while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) {
        raw = raw.subarray(0, raw.length - 1);
      }
      const inflated = await inflate(raw, budget);
      if (!inflated) return { ok: false, reason: 'PDF: object stream that can’t be checked' };
      budget -= inflated.length;
      const found = decodeNames(latin1(inflated)).match(ACTIVE_PDF_NAMES);
      if (found) return { ok: false, reason: `PDF: contains ${found[1]}` };
    }
    from = end + 'endstream'.length;
    streamStart.lastIndex = from;
  }
  outside = decodeNames(outside + text.slice(from));
  if (/\/Encrypt\b/.test(outside)) return { ok: false, reason: 'PDF: encrypted' };
  const found = outside.match(ACTIVE_PDF_NAMES);
  if (found) return { ok: false, reason: `PDF: contains ${found[1]}` };
  return { ok: true, kind: 'pdf' };
}

// ---------------------------------------------------------------------------
// Rebuilding accepted images
// ---------------------------------------------------------------------------

/** JPEG segments kept before the first scan: tables, frame, and colour info. */
function keepJpegSegment(marker: number, data: Uint8Array): boolean {
  // DQT, DHT, DRI, DAC
  if (marker === 0xdb || marker === 0xc4 || marker === 0xdd || marker === 0xcc) return true;
  if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) return true; // SOFn
  const tag = latin1(data.subarray(0, 12));
  if (marker === 0xe0) return tag.startsWith('JFIF\0'); // JFIF header
  if (marker === 0xee) return tag.startsWith('Adobe'); // colour transform
  if (marker === 0xe2) return tag.startsWith('ICC_PROFILE\0'); // colour profile
  return false; // EXIF, XMP, comments, everything else
}

function rebuildJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    while (b[i] === 0xff && b[i + 1] === 0xff) i++;
    const marker = b[i + 1]!;
    if (marker === 0xda) {
      // First scan: the image data and everything after it up to EOI,
      // verbatim (checkJpeg has vetted it); trailing padding is dropped.
      let end = b.length;
      while (end - 2 > i && !(b[end - 2] === 0xff && b[end - 1] === 0xd9)) end--;
      out.push(b.subarray(i, end));
      break;
    }
    const length = (b[i + 2]! << 8) | b[i + 3]!;
    if (keepJpegSegment(marker, b.subarray(i + 4, i + 2 + length))) {
      out.push(b.subarray(i, i + 2 + length));
    }
    i += 2 + length;
  }
  return concatBytes(out);
}

/** PNG chunks kept: image data, palette, transparency and colour info. */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'pHYs',
  'IDAT',
  'IEND',
]);

function rebuildPng(b: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, i + 12 + length));
    i += 12 + length;
    if (type === 'IEND') break;
  }
  return concatBytes(out);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/**
 * An accepted JPEG / PNG rebuilt from its image data only: metadata (EXIF,
 * XMP, comments, text chunks, unknown segments) and any padding are dropped.
 * Pixels are untouched. Only call after checkFile() accepted the file.
 */
export function sanitizeImage(kind: 'jpeg' | 'png', bytes: Uint8Array): Uint8Array {
  return kind === 'jpeg' ? rebuildJpeg(bytes) : rebuildPng(bytes);
}

// ---------------------------------------------------------------------------

/** The kind a file name promises, from its extension. */
export function kindFromName(name: string): FileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'png') return 'png';
  if (ext === 'pdf') return 'pdf';
  return null;
}

/** Checks a file against the kind its name promises. */
export async function checkFile(name: string, bytes: Uint8Array): Promise<CheckResult> {
  const kind = kindFromName(name);
  if (kind === 'jpeg') return checkJpeg(bytes);
  if (kind === 'png') return checkPng(bytes);
  if (kind === 'pdf') return checkPdf(bytes);
  return { ok: false, reason: 'file type not allowed' };
}
