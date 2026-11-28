// Unit tests for the upload checks (packages/shared/src/file-check.ts).
// Run with Node 22+ (no Deno needed):
//   node --test supabase/functions/_shared/image-check.test.ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { checkFile, sanitizeImage } from './image-check.ts';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const jpeg = new Uint8Array(readFileSync(join(here, 'testdata/photo.jpg')));
const png = new Uint8Array(readFileSync(join(here, 'testdata/photo.png')));
const ascii = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
const ok = async (name: string, bytes: Uint8Array) => (await checkFile(name, bytes)).ok;
const has = (bytes: Uint8Array, s: string) => Buffer.from(bytes).includes(Buffer.from(s, 'latin1'));

/** A JPEG with an extra segment (marker + data) right after SOI. */
function jpegWithSegment(marker: number, text: string): Uint8Array {
  const data = ascii(text);
  const len = data.length + 2;
  return concat(
    jpeg.subarray(0, 2),
    new Uint8Array([0xff, marker, len >> 8, len & 0xff]),
    data,
    jpeg.subarray(2),
  );
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG with an extra chunk right after IHDR (8 + 25 bytes). */
function pngWithChunk(type: string, data: Uint8Array, badCrc = false): Uint8Array {
  const head = new Uint8Array(8 + data.length);
  const view = new DataView(head.buffer);
  view.setUint32(0, data.length);
  head.set(ascii(type), 4);
  head.set(data, 8);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(head.subarray(4)) ^ (badCrc ? 1 : 0));
  return concat(png.subarray(0, 33), head, crc, png.subarray(33));
}

