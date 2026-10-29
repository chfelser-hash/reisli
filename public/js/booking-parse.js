// Buchungsbestätigungen lesen: E-Mail (.eml), PDF, HTML oder eingefügter Text → erkannte Felder.
// Läuft im Browser und in Node (Tests). Keine externen Dienste: alles bleibt auf dem Gerät.
// Erkennung über Beschriftungen (deutsch/englisch) statt über ein festes Layout – robust gegenüber
// kleinen Änderungen der Mails. Was nicht sicher erkannt wird, bleibt leer; der Dialog fragt Feld für Feld.

// ---------- Hilfen: Bytes, Zeichensätze ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64ToBytes(s) {
  s = String(s).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (const ch of s) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.slice(0, o);
}
function qpToBytes(s) {
  s = String(s).replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const c = s.charCodeAt(i);
      if (c < 128) out.push(c);
      else for (const b of new TextEncoder().encode(s[i])) out.push(b);
    }
  }
  return new Uint8Array(out);
}
function decodeBytes(bytes, charset = 'utf-8') {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try {
    return new TextDecoder(cs === 'latin1' ? 'iso-8859-1' : cs).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };

/** RFC 2047: =?utf-8?B?...?= / =?iso-8859-1?Q?...?= in Kopfzeilen */
function decodeHeader(v) {
  return String(v || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) =>
    decodeBytes(enc.toUpperCase() === 'B' ? b64ToBytes(txt) : qpToBytes(txt.replace(/_/g, ' ')), cs));
}

// ---------- HTML → Text ----------
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euro: '€', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', ndash: '–', mdash: '—', rarr: '→', middot: '·', bull: '•', thinsp: ' ', ensp: ' ', emsp: ' ' };
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table|section|article)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<a\s[^>]*href="(https?:[^"]+)"[^>]*>/gi, ' [$1] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCodePoint(parseInt(d, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => ENT[e] ?? m)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- E-Mail (MIME) ----------
function splitHead(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  const headRaw = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers = {};
  for (const line of headRaw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body };
}
const param = (h, name) => (String(h || '').match(new RegExp(name + '\\s*=\\s*"?([^";]+)"?', 'i')) || [])[1] || '';

/** Liefert {subject, from, text, html, attachments:[{name,type,bytes}]} */
export function parseEml(raw) {
  const top = splitHead(raw);
  const out = { subject: decodeHeader(top.headers.subject), from: decodeHeader(top.headers.from), date: top.headers.date || '', text: '', html: '', attachments: [] };
  const walk = (headers, body, depth = 0) => {
    const ct = headers['content-type'] || 'text/plain';
    const type = ct.split(';')[0].trim().toLowerCase();
    if (type.startsWith('multipart/') && depth < 8) {
      const b = param(ct, 'boundary');
      if (!b) return;
      for (const part of body.split('--' + b).slice(1)) {
        if (part.startsWith('--')) break;
        const p = splitHead(part.replace(/^\r?\n/, ''));
        walk(p.headers, p.body, depth + 1);
      }
      return;
    }
    if (type === 'message/rfc822' && depth < 8) {
      const p = splitHead(body);
      return walk(p.headers, p.body, depth + 1);
    }
    const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
    const bytes = enc === 'base64' ? b64ToBytes(body) : enc === 'quoted-printable' ? qpToBytes(body) : new TextEncoder().encode(body);
    const disp = headers['content-disposition'] || '';
    const name = decodeHeader(param(disp, 'filename') || param(ct, 'name'));
    if (/attachment/i.test(disp) || (name && !type.startsWith('text/'))) {
      out.attachments.push({ name: name || 'anhang', type, bytes });
    } else if (type === 'text/html') out.html += decodeBytes(bytes, param(ct, 'charset'));
    else if (type === 'text/plain') out.text += decodeBytes(bytes, param(ct, 'charset'));
  };
  walk(top.headers, top.body);
  return out;
}

// ---------- Outlook (.msg, «Compound File») ----------
/** Liest die Datei-Struktur einer .msg (CFB) → Map Pfad → Bytes */
function readCfb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  if (u32(0) !== 0xe011cfd0 || u32(4) !== 0xe11ab1a1) throw new Error('Keine Outlook-Datei');
  const secSize = 1 << u16(0x1e);
  const miniSize = 1 << u16(0x20);
  const cutoff = u32(0x38);
  const off = (n) => (n + 1) * secSize;
  // FAT-Sektoren aus der DIFAT
  const fatSecs = [];
  for (let i = 0; i < 109; i++) { const v = u32(0x4c + i * 4); if (v < 0xfffffffa) fatSecs.push(v); }
  let difat = u32(0x44);
  for (let k = 0; difat < 0xfffffffa && k < 1000; k++) {
    const per = secSize / 4 - 1;
    for (let i = 0; i < per; i++) { const v = u32(off(difat) + i * 4); if (v < 0xfffffffa) fatSecs.push(v); }
    difat = u32(off(difat) + per * 4);
  }
  const fat = [];
  for (const sct of fatSecs) for (let i = 0; i < secSize / 4; i++) fat.push(u32(off(sct) + i * 4));
  const chain = (start, table) => {
    const out = [];
    for (let s2 = start, k = 0; s2 < 0xfffffffa && k < 1e6; k++) { out.push(s2); s2 = table[s2]; }
    return out;
  };
  const readChain = (start, size) => {
    const out = new Uint8Array(size);
    let o = 0;
    for (const sct of chain(start, fat)) {
      const n = Math.min(secSize, size - o);
      if (n <= 0) break;
      out.set(bytes.subarray(off(sct), off(sct) + n), o);
      o += n;
    }
    return out;
  };
  // Verzeichnis
  const dirSecs = chain(u32(0x30), fat);
  const dir = [];
  for (const sct of dirSecs) for (let i = 0; i < secSize / 128; i++) {
    const b = off(sct) + i * 128;
    const len = u16(b + 64);
    let name = '';
    for (let c = 0; c < Math.max(0, len / 2 - 1); c++) name += String.fromCharCode(u16(b + c * 2));
    dir.push({ name, type: bytes[b + 66], left: u32(b + 68), right: u32(b + 72), child: u32(b + 76), start: u32(b + 116), size: u32(b + 120) });
  }
  const root = dir[0];
  const miniStream = readChain(root.start, root.size);
  const miniFat = [];
  for (const sct of chain(u32(0x3c), fat)) for (let i = 0; i < secSize / 4; i++) miniFat.push(u32(off(sct) + i * 4));
  const readMini = (start, size) => {
    const out = new Uint8Array(size);
    let o = 0;
    for (const sct of chain(start, miniFat)) {
      const n = Math.min(miniSize, size - o);
      if (n <= 0) break;
      out.set(miniStream.subarray(sct * miniSize, sct * miniSize + n), o);
      o += n;
    }
    return out;
  };
  const files = new Map();
  const walk = (idx, prefix, depth) => {
    if (idx >= dir.length || idx === 0xffffffff || depth > 50) return;
    const e = dir[idx];
    walk(e.left, prefix, depth + 1);
    walk(e.right, prefix, depth + 1);
    const path = prefix + e.name;
    if (e.type === 2) files.set(path, e.size < cutoff ? readMini(e.start, e.size) : readChain(e.start, e.size));
    else if (e.type === 1) walk(e.child, path + '/', depth + 1);
  };
  walk(root.child, '', 0);
  return files;
}

