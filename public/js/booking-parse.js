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

/** Text aus Seiteninhalten (Tj/TJ); klappt bei «normalen» PDFs, nicht bei eingebetteten Spezialschriften */
export async function pdfToText(bytes) {
  const raw = latin1(bytes);
  const parts = [];
  const re = />>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const dict = raw.slice(Math.max(raw.lastIndexOf(' obj', m.index), 0), m.index + 2);
    const filters = [...((dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [])[1] || '').matchAll(/\/(\w+)/g)].map((x) => x[1]);
    let data = bytes.slice(start, end);
    try {
      for (const f of filters) {
        if (f === 'FlateDecode' || f === 'Fl') data = await inflate(data);
        else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
        else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHex(data);
        else throw new Error('Filter ' + f);
      }
    } catch { continue; }
    const s = latin1(data);
    if (!/T[Jj]/.test(s)) continue;
    let line = '';
    const lines = [];
    const tok = /\((?:\\.|[^\\)])*\)\s*Tj|\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ|T\*|-?[\d.]+\s+-?[\d.]+\s+T[dD]|\((?:\\.|[^\\)])*\)\s*'|ET/g;
    let t;
    while ((t = tok.exec(s))) {
      const x = t[0];
      if (x.endsWith('Tj') || x.endsWith("'")) {
        if (x.endsWith("'")) { lines.push(line); line = ''; }
        line += pdfString(x.slice(x.indexOf('(') + 1, x.lastIndexOf(')')));
      } else if (x.endsWith('TJ')) {
        for (const p of (t[1] || '').matchAll(/\(((?:\\.|[^\\)])*)\)|(-?[\d.]+)/g)) {
          if (p[1] !== undefined) line += pdfString(p[1]);
          else if (Number(p[2]) < -200) line += ' ';
        }
      } else if (/T[dD]$/.test(x)) {
        const dy = Number(x.trim().split(/\s+/)[1]);
        if (dy !== 0) { lines.push(line); line = ''; } else line += ' ';
      } else { lines.push(line); line = ''; }
    }
    lines.push(line);
    parts.push(lines.map((l) => l.trim()).filter(Boolean).join('\n'));
  }
  return parts.join('\n').trim();
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
  const str = decodeBytes(bytes);
  if (name.endsWith('.eml') || /^(received|from|return-path|delivered-to|mime-version|subject|date|message-id):/im.test(head.split(/\r?\n\r?\n/)[0] || '')) {
    const mail = parseEml(str);
    let text = mail.text.trim() && mail.text.length > 200 ? mail.text : mail.html ? htmlToText(mail.html) : mail.text;
    if (mail.html && mail.text) text = mail.text.length >= htmlToText(mail.html).length * 0.5 ? mail.text : htmlToText(mail.html);
    // Text von PDF-Anhängen (z.B. E-Ticket) anhängen
    for (const a of mail.attachments) if (/pdf/.test(a.type) || /\.pdf$/i.test(a.name)) {
      const t = await pdfToText(a.bytes).catch(() => '');
      if (t) text += '\n\n' + t;
    }
    return { subject: mail.subject, from: mail.from, text, attachments: mail.attachments, kind: 'eml' };
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
  const re = new RegExp(`^\\s*(?:[•*\\-]\\s*)?(?:${labels.map(esc).join('|')})\\b\\s*[:：]?\\s*(.*)$`, 'i');
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
  address: ['Adresse', 'Address', 'Anschrift', 'Standort', 'Location'],
  phone: ['Telefon', 'Telefonnummer', 'Tel', 'Phone', 'Phone number', 'Kontakt'],
  total: ['Gesamtpreis', 'Gesamtbetrag', 'Gesamtkosten', 'Gesamtsumme', 'Endpreis', 'Total price', 'Total amount', 'Total charged', 'Amount paid', 'Total cost', 'Grand total', 'Preis gesamt', 'Gesamt', 'Total', 'Betrag', 'Price', 'Preis', 'Summe', 'Amount'],
};
const PREPAID = /(bereits bezahlt|vollständig bezahlt|wurde belastet|wir haben .* belastet|zahlung erhalten|vorausbezahlt|jetzt bezahlt|bezahlt am|\bpaid in full\b|already paid|you(?:'|’)ve paid|you have paid|payment received|prepaid|charged to your card|has been charged|amount paid|total charged)/i;
const AT_PROPERTY = /(zahlung in der unterkunft|zahlen in der unterkunft|bezahlen in der unterkunft|zahlen sie .* (vor ort|in der unterkunft|im hotel)|zahlung vor ort|bezahlung (?:vor ort|im hotel|in der unterkunft)|im hotel bezahlen|pay at (?:the )?(?:property|hotel)|pay(?:ment)? on arrival|you(?:'|’)ll pay (?:at|when)|you will pay (?:at|the property)|payment at (?:the )?(?:property|hotel)|pay later)/i;
const CANCELLED = /(storniert|stornierung bestätigt|stornierungsbestätigung|wurde (?:erfolgreich )?storniert|cancell?ed|cancellation confirm|has been cancell?ed)/i;
const MODIFIED = /(geändert|änderung|aktualisiert|modified|changed|updated|amended)/i;
const FREE_CANCEL = /(kostenlos(?:e)? (?:stornier\w*|storno)|kostenfrei(?:e)? stornier\w*|gebührenfrei\w* stornier\w*|free(?:ly)? cancell?ation|cancel for free|free cancel)[^\n]{0,80}/i;

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
  // «12. – 15. Februar 2027» / «Feb 12 – Feb 15, 2027»
  if (!f.checkIn || !f.checkOut) {
    const dates = findDates(all, refYear).map((d) => d.date);
    const uniq = [...new Set(dates)].sort();
    if (!f.checkIn && uniq.length >= 2) f.checkIn = uniq[0];
    if (!f.checkOut && uniq.length >= 2) f.checkOut = uniq.find((d) => d > (f.checkIn || '')) || '';
  }
  if (f.checkIn && f.checkOut && f.checkOut <= f.checkIn) delete f.checkOut;
  const ref = labelValue(lines, L.ref, { test: (v) => /[A-Z0-9]{4,}/i.test(v.replace(/[.\s-]/g, '')) });
  if (ref) f.bookingRef = (ref.value.match(/[A-Z0-9][A-Z0-9.\-]{3,}[A-Z0-9]/i) || [ref.value])[0];
  const pin = labelValue(lines, L.pin, { test: (v) => /\b\d{4,6}\b/.test(v) });
  if (pin) f.pin = pin.value.match(/\b\d{4,6}\b/)[0];
  const adr = labelValue(lines, L.address, { test: (v) => v.length > 6 && /\d|,/.test(v) && !/@/.test(v) });
  if (adr) f.address = cleanVal(adr.value.replace(/\s*\[https?:[^\]]+\]/g, ''));
  const tel = labelValue(lines, L.phone, { test: (v) => /\+?\d[\d\s()\/-]{6,}/.test(v) });
  if (tel) f.phone = tel.value.match(/\+?\d[\d\s()\/-]{6,}\d/)[0].trim();
  f.price = totalPrice(lines, all);
  f.payment = AT_PROPERTY.test(all) ? 'vorort' : PREPAID.test(all) ? 'bezahlt' : '';
  const fc = all.match(FREE_CANCEL);
  if (fc) {
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
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
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
  const link = (all.match(/https?:\/\/[^\s\]>"')]+/g) || []).find((u) => /(booking\.com|agoda|hotels\.com|expedia|trivago|airbnb|swiss\.com|flyedelweiss|thaiairways|singaporeair|manage|mybooking|reservation|confirmation|trip)/i.test(u));
  if (link) fields.link = link.replace(/[.,;]+$/, '');
  const warnings = [];
  if (kind === 'unknown') warnings.push('Art der Buchung nicht erkannt – Felder bitte von Hand prüfen.');
  if (status === 'cancelled' && fields.price?.guessed) delete fields.price;
  if (fields.price?.guessed) warnings.push('Gesamtpreis nicht eindeutig – grösster Betrag vorgeschlagen.');
  if (kind === 'flight' && !fields.segments?.length) warnings.push('Keine Flüge erkannt.');
  if (kind === 'hotel' && (!fields.checkIn || !fields.checkOut)) warnings.push('An- oder Abreise nicht erkannt.');
  return { provider: provider ? { id: provider.id, name: provider.name } : null, kind, status, fields, warnings };
}