/** A small PDF; `extra` goes into the catalog dictionary; `objStm` adds a compressed object stream. */
function pdf(extra = '', objStm?: string): Uint8Array {
  const parts: Uint8Array[] = [
    ascii('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ' + extra + ' >>\nendobj\n'),
    ascii('2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n'),
  ];
  if (objStm !== undefined) {
    const data = deflateSync(Buffer.from(objStm, 'latin1'));
    parts.push(
      ascii(
        `3 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
      ),
      new Uint8Array(data),
      ascii('\nendstream\nendobj\n'),
    );
  }
  // An image stream whose (binary) data happens to contain "/JS": not a name.
  parts.push(
    ascii('4 0 obj\n<< /Type /XObject /Subtype /Image /Length 12 >>\nstream\n'),
    ascii('ab/JS cd/JSx'),
    ascii('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  );
  return concat(...parts);
}

test('real photos pass', async () => {
  assert.deepEqual(await checkFile('a/b/photo.jpg', jpeg), { ok: true, kind: 'jpeg' });
  assert.deepEqual(await checkFile('a/b/photo.JPEG', jpeg), { ok: true, kind: 'jpeg' });
  assert.deepEqual(await checkFile('a/b/page-1.png', png), { ok: true, kind: 'png' });
});

test('every PNG / JPEG shipped with the apps passes', async () => {
  const root = join(here, '../../..');
  let checked = 0;
  for (const dir of ['apps/admin/public', 'apps/mobile/assets/images']) {
    for (const f of readdirSync(join(root, dir))) {
      if (!/\.(png|jpe?g)$/i.test(f)) continue;
      const result = await checkFile(f, new Uint8Array(readFileSync(join(root, dir, f))));
      assert.equal(result.ok, true, `${dir}/${f}: ${JSON.stringify(result)}`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test('the name must match the content', async () => {
  assert.equal(await ok('x.png', jpeg), false);
  assert.equal(await ok('x.jpg', png), false);
  assert.equal(await ok('x.pdf', jpeg), false);
  assert.equal(await ok('x.svg', ascii('<svg onload="alert(1)"/>')), false);
  assert.equal(await ok('x.html', jpeg), false);
  assert.equal(await ok('x.jpg', ascii('<script>alert(1)</script>')), false);
});

test('anything after the end of the image is refused', async () => {
  assert.equal(await ok('x.jpg', concat(jpeg, ascii('<script>alert(1)</script>'))), false);
  assert.equal(await ok('x.jpg', concat(jpeg, ascii('PK\u0003\u0004zip'))), false);
  assert.equal(await ok('x.png', concat(png, ascii('<?php system($_GET[c]); ?>'))), false);
  // Zero padding some encoders add is fine.
  assert.equal(await ok('x.jpg', concat(jpeg, new Uint8Array(16))), true);
});

test('script hidden in JPEG metadata is refused', async () => {
  assert.equal(await ok('x.jpg', jpegWithSegment(0xfe, '<script>fetch("//evil")</script>')), false);
  assert.equal(
    await ok('x.jpg', jpegWithSegment(0xe1, 'Exif\0\0<?php eval($_POST[x]); ?>')),
    false,
  );
  assert.equal(await ok('x.jpg', jpegWithSegment(0xed, '<img src=x onerror=alert(1)>')), false);
  assert.equal(await ok('x.jpg', jpegWithSegment(0xfe, 'Taken at gate 3, all quiet')), true);
});

test('script hidden in PNG chunks is refused', async () => {
  assert.equal(
    await ok('x.png', pngWithChunk('tEXt', ascii('Comment\0<script>alert(1)</script>'))),
    false,
  );
  assert.equal(
    await ok('x.png', pngWithChunk('iTXt', ascii('XML\0\0\0\0<html><body onload=x>'))),
    false,
  );
  assert.equal(await ok('x.png', pngWithChunk('zTXt', ascii('Comment\0\0xxxx'))), false);
  assert.equal(await ok('x.png', pngWithChunk('evIl', ascii('payload'))), false);
  assert.equal(await ok('x.png', pngWithChunk('tEXt', ascii('Software\0DeltaGuard'))), true);
});

test('broken structure is refused', async () => {
  assert.equal(await ok('x.png', pngWithChunk('tEXt', ascii('a\0b'), true)), false);
  assert.equal(await ok('x.jpg', jpeg.subarray(0, jpeg.length - 2)), false);
  assert.equal(await ok('x.png', png.subarray(0, png.length - 12)), false);
  assert.equal(await ok('x.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), false);
  assert.equal(await ok('x.jpg', new Uint8Array()), false);
});

test('PDFs: signature and trailer', async () => {
  assert.equal(await ok('a.pdf', pdf()), true);
  assert.equal(await ok('a.pdf', ascii('<html>%PDF-1.7 %%EOF')), false);
  assert.equal(await ok('a.pdf', ascii('%PDF-1.7 no trailer')), false);
});

test('PDFs with JavaScript, launch actions or embedded files are refused', async () => {
  assert.equal(
    await ok('a.pdf', pdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>')),
    false,
  );
  assert.equal(await ok('a.pdf', pdf('/OpenAction << /S /Launch /F (cmd.exe) >>')), false);
  assert.equal(await ok('a.pdf', pdf('/Names << /EmbeddedFiles 5 0 R >>')), false);
  assert.equal(await ok('a.pdf', pdf('/AcroForm << /XFA 6 0 R >>')), false);
  assert.equal(await ok('a.pdf', pdf('/AA << /O << /S /RichMedia >> >>')), false);
  // Escaped names: /J#61vaScript is /JavaScript.
  assert.equal(await ok('a.pdf', pdf('/OpenAction << /S /J#61vaScript /J#53 (x) >>')), false);
  // Hidden inside a compressed object stream.
  assert.equal(await ok('a.pdf', pdf('', '5 0 << /S /JavaScript /JS (app.alert(1)) >>')), false);
  assert.equal(
    await ok('a.pdf', pdf('', '5 0 << /Type /Filespec /EF << /F 6 0 R >> /EmbeddedFile 1 >>')),
    false,
  );
  // Encrypted PDFs can't be inspected.
  assert.equal(
    await ok(
      'a.pdf',
      concat(pdf().subarray(0, -6), ascii('trailer << /Encrypt 9 0 R >>\n%%EOF\n')),
    ),
    false,
  );
  // A clean object stream and a binary image containing "/JS" bytes are fine.
  assert.equal(
    await ok('a.pdf', pdf('', '5 0 << /Type /Annot /Subtype /Widget /T (Name) >>')),
    true,
  );
  assert.equal(await ok('a.pdf', pdf('/OpenAction [2 0 R /Fit]')), true);
});

test('sanitizeImage rebuilds images without metadata, and they still pass', async () => {
  const tagged = jpegWithSegment(0xfe, 'Taken at gate 3');
  assert.ok(has(jpeg, 'Exif') && has(tagged, 'Taken at gate 3'));
  const cleanJpeg = sanitizeImage('jpeg', tagged);
  assert.equal(has(cleanJpeg, 'Exif'), false, 'EXIF removed');
  assert.equal(has(cleanJpeg, 'Taken at gate 3'), false, 'comment removed');
  assert.equal(has(cleanJpeg, 'ICC_PROFILE'), true, 'colour profile kept');
  assert.equal(await ok('x.jpg', cleanJpeg), true);
  assert.deepEqual(cleanJpeg.subarray(-2), new Uint8Array([0xff, 0xd9]));

  const textPng = pngWithChunk('tEXt', ascii('Software\0DeltaGuard'));
  const cleanPng = sanitizeImage('png', textPng);
  assert.equal(has(cleanPng, 'tEXt'), false, 'text chunk removed');
  assert.equal(await ok('x.png', cleanPng), true);
});