/** Outlook-Nachricht (.msg) → wie parseEml */
export function parseMsg(bytes) {
  const files = readCfb(bytes);
  const prop = (prefix, id) => {
    const u = files.get(`${prefix}__substg1.0_${id}001F`);
    if (u) return new TextDecoder('utf-16le').decode(u).replace(/\0+$/, '');
    const a = files.get(`${prefix}__substg1.0_${id}001E`);
    if (a) return decodeBytes(a, 'windows-1252').replace(/\0+$/, '');
    return '';
  };
  const out = { subject: prop('', '0037'), from: prop('', '0C1F') || prop('', '0042'), text: prop('', '1000'), html: '', attachments: [] };
  const html = files.get('__substg1.0_10130102');
  if (html) out.html = decodeBytes(html, (latin1(html.slice(0, 2000)).match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8');
  else out.html = prop('', '1013');
  const atts = new Set([...files.keys()].filter((k) => k.startsWith('__attach_version1.0_')).map((k) => k.split('/')[0]));
  for (const a of atts) {
    const data = files.get(`${a}/__substg1.0_37010102`);
    if (!data) continue;
    const name = prop(a + '/', '3707') || prop(a + '/', '3704') || 'anhang';
    out.attachments.push({ name, type: prop(a + '/', '370E') || (/\.pdf$/i.test(name) ? 'application/pdf' : 'application/octet-stream'), bytes: data });
  }
  return out;
}

// ---------- PDF (einfacher Textauszug) ----------
async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Entpacken nicht möglich');
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function pdfString(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[e] ?? String.fromCharCode(parseInt(e, 8))));
}
function ascii85(bytes) {
  const s = latin1(bytes).replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out = [];
  let tuple = [];
  for (const ch of s) {
    if (ch === 'z' && !tuple.length) { out.push(0, 0, 0, 0); continue; }
    tuple.push(ch.charCodeAt(0) - 33);
    if (tuple.length === 5) {
      let v = 0;
      for (const t of tuple) v = v * 85 + t;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      tuple = [];
    }
  }
  if (tuple.length) {
    const n = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let v = 0;
    for (const t of tuple) v = v * 85 + t;
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...b.slice(0, n - 1));
  }
  return new Uint8Array(out);
}
const asciiHex = (bytes) => { const h = latin1(bytes).replace(/[^0-9a-f]/gi, ''); const o = new Uint8Array(h.length >> 1); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };

/**
 * Text aus einem PDF: Seiten mit ihren Schriften (inkl. ToUnicode-Tabellen für eingebettete Schriften,
 * wie sie Chrome/Edge «Als PDF speichern» und viele Buchungsportale erzeugen), Zeilen nach Position sortiert.
 */
