// Minimaler XLSX/XLSM-Leser ohne Abhängigkeiten (aus Kässeli): liest Zellwerte (inkl. zwischengespeicherter
// Formelergebnisse) und Formeln aus allen Tabellenblättern.
import fs from 'node:fs';
import zlib from 'node:zlib';

function unzip(buf) {
  // Ende des zentralen Verzeichnisses suchen
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige XLSX/ZIP-Datei');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d)).replace(/&amp;/g, '&');

function colToNum(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Liefert { sheetName: { cells, value(ref), formula(ref), isFormula(ref), maxRow } } – file: Pfad oder Buffer */
export function readXlsx(file) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  const files = unzip(buf);
  const text = (n) => (files[n] ? files[n].toString('utf8') : '');

  const shared = [];
  for (const si of text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(unescape([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
  }

  const rels = {};
  for (const r of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = r[0].match(/Id="([^"]+)"/)?.[1];
    const target = r[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) rels[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  }

  const sheets = {};
  for (const s of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(s[0].match(/name="([^"]+)"/)[1]);
    const rid = s[0].match(/r:id="([^"]+)"/)[1];
    const xml = text('xl/' + rels[rid]);
    const cells = {};
    for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, row, attrs, inner = ''] = c;
      const t = attrs.match(/t="([^"]+)"/)?.[1];
      const f = inner.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1];
      const hasF = /<f[\s>\/]/.test(inner);
      const vRaw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const isText = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      let v = null;
      if (t === 's' && vRaw !== undefined) v = shared[Number(vRaw)];
      else if (t === 'inlineStr') v = unescape(isText ?? '');
      else if (t === 'str') v = vRaw !== undefined ? unescape(vRaw) : null;
      else if (t === 'b') v = vRaw === '1';
      else if (vRaw !== undefined) v = Number(vRaw);
      cells[col + row] = { v, f: f ? unescape(f) : null, hasF, row: Number(row), col: colToNum(col) };
    }
    sheets[name] = {
      cells,
      value: (ref) => cells[ref]?.v ?? null,
      formula: (ref) => cells[ref]?.f ?? null,
      isFormula: (ref) => !!cells[ref]?.hasF,
      maxRow: Math.max(0, ...Object.values(cells).map((c) => c.row)),
    };
  }
  return sheets;
}

export const colName = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/** Excel-Seriennummer → 'YYYY-MM-DD' */
export function excelDate(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
}