export async function pdfToText(bytes) {
  const raw = latin1(bytes);
  // ----- Objekte einlesen (inkl. komprimierter Objekt-Streams) -----
  const objs = new Map();
  const decode = async (dict, data) => {
    const filters = [...((dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [])[1] || '').matchAll(/\/(\w+)/g)].map((x) => x[1]);
    for (const f of filters) {
      if (f === 'FlateDecode' || f === 'Fl') data = await inflate(data);
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHex(data);
      else throw new Error('Filter ' + f);
    }
    return data;
  };
  const head = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = head.exec(raw))) {
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    const endobj = raw.indexOf('endobj', bodyStart);
    if (endobj < 0) break;
    let body = raw.slice(bodyStart, endobj);
    const st = body.match(/>>\s*stream\r?\n/);
    if (st) {
      const dict = body.slice(0, st.index + 2);
      const dataStart = bodyStart + st.index + st[0].length;
      const len = Number((dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/) || [])[1]);
      let dataEnd = Number.isFinite(len) && raw.startsWith('endstream', raw.slice(dataStart + len, dataStart + len + 12).search(/endstream/) + dataStart + len) ? dataStart + len : raw.indexOf('endstream', dataStart);
      if (dataEnd < 0) dataEnd = endobj;
      let data = null;
      try { data = await decode(dict, bytes.subarray(dataStart, dataEnd)); } catch { /* unbekannter Filter */ }
      objs.set(num, { dict, data });
      const after = raw.indexOf('endobj', dataEnd);
      head.lastIndex = after > 0 ? after : endobj;
      if (data && /\/Type\s*\/ObjStm/.test(dict)) {
        const s = latin1(data);
        const first = Number((dict.match(/\/First\s+(\d+)/) || [])[1]);
        const nums = s.slice(0, first).trim().split(/\s+/).map(Number);
        for (let i = 0; i < nums.length; i += 2) {
          const a = first + nums[i + 1];
          const b = i + 3 < nums.length ? first + nums[i + 3] : s.length;
          if (!objs.has(nums[i])) objs.set(nums[i], { dict: s.slice(a, b), data: null });
        }
      }
    } else objs.set(num, { dict: body, data: null });
  }
  const ref = (s) => { const r = String(s || '').match(/^\s*(\d+)\s+\d+\s+R/); return r ? objs.get(Number(r[1])) : null; };
  const valueOf = (dict, key) => {
    const i = dict.search(new RegExp('/' + key + '(?![\\w])'));
    if (i < 0) return null;
    const rest = dict.slice(i + key.length + 1).trimStart();
    if (rest.startsWith('<<')) { // verschachteltes Dictionary
      let depth = 0, k = 0;
      for (; k < rest.length; k++) {
        if (rest.startsWith('<<', k)) { depth++; k++; } else if (rest.startsWith('>>', k)) { depth--; k++; if (!depth) break; }
      }
      return rest.slice(0, k + 1);
    }
    if (rest.startsWith('[')) return rest.slice(0, rest.indexOf(']') + 1);
    const r = rest.match(/^(\d+\s+\d+\s+R|\/\w+|[\d.]+)/);
    return r ? r[1] : null;
  };
  const resolve = (v) => (v && /^\d+\s+\d+\s+R/.test(v) ? ref(v)?.dict || '' : v || '');

  // ----- ToUnicode-Tabellen -----
  const cmapCache = new Map();
  const parseCMap = (data) => {
    const s = latin1(data);
    const map = new Map();
    let width = 1;
    const cs = s.match(/begincodespacerange\s*<([0-9a-f]+)>/i);
    if (cs) width = cs[1].length / 2;
    const u16 = (hex) => { let out = ''; for (let i = 0; i + 3 < hex.length + 0; i += 4) out += String.fromCharCode(parseInt(hex.substr(i, 4), 16)); return out || String.fromCharCode(parseInt(hex, 16)); };
    for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const p of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) map.set(parseInt(p[1], 16), u16(p[2]));
    }
    for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const p of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
        const a = parseInt(p[1], 16), b = parseInt(p[2], 16);
        if (p[4] !== undefined) {
          const base = p[4];
          const start = parseInt(base.slice(-4), 16);
          const prefix = base.length > 4 ? u16(base.slice(0, -4)) : '';
          for (let c = a; c <= b && c - a < 65536; c++) map.set(c, prefix + String.fromCharCode(start + (c - a)));
        } else {
          const list = [...p[5].matchAll(/<([0-9a-f]+)>/gi)].map((x) => u16(x[1]));
          for (let c = a; c <= b; c++) map.set(c, list[c - a] ?? '');
        }
      }
    }
    return { map, width };
  };
  // Zeichenbreiten (für Abstände zwischen Textstücken): /W bei CID-Schriften, /Widths bei einfachen
  const nums = (v) => (resolve(v).match(/[-\d.]+|\[|\]/g) || []);
  const widthsOf = (fontDict) => {
    const desc = valueOf(fontDict, 'DescendantFonts');
    if (desc) {
      const dref = resolve(desc).match(/(\d+)\s+\d+\s+R/);
      const dd = dref ? objs.get(Number(dref[1]))?.dict || '' : resolve(desc);
      const dw = Number(valueOf(dd, 'DW')) || 1000;
      const w = new Map();
      const t = nums(valueOf(dd, 'W'));
      for (let k = 1; k < t.length - 1;) { // erstes Token ist «[»
        const c = Number(t[k]);
        if (t[k + 1] === '[') {
          let j = k + 2, cc = c;
          while (j < t.length && t[j] !== ']') w.set(cc++, Number(t[j++]));
          k = j + 1;
        } else if (t[k] === ']') break;
        else { const c2 = Number(t[k + 1]), ww = Number(t[k + 2]); for (let cc = c; cc <= c2 && cc - c < 65536; cc++) w.set(cc, ww); k += 3; }
      }
      return (code) => w.get(code) ?? dw;
    }
    const first = Number(valueOf(fontDict, 'FirstChar')) || 0;
    const list = nums(valueOf(fontDict, 'Widths')).filter((x) => x !== '[' && x !== ']').map(Number);
    return (code) => list[code - first] ?? 500;
  };
  const fontOf = (fontDict) => {
    if (cmapCache.has(fontDict)) return cmapCache.get(fontDict);
    const tu = valueOf(fontDict, 'ToUnicode');
    const o = tu ? ref(tu) : null;
    const f = o?.data ? parseCMap(o.data) : { map: null, width: /Identity-H|Type0/.test(fontDict) ? 2 : 1 };
    f.w = widthsOf(fontDict);
    cmapCache.set(fontDict, f);
    return f;
  };
  const fontsOf = (resDict) => {
    const out = {};
    const fd = resolve(valueOf(resDict, 'Font'));
    for (const p of fd.matchAll(/\/([\w.+-]+)\s+(\d+)\s+\d+\s+R/g)) out[p[1]] = objs.get(Number(p[2]))?.dict || '';
    return out;
  };
  const xobjectsOf = (resDict) => {
    const out = {};
    const xd = resolve(valueOf(resDict, 'XObject'));
    for (const p of xd.matchAll(/\/([\w.+-]+)\s+(\d+)\s+\d+\s+R/g)) out[p[1]] = objs.get(Number(p[2]));
    return out;
  };

  // ----- Inhalte ausführen: Text mit Position sammeln -----
  const mul = (m1, m2) => [m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3], m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3], m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5]];
  /** → {text, w} mit w = Breite in 1/1000 der Schriftgrösse */
  const decodeStr = (font, bytesStr) => {
    const f = font || { map: null, width: 1, w: () => 500 };
    let out = '', w = 0;
    for (let i = 0; i < bytesStr.length; i += f.width) {
      let code = 0;
      for (let k = 0; k < f.width; k++) code = code * 256 + (bytesStr.charCodeAt(i + k) || 0);
      out += f.map ? f.map.get(code) ?? '' : f.width === 1 ? String.fromCharCode(code) : '';
      w += f.w ? f.w(code) : 500;
    }
    return { text: out, w };
  };
  const runs = [];
  let seq = 0;
  const exec = (content, res, ctm0, depth) => {
    if (depth > 4) return;
    const fonts = fontsOf(res);
    const xobjs = xobjectsOf(res);
    let ctm = ctm0, stack = [], tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, size = 10, leading = 0;
    const ops = [];
    // Text ausgeben und die Textposition um seine Breite weiterschieben
    const emit = (text, w1000) => {
      const adv = (w1000 / 1000) * size;
      const p = mul(tm, ctm);
      if (text) runs.push({ x: p[4], y: p[5], size: Math.abs(size * (p[3] || p[0] || 1)), adv: adv * Math.hypot(p[0], p[1]), text, seq: seq++ });
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    };
    const s = content;
    let i = 0;
    const isWs = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
    const readLiteral = () => {
      let depthP = 1, out = '';
      i++;
      while (i < s.length && depthP > 0) {
        const c = s[i];
        if (c === '\\') {
          const n = s[i + 1];
          const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
          if (map[n] !== undefined) { out += map[n]; i += 2; continue; }
          if (/[0-7]/.test(n)) { const o = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0]; out += String.fromCharCode(parseInt(o, 8)); i += 1 + o.length; continue; }
          if (n === '\r' || n === '\n') { i += n === '\r' && s[i + 2] === '\n' ? 3 : 2; continue; }
          i++;
          continue;
        }
        if (c === '(') depthP++;
        else if (c === ')') { depthP--; if (!depthP) { i++; break; } }
        out += c;
        i++;
      }
      return { str: out };
    };
    const readHex = () => {
      const end = s.indexOf('>', i);
      let h = s.slice(i + 1, end).replace(/\s/g, '');
      if (h.length % 2) h += '0';
      let out = '';
      for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.substr(k, 2), 16));
      i = end + 1;
      return { str: out };
    };
    const stackArr = [];
    let arr = null;
    while (i < s.length) {
      const c = s[i];
      if (isWs(c)) { i++; continue; }
      if (c === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      let tok;
      if (c === '(') tok = readLiteral();
      else if (c === '<' && s[i + 1] !== '<') tok = readHex();
      else if (c === '<' && s[i + 1] === '<') { const e = s.indexOf('>>', i); i = e < 0 ? s.length : e + 2; continue; }
      else if (c === '[') { arr = []; i++; continue; }
      else if (c === ']') { tok = { arr }; arr = null; i++; }
      else {
        let j = i;
        if (c === '/') j++;
        while (j < s.length && !isWs(s[j]) && !'()<>[]{}/%'.includes(s[j])) j++;
        const w = s.slice(i, j || i + 1);
        i = j > i ? j : i + 1;
        tok = /^[-+]?(\d+\.?\d*|\.\d+)$/.test(w) ? { num: Number(w) } : w.startsWith('/') ? { name: w.slice(1) } : { op: w };
      }
      if (arr && !tok.op && tok.arr === undefined) { arr.push(tok); continue; }
      if (!tok.op) { stackArr.push(tok); continue; }
      const a = stackArr.splice(0);
      const n = (k) => a[a.length - k]?.num ?? 0;
      switch (tok.op) {
        case 'q': stack.push(ctm); break;
        case 'Q': ctm = stack.pop() || ctm0; break;
        case 'cm': ctm = mul([n(6), n(5), n(4), n(3), n(2), n(1)], ctm); break;
        case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break;
        case 'Tf': font = fontOf(fonts[a[0]?.name] || ''); size = n(1) || size; break;
        case 'TL': leading = n(1); break;
        case 'Tm': tm = tlm = [n(6), n(5), n(4), n(3), n(2), n(1)]; break;
        case 'Td': tm = tlm = mul([1, 0, 0, 1, n(2), n(1)], tlm); break;
        case 'TD': leading = -n(1); tm = tlm = mul([1, 0, 0, 1, n(2), n(1)], tlm); break;
        case 'T*': tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm); break;
        case 'Tj': { const d = decodeStr(font, a[0]?.str || ''); emit(d.text, d.w); break; }
        case "'": { tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm); const d = decodeStr(font, a[0]?.str || ''); emit(d.text, d.w); break; }
        case '"': { tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm); const d = decodeStr(font, a[2]?.str || ''); emit(d.text, d.w); break; }
        case 'TJ': {
          let t = '', w = 0;
          for (const x of a[0]?.arr || []) {
            if (x.str !== undefined) { const d = decodeStr(font, x.str); t += d.text; w += d.w; }
            else if (x.num !== undefined) { if (x.num < -200) t += ' '; w -= x.num; }
          }
          emit(t, w);
          break;
        }
        case 'Do': {
          const xo = xobjs[a[0]?.name];
          if (xo?.data && /\/Subtype\s*\/Form/.test(xo.dict)) {
            const mat = (valueOf(xo.dict, 'Matrix') || '').match(/[-\d.]+/g)?.map(Number);
            const res2 = resolve(valueOf(xo.dict, 'Resources')) || res;
            exec(latin1(xo.data), res2, mat?.length === 6 ? mul(mat, ctm) : ctm, depth + 1);
          }
          break;
        }
        default: break;
      }
    }
  };

  // Seiten in Dokumentreihenfolge
  const pages = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page(?!s)/.test(o.dict)).sort((a, b) => a[0] - b[0]);
  const pageTexts = [];
  for (const [, page] of pages) {
    runs.length = 0;
    let res = resolve(valueOf(page.dict, 'Resources'));
    if (!res) { // geerbt vom /Pages-Knoten
      const parent = ref(valueOf(page.dict, 'Parent'));
      res = parent ? resolve(valueOf(parent.dict, 'Resources')) : '';
    }
    const cv = valueOf(page.dict, 'Contents') || '';
    const refs = [...cv.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => objs.get(Number(x[1])));
    // Contents als indirektes Array
    if (refs.length === 1 && !refs[0]?.data && /\[/.test(refs[0]?.dict || '')) refs.splice(0, 1, ...[...refs[0].dict.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => objs.get(Number(x[1]))));
    const content = refs.map((o) => (o?.data ? latin1(o.data) : '')).join('\n');
    exec(content, res, [1, 0, 0, 1, 0, 0], 0);
    // Zeilen: gleiche Höhe (± halbe Schriftgrösse) zusammen, von oben nach unten, links nach rechts
    const sorted = [...runs].sort((p, q) => q.y - p.y || p.x - q.x || p.seq - q.seq);
    const lines = [];
    for (const r of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - r.y) <= Math.max(2, Math.min(r.size, last.size) * 0.5)) last.runs.push(r);
      else lines.push({ y: r.y, size: r.size, runs: [r] });
    }
    // Stücke einer Zeile: direkt anhängen, wenn sie aneinanderstossen (Unterschneidung), sonst mit Abstand
    pageTexts.push(lines.map((l) => {
      let out = '', prev = null;
      for (const r of l.runs.sort((p, q) => p.x - q.x || p.seq - q.seq)) {
        if (prev) out += r.x - (prev.x + prev.adv) > Math.min(r.size, prev.size) * 0.2 ? ' ' : '';
        out += r.text;
        prev = r;
      }
      return out.replace(/\s+/g, ' ').trim();
    }).filter(Boolean).join('\n'));
  }
  return pageTexts.join('\n\n').trim();
}

/** Mail (eml/msg) → Quelle: lesbarster Text (Text- oder HTML-Teil) plus Text von PDF-Anhängen */
async function mailToSource(mail, kind) {
  const fromHtml = mail.html ? htmlToText(mail.html) : '';
  let text = mail.text && mail.text.length >= fromHtml.length * 0.5 ? mail.text : fromHtml || mail.text;
  for (const a of mail.attachments) if (/pdf/.test(a.type) || /\.pdf$/i.test(a.name)) {
    const t = await pdfToText(a.bytes).catch(() => '');
    if (t) text += '\n\n' + t;
  }
  return { subject: mail.subject, from: mail.from, text, attachments: mail.attachments, kind };
}

/**
 * Datei oder Text lesen. src: {name, type, bytes} oder {text}.
 * Liefert {subject, from, text, attachments, kind:'eml'|'pdf'|'html'|'text', unreadable?}
 */
export async function readSource(src) {
  if (src.text !== undefined && !src.bytes) return { subject: '', from: '', text: String(src.text), attachments: [], kind: 'text' };
  const name = (src.name || '').toLowerCase();
  const bytes = src.bytes instanceof Uint8Array ? src.bytes : new Uint8Array(src.bytes);
  const head = latin1(bytes.slice(0, 2000));
  if (name.endsWith('.pdf') || head.startsWith('%PDF')) {
    const text = await pdfToText(bytes).catch(() => '');
    return { subject: '', from: '', text, attachments: [], kind: 'pdf', unreadable: text.length < 30 };
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return mailToSource(parseMsg(bytes), 'msg');
  const str = decodeBytes(bytes);
  if (name.endsWith('.eml') || /^(received|from|return-path|delivered-to|mime-version|subject|date|message-id):/im.test(head.split(/\r?\n\r?\n/)[0] || '')) {
    return mailToSource(parseEml(str), 'eml');
  }
  if (name.endsWith('.html') || name.endsWith('.htm') || /<html|<body|<table/i.test(head)) return { subject: '', from: '', text: htmlToText(str), attachments: [], kind: 'html' };
  return { subject: '', from: '', text: str, attachments: [], kind: 'text' };
}

// ---------- Daten, Zeiten, Beträge ----------
const MONTHS = {
  jan: 1, januar: 1, january: 1, jän: 1, jänner: 1, feb: 2, februar: 2, february: 2, mär: 3, mrz: 3, märz: 3, maerz: 3, mar: 3, march: 3,
  apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, dez: 12, dezember: 12, dec: 12, december: 12,
};
const MON_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const pad = (n) => String(n).padStart(2, '0');
const mkDate = (y, m, d) => {
  y = Number(y);
  if (y < 100) y += 2000;
  m = Number(m); d = Number(d);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Alle Daten in einem Text, in Reihenfolge des Auftretens → [{date, index}] */
export function findDates(text, refYear = new Date().getFullYear()) {
  const s = String(text);
  const out = [];
  const add = (date, index) => { if (date && !out.some((x) => x.index === index)) out.push({ date, index }); };
  let m;
  const res = [
    [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (x) => mkDate(x[1], x[2], x[3])],
    [/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/g, (x) => mkDate(x[3], x[2], x[1])],
    [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (x) => mkDate(x[3], x[2], x[1])], // TT/MM/JJJJ (international üblich in Bestätigungen)
    [new RegExp(`\\b(\\d{1,2})\\.?\\s*(${MON_RE})\\.?,?\\s*(\\d{4})\\b`, 'gi'), (x) => mkDate(x[3], MONTHS[x[2].toLowerCase()], x[1])],
    [new RegExp(`\\b(${MON_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), (x) => mkDate(x[3], MONTHS[x[1].toLowerCase()], x[2])],
    [new RegExp(`\\b(\\d{1,2})(${MON_RE})(\\d{2})\\b`, 'gi'), (x) => mkDate(x[3], MONTHS[x[2].toLowerCase()], x[1])], // 12FEB27
  ];
  for (const [re, f] of res) while ((m = re.exec(s))) add(f(m), m.index);
  // ohne Jahr: «12. Feb.» / «Feb 12» / «12FEB» → Bezugsjahr
  const noYear = [
    [new RegExp(`\\b(\\d{1,2})\\.?\\s*(${MON_RE})\\b\\.?(?!\\s*,?\\s*\\d{2,4})`, 'gi'), (x) => mkDate(refYear, MONTHS[x[2].toLowerCase()], x[1])],
  ];
  for (const [re, f] of noYear) while ((m = re.exec(s))) if (!out.some((o) => Math.abs(o.index - m.index) < 4)) add(f(m), m.index);
  return out.sort((a, b) => a.index - b.index);
}
export const firstDate = (text, refYear) => findDates(text, refYear)[0]?.date || '';
/** Uhrzeiten «14:00», «14.00», «2:00 PM» – nicht Teile eines Datums wie «12.02.2027» */
const findTimes = (s) => [...String(s).matchAll(/(?<![\d.:])([01]?\d|2[0-3])[:.h]([0-5]\d)(?![.:\d])(?:\s*([AaPp])\.?[Mm]\.?)?(?!\s*(?:€|CHF|EUR|USD|THB|%))/g)].map((m) => {
  let h = Number(m[1]);
  if (m[3]) {
    const pm = m[3].toLowerCase() === 'p';
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return `${pad(h)}:${m[2]}`;
});

const CUR_SYM = { '€': 'EUR', 'US$': 'USD', '$': 'USD', '£': 'GBP', '฿': 'THB', 'S$': 'SGD', '¥': 'JPY', 'Fr.': 'CHF', 'SFr.': 'CHF', 'sFr.': 'CHF' };
const CUR_CODES = 'CHF|EUR|USD|THB|SGD|JPY|GBP|AUD|NZD|IDR|MYR|PHP|VND|HKD|CNY|INR|LKR|MVR|AED|QAR|TRY|EGP|ZAR|MXN|CAD|DKK|SEK|NOK|CZK|PLN|HUF|KRW|TWD|KES|TZS|MUR|SCR|FJD|XPF|ILS|ISK';
const NUM = "\\d{1,3}(?:[’'.,\\s ]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const MONEY_RE = new RegExp(`(?:(${CUR_CODES}|US\\$|S\\$|SFr\\.|sFr\\.|Fr\\.|[€$£฿¥])\\s?(${NUM}))|(?:(${NUM})\\s?(${CUR_CODES}|[€$£฿¥]))`, 'g');

/** «1.234,56» / «1,234.56» / «1'234.56» / «9 000» → Zahl */
export function parseNumber(s) {
  let x = String(s).replace(/[’'\s ]/g, '');
  const lastDot = x.lastIndexOf('.'), lastComma = x.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) x = x.replace(/\./g, '').replace(',', '.');
    else x = x.replace(/,/g, '');
  } else if (lastComma >= 0) {
    x = /,\d{1,2}$/.test(x) ? x.replace(',', '.') : x.replace(/,/g, '');
  } else if (lastDot >= 0 && /\.\d{3}$/.test(x) && x.split('.').length > 1 && !/\.\d{1,2}$/.test(x)) {
    x = x.replace(/\./g, ''); // 1.234 = Tausender
  }
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}
/** Alle Beträge mit Währung → [{amount, currency, index}] */
export function findMoney(text) {
  const out = [];
  for (const m of String(text).matchAll(MONEY_RE)) {
    const curRaw = m[1] || m[4];
    const amount = parseNumber(m[2] || m[3]);
    if (!Number.isFinite(amount)) continue;
    out.push({ amount: Math.round(amount * 100) / 100, currency: CUR_SYM[curRaw] || curRaw.toUpperCase(), index: m.index });
  }
  return out;
}

// ---------- Beschriftungen ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Wert hinter einer Beschriftung: «Label: Wert» in derselben Zeile, sonst die nächste nicht leere Zeile */
function labelValue(lines, labels, { maxNext = 2, test } = {}) {
  const sorted = [...labels].sort((a, b) => b.length - a.length);
  const re = new RegExp(`^\\s*(?:[•*\\-]\\s*)?(?:${sorted.map(esc).join('|')})\\b\\s*[:：]?\\s*(.*)$`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const same = m[1].replace(/^[:\-–\s]+/, '').trim();
    if (same && (!test || test(same))) return { value: same, line: i };
    for (let k = 1; k <= maxNext && i + k < lines.length; k++) {
      const v = lines[i + k].trim();
      if (!v) continue;
      if (!test || test(v)) return { value: v, line: i + k };
      break;
    }
  }
  return null;
}
const cleanVal = (v) => String(v || '').replace(/\s+/g, ' ').replace(/^[\s:–-]+|[\s.,;–-]+$/g, '').trim();

// ---------- Anbieter ----------
const PROVIDERS = [
  { id: 'booking', name: 'Booking.com', re: /booking\.com/i },
  { id: 'agoda', name: 'Agoda', re: /agoda/i },
  { id: 'hotels', name: 'Hotels.com', re: /hotels\.com/i },
  { id: 'expedia', name: 'Expedia', re: /expedia/i },
  { id: 'trivago', name: 'trivago', re: /trivago/i },
  { id: 'airbnb', name: 'Airbnb', re: /airbnb/i },
  { id: 'trip', name: 'Trip.com', re: /trip\.com/i },
  { id: 'edelweiss', name: 'Edelweiss', re: /edelweiss|flyedelweiss/i, airline: 'WK' },
  { id: 'swiss', name: 'SWISS', re: /\bswiss\.com|swiss international|\bswiss\b.*(flug|flight|buchung|booking)/i, airline: 'LX' },
  { id: 'thai', name: 'Thai Airways', re: /thai\s?airways|thaiairways/i, airline: 'TG' },
  { id: 'singapore', name: 'Singapore Airlines', re: /singapore\s?air|singaporeair/i, airline: 'SQ' },
  { id: 'lufthansa', name: 'Lufthansa', re: /lufthansa/i, airline: 'LH' },
  { id: 'emirates', name: 'Emirates', re: /emirates/i, airline: 'EK' },
  { id: 'qatar', name: 'Qatar Airways', re: /qatar\s?airways|qatarairways/i, airline: 'QR' },
  { id: 'turkish', name: 'Turkish Airlines', re: /turkish\s?airlines/i, airline: 'TK' },
  { id: 'klm', name: 'KLM', re: /\bklm\b/i, airline: 'KL' },
  { id: 'cathay', name: 'Cathay Pacific', re: /cathay/i, airline: 'CX' },
  { id: 'easyjet', name: 'easyJet', re: /easyjet/i, airline: 'U2' },
];
// Gängige Airline-Codes für Flugnummern (2 Zeichen)
const AIRLINES = ['LX', 'WK', 'TG', 'SQ', 'LH', 'OS', 'SN', 'EW', '4U', 'EK', 'QR', 'EY', 'TK', 'KL', 'AF', 'BA', 'IB', 'AZ', 'CX', 'JL', 'NH', 'QF', 'MH', 'GA', 'VN', 'PG', 'FD', 'AK', 'TR', 'UL', 'MU', 'CA', 'KE', 'OZ', 'UA', 'DL', 'AA', 'AC', 'U2', 'FR', 'W6', 'VY', 'TP', 'SK', 'AY', 'LO', 'A3', 'ET', 'MS', 'WY', 'SV', 'GF', 'BR', 'CI', 'NZ', 'FJ', 'HU', '3K', 'QZ', 'ID', 'JQ', '6E', 'AI', 'UK', 'SU', 'PC', 'XQ', 'DE', 'X3', 'HV', 'BT'];
const AIRLINE_RE = new RegExp(`\\b(${AIRLINES.join('|')})\\s?(\\d{1,4})\\b`, 'g');
const NOT_IATA = new Set(['CHF', 'EUR', 'USD', 'THB', 'SGD', 'JPY', 'GBP', 'PIN', 'PNR', 'MWST', 'VAT', 'TAX', 'THE', 'AND', 'FOR', 'UND', 'DER', 'DIE', 'DAS', 'VON', 'BIS', 'MIT', 'ECO', 'BUS', 'NEU', 'ADT', 'CHD', 'INF', 'MRS', 'MR', 'MS', 'SEAT', 'ETA', 'ETD', 'GMT', 'UTC', 'CET', 'ICT', 'SGT', 'OK', 'FLY', 'API', 'HTML', 'URL', 'PDF', 'NON', 'REF', 'NEW', 'ONE', 'WAY', 'ALL', 'ANY', 'DAY', 'DEP', 'ARR', 'TEL', 'FAX', 'APP', 'WEB', 'CET', 'AM', 'PM', 'LTD', 'AG', 'GMBH']);

function detectProvider(all) {
  return PROVIDERS.find((p) => p.re.test(all)) || null;
}

// ---------- Hotels ----------
const L = {
  name: ['Unterkunft', 'Property', 'Hotelname', 'Name der Unterkunft', 'Name des Hotels', 'Accommodation', 'Your property', 'Ihre Unterkunft'],
  checkIn: ['Check-in', 'Check in', 'Anreise', 'Anreisedatum', 'Arrival', 'Arrival date', 'Ankunft', 'Einchecken'],
  checkOut: ['Check-out', 'Check out', 'Abreise', 'Abreisedatum', 'Departure', 'Departure date', 'Auschecken'],
  ref: ['Buchungsnummer', 'Bestätigungsnummer', 'Reservierungsnummer', 'Buchungs-ID', 'Buchungs-Nr', 'Buchungsnr', 'Booking number', 'Booking ID', 'Booking reference', 'Confirmation number', 'Confirmation code', 'Reservation number', 'Itinerary number', 'Reiseplannummer', 'Reservierungs-ID', 'Bestätigungscode', 'Buchungscode', 'Buchungsreferenz', 'Reservation code', 'Booking code'],
  pin: ['PIN-Code', 'PIN', 'Pin code'],
  address: ['Adresse der Unterkunft', 'Adresse des Hotels', 'Property address', 'Address of property', 'Hotel address', 'Adresse', 'Address', 'Anschrift', 'Standort', 'Lage', 'Location'],
  phone: ['Telefon', 'Telefonnummer', 'Tel', 'Phone', 'Phone number', 'Kontakt'],
  total: ['Gesamtpreis', 'Gesamtbetrag', 'Gesamtkosten', 'Gesamtsumme', 'Endpreis', 'Total price', 'Total amount', 'Total charged', 'Amount paid', 'Total cost', 'Grand total', 'Preis gesamt', 'Gesamt', 'Total', 'Betrag', 'Price', 'Preis', 'Summe', 'Amount'],
};
const PREPAID = /(insgesamt bezahlt|bezahlter betrag|wird mit booking\.com bezahlt|keine weitere zahlung nötig|bereits bezahlt|vollständig bezahlt|wurde belastet|wir haben .* belastet|zahlung erhalten|vorausbezahlt|jetzt bezahlt|bezahlt am|\bpaid in full\b|already paid|you(?:'|’)ve paid|you have paid|payment received|prepaid|charged to your card|has been charged|amount paid|total charged)/i;
const AT_PROPERTY = /(zahlung in der unterkunft|zahlen in der unterkunft|bezahlen in der unterkunft|zahlen sie .* (vor ort|in der unterkunft|im hotel)|zahlung vor ort|bezahlung (?:vor ort|im hotel|in der unterkunft)|im hotel bezahlen|pay at (?:the )?(?:property|hotel)|pay(?:ment)? on arrival|you(?:'|’)ll pay (?:at|when)|you will pay (?:at|the property)|payment at (?:the )?(?:property|hotel)|pay later)/i;
const CANCELLED = /(storniert|stornierung bestätigt|stornierungsbestätigung|wurde (?:erfolgreich )?storniert|cancell?ed|cancellation confirm|has been cancell?ed)/i;
const MODIFIED = /(geändert|änderung|aktualisiert|modified|changed|updated|amended)/i;
const NON_REFUNDABLE = /(nicht erstattungsfähig|nicht rückerstattbar|nicht kostenfrei stornierbar|nicht kostenlos stornierbar|nicht stornierbar|non-?refundable|not refundable|no free cancell?ation|cannot be cancell?ed)/i;
const PAID_LABEL = /(insgesamt bezahlt|bezahlter betrag|bereits bezahlt|betrag bezahlt|amount paid|total paid|paid amount|you(?:'|’)ve paid|you paid)/i;
const FREE_CANCEL = /(kostenlos(?:e)? (?:stornier\w*|storno)|kostenfrei(?:e)? stornier\w*|gebührenfrei\w* stornier\w*|free(?:ly)? cancell?ation|cancel for free|free cancel)[^\n]{0,80}/i;

const ALL_LABELS = () => Object.values(L).flat();
const isLabelLine = (v) => new RegExp(`^(?:${ALL_LABELS().map(esc).join('|')})\\b`, 'i').test(v);
const GENERIC_TITLE = /(reservation|reservierung|buchung|booking|bestätigung|confirmation|voucher|beleg|receipt|prepaid|rechnung|invoice|itinerary|e-ticket|zahlungsbeleg|ihre angaben|details)/i;
/** Bezahlter Betrag («Insgesamt bezahlt € …», «Am 6. Okt. bezahlter Betrag € …», «Amount paid …») */
function paidAmount(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!PAID_LABEL.test(lines[i])) continue;
    const after = lines[i].slice(lines[i].search(PAID_LABEL));
    const money = findMoney(after).concat(findMoney(lines[i + 1] || ''));
    if (money.length) return { amount: money[0].amount, currency: money[0].currency };
  }
  return null;
}

function hotelName(subject, lines, provider) {
  // Betreff; fehlt er (eingefügter Text), die ersten Zeilen – dort steht meist «Ihre Buchung in X ist bestätigt»
  // Ausdrückliche Beschriftung («Unterkunft: …», «Property: …») hat Vorrang
  const lv = labelValue(lines, L.name, { test: (v) => v.length > 2 && v.length < 90 && !/^\d/.test(v) && !/@/.test(v) && !/^(details|informationen|information)$/i.test(v) });
  if (lv) return cleanVal(lv.value);
  const cands = [subject, ...lines.slice(0, 4)].map(cleanVal).filter(Boolean);
  for (const subj of cands) {
    const v = nameFrom(subj);
    if (v && !/\b(booking|buchungs|bestätigungs|confirmation|reservation|reservierungs)\s*(id|nr|nummer|number|code)\b|\d{5,}/i.test(v)) return v;
  }
  return '';
}
function nameFrom(subj) {
  const pats = [
    /(?:bestätigt|bestaetigt|confirmed)\s*(?:[:\-–]|bei|at|in|für|for)\s*(.+)$/i,
    /(?:buchungsbestätigung|reservierungsbestätigung|booking confirmation|reservation confirmation|ihre buchung|your booking|your reservation|ihre reservierung)\s*(?:[:\-–]|für|for|bei|at|in)\s*(.+)$/i,
    /(?:storniert|cancell?ed)\s*(?:[:\-–]|bei|at|in|für|for)\s*(.+)$/i,
    /^(?:ihre buchung|your booking|ihre reservierung|your reservation)\s+(?:in|bei|at|für|for)\s+(.+?)\s+(?:ist|is|wurde|was|has been)\b/i,
  ];
  for (const re of pats) {
    const m = subj.match(re);
    if (m) {
      const v = cleanVal(m[1].replace(/\b(?:ist|is|wurde|has been)\b.*$/i, '').replace(/\(.*?\)/g, '').replace(/\s[-–|]\s.*(booking|agoda|hotels|expedia|trivago).*$/i, ''));
      if (v && v.length > 2 && !/^(bestätigt|confirmed)$/i.test(v)) return v;
    }
  }
  return '';
}

function parseHotel(src, lines, all, provider, refYear) {
  const f = {};
  f.name = hotelName(src.subject, lines, provider);
  const ci = labelValue(lines, L.checkIn, { maxNext: 3, test: (v) => !!firstDate(v, refYear) });
  const co = labelValue(lines, L.checkOut, { maxNext: 3, test: (v) => !!firstDate(v, refYear) });
  if (ci) {
    f.checkIn = firstDate(ci.value, refYear);
    const t = findTimes(lines.slice(ci.line, ci.line + 2).join(' '));
    if (t.length) f.checkInTime = t[0];
  }
  if (co) {
    f.checkOut = firstDate(co.value, refYear);
    const t = findTimes(lines.slice(co.line, co.line + 2).join(' '));
    if (t.length) f.checkOutTime = t[t.length > 1 ? 1 : 0];
  }
  if (f.checkIn && f.checkOut && f.checkOut <= f.checkIn) delete f.checkOut; // Tabellenkopf «Check In  Check Out» mit Werten darunter
  // «12. – 15. Februar 2027» / «Feb 12 – Feb 15, 2027»
  if (!f.checkIn || !f.checkOut) {
    const dates = findDates(all, refYear).map((d) => d.date);
    const uniq = [...new Set(dates)].sort();
    if (!f.checkIn && uniq.length >= 2) f.checkIn = uniq[0];
    if (!f.checkOut && uniq.length >= 2) f.checkOut = uniq.find((d) => d > (f.checkIn || '')) || '';
  }
  if (f.checkIn && f.checkOut && f.checkOut <= f.checkIn) delete f.checkOut;
  const ref = labelValue(lines, L.ref, { test: (v) => /\d/.test(v) && /[A-Z0-9][A-Z0-9.\-]{3,}[A-Z0-9]/i.test(v) });
  if (ref) f.bookingRef = ref.value.match(/[A-Z0-9]*\d[A-Z0-9.\-]{2,}[A-Z0-9]|[A-Z0-9][A-Z0-9.\-]{2,}\d[A-Z0-9]*/i)?.[0] || ref.value;
  const pin = labelValue(lines, L.pin, { test: (v) => /\b\d{4,6}\b/.test(v) });
  if (pin) f.pin = pin.value.match(/\b\d{4,6}\b/)[0];
  const adr = labelValue(lines, L.address, { test: (v) => v.length > 6 && /\d|,/.test(v) && !/@/.test(v) });
  if (adr) {
    // Mehrzeilige Adresse (z.B. «Strasse 19 / Rome, Italy / 00186») zusammensetzen
    const parts = [adr.value];
    for (let k = adr.line + 1; k < Math.min(lines.length, adr.line + 3); k++) {
      const v = lines[k];
      if (!v || v.length > 50 || /[:@]/.test(v) || isLabelLine(v) || firstDate(v, refYear) || findMoney(v).length) break;
      parts.push(v);
    }
    f.address = cleanVal(parts.join(', ').replace(/\s*\[https?:[^\]]+\]/g, '').replace(/,\s*,/g, ','));
  }
  // Ohne Beschriftungen (z.B. Hotel-Voucher als PDF): Name = Zeile direkt vor der ersten Adresszeile oben
  if (!f.name || !f.address) {
    for (let k = 0; k < Math.min(lines.length - 1, 8); k++) {
      const nm = lines[k], ad = lines[k + 1];
      if (/\d/.test(ad) && /,/.test(ad) && ad.length < 120 && /^[\p{L}][\p{L}&'’ .-]{2,60}$/u.test(nm) && nm.split(' ').length <= 7 && !GENERIC_TITLE.test(nm)) {
        if (!f.name) f.name = cleanVal(nm);
        if (!f.address) f.address = cleanVal(ad);
        break;
      }
    }
  }
  const tel = labelValue(lines, L.phone, { test: (v) => /\+?\d[\d\s()\/-]{6,}/.test(v) });
  if (tel) f.phone = tel.value.match(/\+?\d[\d\s()\/-]{6,}\d/)[0].trim();
  f.price = totalPrice(lines, all);
  const paid = paidAmount(lines);
  if (paid) {
    if (!f.price || f.price.guessed) f.price = { ...paid };
    f.paidAmount = paid.amount;
  }
  f.payment = paid ? (f.price && paid.currency === f.price.currency && paid.amount < f.price.amount - 0.5 ? 'teilweise' : 'bezahlt')
    : AT_PROPERTY.test(all) ? 'vorort' : PREPAID.test(all) ? 'bezahlt' : '';
  if (NON_REFUNDABLE.test(all)) f.nonRefundable = true;
  const fc = all.match(FREE_CANCEL);
  if (fc && !/nicht\s*$|non-?\s*$|no\s*$/i.test(all.slice(Math.max(0, fc.index - 8), fc.index))) {
    const d = firstDate(fc[0], refYear);
    if (d) f.freeCancelUntil = d;
  }
  const guests = all.match(/(\d+)\s*(?:Erwachsene|adults?|Gäste|guests|Personen|persons)/i);
  if (guests) f.guests = Number(guests[1]);
  const rooms = all.match(/(\d+)\s*(?:Zimmer|rooms?)\b/i);
  if (rooms) f.rooms = Number(rooms[1]);
  return f;
}

/** Gesamtpreis: bevorzugt hinter «Gesamtpreis/Total…», sonst der grösste Betrag */
function totalPrice(lines, all) {
  for (const group of [L.total.slice(0, 13), L.total.slice(13)]) {
    const re = new RegExp(`^\\s*(?:${group.map(esc).join('|')})\\b`, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const money = findMoney(lines[i]).concat(findMoney(lines[i + 1] || ''));
      if (money.length) {
        // Bei zwei Währungen (z.B. «THB 9'000 (ca. CHF 225)») die erste nehmen
        return { amount: money[0].amount, currency: money[0].currency };
      }
    }
  }
  const all$ = findMoney(all);
  if (!all$.length) return null;
  const best = all$.reduce((a, b) => (b.amount > a.amount ? b : a));
  return { amount: best.amount, currency: best.currency, guessed: true };
}

// ---------- Flüge ----------
function parseFlight(src, lines, all, provider, refYear) {
  const f = {};
  const ref = labelValue(lines, ['Buchungsreferenz', 'Buchungscode', 'Buchungsnummer', 'Reservierungscode', 'Reservierungsnummer', 'Booking reference', 'Booking code', 'Booking number', 'Reservation code', 'Confirmation code', 'Confirmation number', 'Filekey', 'PNR', 'Ihr Buchungscode', 'Your booking reference', 'Your booking code'], { test: (v) => /\b[A-Z0-9]{6}\b/.test(v) });
  if (ref) f.bookingRef = ref.value.match(/\b[A-Z0-9]{6}\b/)[0];
  else {
    const m = all.match(/(?:PNR|Filekey|Buchungscode|booking reference)[^A-Z0-9]{0,20}\b([A-Z0-9]{6})\b/i);
    if (m) f.bookingRef = m[1].toUpperCase();
  }
  f.price = totalPrice(lines, all);
  f.payment = 'bezahlt'; // Flüge sind praktisch immer bei der Buchung bezahlt
  // Segmente: Flugnummer, Route, Datum, Zeiten aus der Umgebung
  const segs = [];
  let lastDate = '';
  for (let i = 0; i < lines.length; i++) {
    const dl = firstDate(lines[i], refYear);
    if (dl && !AIRLINE_RE.test(lines[i])) lastDate = dl;
    AIRLINE_RE.lastIndex = 0;
    for (const m of lines[i].matchAll(AIRLINE_RE)) {
      const flightNo = `${m[1]} ${m[2]}`;
      if (segs.some((s) => s.flightNo === flightNo)) continue;
      const win = lines.slice(Math.max(0, i - 3), i + 6).join('\n');
      // Bereich bis zur nächsten Zeile mit einer anderen Flugnummer (höchstens 6 Zeilen)
      let stop = i + 1;
      while (stop < Math.min(lines.length, i + 6) && !new RegExp(AIRLINE_RE.source).test(lines[stop])) stop++;
      const sameLine = [...lines[i].matchAll(new RegExp(AIRLINE_RE.source, 'g'))].length > 1;
      const here = sameLine ? lines[i] : lines.slice(i, stop).join('\n');
      const date = firstDate(lines[i], refYear) || firstDate(here, refYear) || lastDate || firstDate(win, refYear);
      // Flughäfen: «(ZRH)» bevorzugt, sonst «ZRH – BKK» / «ZRH BKK»
      let codes = [...here.matchAll(/\(([A-Z]{3})\)/g)].map((x) => x[1]);
      if (codes.length < 2) codes = [...here.matchAll(/\b([A-Z]{3})\b/g)].map((x) => x[1]).filter((c) => !NOT_IATA.has(c) && c !== m[1] + m[2]);
      if (codes.length < 2) codes = [...win.matchAll(/\b([A-Z]{3})\b/g)].map((x) => x[1]).filter((c) => !NOT_IATA.has(c));
      const times = findTimes(here);
      const plusDay = /\+1|\(\+1\)|nächster Tag|next day/i.test(here);
      segs.push({
        flightNo, date, from: codes[0] || '', to: codes.find((c) => c !== codes[0]) || '',
        dep: times[0] || '', arr: times[1] || '', arrNextDay: plusDay,
      });
    }
  }
  f.segments = segs.filter((s) => s.date);
  const pax = [...all.matchAll(/\b(?:MR|MRS|MS|HERR|FRAU)\.?\s+([A-ZÄÖÜ][A-ZÄÖÜ'\- ]{2,40}?)(?=\s{2,}|\n|$|,)/gm)].map((m) => cleanVal(m[1]));
  if (pax.length) f.passengers = [...new Set(pax)];
  return f;
}

/**
 * Hauptfunktion. src: Ergebnis von readSource(). refYear: Jahr für Daten ohne Jahresangabe.
 * Liefert {provider, kind:'hotel'|'flight'|'unknown', status:'confirmed'|'cancelled'|'modified', fields, warnings}
 */
export function parseBooking(src, refYear = new Date().getFullYear()) {
  const text = String(src.text || '').replace(/\r/g, '').replace(/ /g, ' ');
  // Zeilen ohne eingebettete Links und Aufzählungszeichen – sonst stören sie die Beschriftungen
  const lines = text.split('\n').map((l) => l.replace(/<(?:https?|mailto|tel):[^>]*>|\[(?:https?|mailto):[^\]]*\]/g, ' ').replace(/^[\s•*·-]+/, '').replace(/\s+/g, ' ').trim());
  const head = `${src.subject || ''}\n${src.from || ''}`;
  const all = `${head}\n${text}`;
  const provider = detectProvider(all);
  AIRLINE_RE.lastIndex = 0;
  const flightNos = [...text.matchAll(AIRLINE_RE)].length;
  const hotelish = /(check-?in|check-?out|anreise|abreise|unterkunft|hotel|property|zimmer|room|nacht|night)/i.test(all);
  const flightish = /(flug|flight|abflug|departure|boarding|e-ticket|ticket|passagier|passenger|fluggast)/i.test(all);
  let kind = 'unknown';
  if (provider?.airline || (flightNos > 0 && flightish && !/(check-?in|anreise).*\n?.*(check-?out|abreise)/i.test(all))) kind = 'flight';
  else if (hotelish) kind = 'hotel';
  else if (flightNos > 0) kind = 'flight';
  const status = CANCELLED.test(head) || /\b(ihre buchung wurde storniert|your booking (?:has been|was|is) cancell?ed|reservation cancell?ed|stornierung bestätigt)/i.test(text) ? 'cancelled'
    : MODIFIED.test(src.subject || '') ? 'modified' : 'confirmed';
  const fields = kind === 'flight' ? parseFlight(src, lines, all, provider, refYear) : kind === 'hotel' ? parseHotel(src, lines, all, provider, refYear) : { price: totalPrice(lines, all) };
  // Link zur Buchung: zuerst «Buchung verwalten/Bestätigung», sonst eine Adresse des Anbieters (keine Tracking-Pixel)
  const urls = (all.match(/https?:\/\/[^\s\]>"')]+/g) || []).filter((u) => !/(tracking_pixel|\.gif|\.png|unsubscribe|abmelden)/i.test(u));
  const link = urls.find((u) => /(confirmation|myreservation|manage|mybooking|bn=|booking_id|itinerary|reservation)/i.test(u))
    || urls.find((u) => /(booking\.com|agoda|hotels\.com|expedia|trivago|airbnb|swiss\.com|flyedelweiss|thaiairways|singaporeair)\/./i.test(u));
  if (link) fields.link = link.replace(/[.,;]+$/, '');
  const warnings = [];
  if (kind === 'unknown') warnings.push('Art der Buchung nicht erkannt – Felder bitte von Hand prüfen.');
  if (status === 'cancelled' && fields.price?.guessed) delete fields.price;
  if (fields.price?.guessed) warnings.push('Gesamtpreis nicht eindeutig – grösster Betrag vorgeschlagen.');
  if (kind === 'flight' && !fields.segments?.length) warnings.push('Keine Flüge erkannt.');
  if (kind === 'hotel' && (!fields.checkIn || !fields.checkOut)) warnings.push('An- oder Abreise nicht erkannt.');
  return { provider: provider ? { id: provider.id, name: provider.name } : null, kind, status, fields, warnings };
}
