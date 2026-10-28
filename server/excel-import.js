// Übernimmt eine Reise aus der bisherigen Ferien-Excel (Format «Ferien2027.xlsm»):
//   Übersicht                     → Tage (Programm, Ort, Notiz) und Übernachtungen ohne Kosten
//   Reiseablauf                   → Posten, Unterkünfte (aufeinanderfolgende Nächte zusammengefasst), Zahlungen
//   Allgemeine Kosteneinstellung  → Pauschalen (Essen pro Tag, Unterkunft-Platzhalter pro Nacht)
//   Währungsrechner               → Wechselkurse
//   Abrechnung                    → Bezahlmethoden, Anzahl Personen, Kontrollsumme
import { readXlsx, excelDate } from './xlsx-reader.js';
import { addDays, isDate, round2 } from '../public/js/calc.js';

const PLACEHOLDER = /^(aktivität\s*\d+|name unterkunft)$/i;

export function guessCategory(text) {
  const t = String(text || '').toLowerCase();
  if (/tauch|liveaboard|nitrox|dive/.test(t)) return 'tauchen';
  if (/unterkunft|hotel|resort|bungalow|hostel/.test(t)) return 'unterkunft';
  if (/transfer|taxi|transport|fähre|faehre|zug|bus|mietauto|boot/.test(t)) return 'transport';
  if (/flug|ankunft|abflug|airline/.test(t)) return 'flug';
  if (/essen|trinken|restaurant|frühstück|bar\b/.test(t)) return 'essen';
  if (/gebühr|gebuehr|visa|eintritt|\bnp\b|steuer|taxe/.test(t)) return 'gebuehren';
  return 'aktivitaet';
}

export const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'x';

function parseDue(text) {
  const m = String(text || '').match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/);
  if (!m) return '';
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return isDate(d) ? d : '';
}

const timeOf = (text) => String(text || '').match(/\b(\d{1,2})[:.](\d{2})\b/)?.slice(1, 3).map((x, i) => (i === 0 ? x.padStart(2, '0') : x)).join(':') || '';

/**
 * @param {Buffer|string} file
 * @param {{fileName?:string, settings:object, newId:()=>string}} opts
 * @returns {{trip, settingsPatch:{methods, rates}, report}}
 */
export function importTripFromExcel(file, { fileName = '', settings, newId }) {
  const sheets = readXlsx(file);
  const ra = sheets['Reiseablauf'];
  if (!ra) throw new Error('Tabellenblatt «Reiseablauf» nicht gefunden – ist das die Ferien-Excel?');
  const warnings = [];

  // ---------- Spalten anhand der Überschriften finden ----------
  const header = {};
  for (const c of Object.values(ra.cells)) if (c.row === 1 && typeof c.v === 'string') header[c.v.trim().toLowerCase()] = c.col;
  const col = (name, fallback) => header[name] ?? fallback;
  const C = {
    date: col('datum', 1), title: col('aktivität', 2), detail: col('unterkunft', 3), amount: col('betrag', 4),
    cur: col('währung', 5), chf: col('chf', 6), method: col('bezahlmethode', 7), status: col('status', 8), note: col('kommentar', 9),
  };
  const byRow = new Map();
  for (const c of Object.values(ra.cells)) {
    if (!byRow.has(c.row)) byRow.set(c.row, {});
    byRow.get(c.row)[c.col] = c;
  }
  const val = (r, c) => byRow.get(r)?.[c]?.v ?? null;
  const fml = (r, c) => byRow.get(r)?.[c]?.f ?? null;

  // ---------- Pauschalen ----------
  const ak = sheets['Allgemeine Kosteneinstellung'];
  const allowRows = new Map(); // Zeilennummer → allowance
  const allowances = [];
  if (ak) {
    for (let r = 2; r <= ak.maxRow; r++) {
      const label = ak.value('A' + r);
      const amount = Number(ak.value('B' + r));
      if (!label || !Number.isFinite(amount)) continue;
      const isLodging = /unterkunft|übernachtung|hotel/i.test(label);
      const a = {
        id: newId(),
        label: String(label).trim(),
        catId: isLodging ? 'unterkunft' : guessCategory(label),
        amount,
        currency: 'CHF',
        mode: isLodging ? 'platzhalter' : 'tag',
        per: isLodging ? 'nacht' : 'tag',
      };
      allowances.push(a);
      allowRows.set(r, a);
    }
  }
  const allowanceOf = (f) => {
    const m = String(f || '').match(/Kosteneinstellung'?!\$?B\$?(\d+)/i);
    return m ? allowRows.get(Number(m[1])) : null;
  };

  // ---------- Wechselkurse ----------
  const rates = {};
  const wr = sheets['Währungsrechner'];
  if (wr) {
    for (let r = 1; r <= Math.min(wr.maxRow, 40); r++) {
      const cur = wr.value('A' + r);
      const rate = Number(wr.value('B' + r));
      if (typeof cur === 'string' && /^[A-Z]{3}$/.test(cur.trim()) && cur !== 'CHF' && rate > 0) rates[cur.trim()] = rate;
    }
  }
  const rateOf = (cur) => (!cur || cur === 'CHF' ? 1 : settings.rates?.[cur]?.rate || rates[cur] || NaN);

  // ---------- Bezahlmethoden ----------
  const methodNames = new Set();
  const ab = sheets['Abrechnung'];
  let travelers = 2;
  let excelTotal = null;
  let excelPaid = null;
  if (ab) {
    for (let r = 2; r <= ab.maxRow; r++) {
      const a = ab.value('A' + r);
      const f = ab.formula('B' + r) || '';
      if (typeof a !== 'string' || ab.isFormula('A' + r)) continue;
      if (/^total$/i.test(a)) excelTotal = ab.value('B' + r);
      else if (/pro person/i.test(a)) {
        const m = f.match(/\/\s*(\d+)/);
        if (m) travelers = Number(m[1]);
      } else if (/bereits bezahlt/i.test(a)) excelPaid = ab.value('B' + r);
      else if (/SUMIF/i.test(f) && !/^budget$/i.test(a)) methodNames.add(a.trim());
    }
  }
  const methodId = (name) => {
    const n = String(name || '').trim();
    if (!n || /^budget$/i.test(n)) return '';
    methodNames.add(n);
    return settings.methods?.find((m) => m.name.toLowerCase() === n.toLowerCase())?.id || 'm-' + slug(n);
  };

  // ---------- Übersicht (Tage) ----------
  const days = {};
  const overnight = {}; // date → Name der Übernachtung laut Übersicht
  const ue = sheets['Übersicht'];
  const allDates = [];
  if (ue) {
    for (let r = 2; r <= ue.maxRow; r++) {
      const d = excelDate(ue.value('B' + r));
      if (!d) continue;
      allDates.push(d);
      const title = String(ue.value('C' + r) ?? '').trim();
      const place = String(ue.value('D' + r) ?? '').trim();
      const note = String(ue.value('F' + r) ?? '').trim();
      const stay = String(ue.value('E' + r) ?? '').trim();
      days[d] = { title, place, note, skip: [] };
      if (stay) overnight[d] = stay;
    }
  }

  // ---------- Reiseablauf ----------
  const rows = [];
  let cur = null;
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    if (r === 1) continue;
    const d = excelDate(val(r, C.date));
    if (d) {
      if (allDates.length && (d < allDates[0] || d > allDates[allDates.length - 1])) {
        warnings.push(`Zeile ${r}: Datum ${d.split('-').reverse().join('.')} liegt ausserhalb der Reise und wurde ignoriert.`);
      } else cur = d;
    }
    if (!cur) continue;
    const title = String(val(r, C.title) ?? '').trim();
    const detail = String(val(r, C.detail) ?? '').trim();
    const amountRaw = val(r, C.amount);
    const amount = typeof amountRaw === 'number' ? amountRaw : null;
    const allowance = allowanceOf(fml(r, C.amount));
    rows.push({
      r, date: cur, title, detail, amount, allowance,
      cur: String(val(r, C.cur) ?? '').trim() || 'CHF',
      chf: typeof val(r, C.chf) === 'number' ? val(r, C.chf) : null,
      method: String(val(r, C.method) ?? '').trim(),
      status: String(val(r, C.status) ?? '').trim().toLowerCase(),
      note: String(val(r, C.note) ?? '').trim(),
    });
  }
  if (!allDates.length) {
    for (const x of rows) allDates.push(x.date);
    allDates.sort();
  }
  const start = allDates[0];
  const end = allDates[allDates.length - 1];
  if (!start) throw new Error('Keine Daten gefunden');

  const items = [];
  const allowanceDates = new Map(allowances.map((a) => [a.id, new Set()]));
  const stayNights = []; // {date, name, amount, cur, ...}
  let excelCountedCHF = 0;

  const baseItem = (x, extra = {}) => {
    const status = x.status;
    const payWhere = /vor ort/.test(status) ? 'vorort' : /vorgängig|vorgaengig|bezahlt/.test(status) ? 'vorgaengig' : x.cur && x.cur !== 'CHF' ? 'vorort' : 'vorgaengig';
    const it = {
      id: newId(),
      date: x.date,
      endDate: '',
      time: timeOf(x.detail),
      title: x.title,
      detail: x.detail,
      catId: guessCategory(x.title + ' ' + (extra.catHint || '')),
      place: '',
      plan: { amount: round2(x.amount || 0), currency: x.cur || 'CHF' },
      reserved: /reserviert|angezahlt/.test(status),
      payWhere,
      dueDate: payWhere === 'vorgaengig' && !/^bezahlt/.test(status) ? parseDue(x.note) : '',
      dueMethodId: !/^bezahlt/.test(status) ? methodId(x.method) : '',
      payments: [],
      done: false,
      link: (x.note.match(/https?:\/\/\S+/) || [''])[0],
      note: x.note,
      todos: [],
      files: [],
      ...extra.fields,
    };
    if (/^bezahlt/.test(status) && Math.abs(x.amount || 0) > 0.004) {
      const rate = rateOf(it.plan.currency);
      it.payments.push({
        id: newId(), date: '', amount: it.plan.amount, currency: it.plan.currency,
        chf: round2(x.chf ?? it.plan.amount * rate), methodId: methodId(x.method), paidBy: '', note: 'aus Excel übernommen',
      });
      it.dueMethodId = '';
    }
    if (/angezahlt/.test(status)) {
      it.todos.push({ id: newId(), text: 'Anzahlung nachtragen (Betrag stand nicht in der Excel)', due: '', done: false });
      warnings.push(`«${x.title}${x.detail ? ' – ' + x.detail : ''}»: Status «angezahlt», der Anzahlungsbetrag fehlt in der Excel – als To-do vermerkt.`);
    }
    return it;
  };

  for (const x of rows) {
    const counted = x.method && (x.chf ?? null) !== null;
    if (counted) excelCountedCHF += x.chf;
    if (x.allowance) {
      // Pauschalen-Zeile: «Essen & Trinken» bzw. Platzhalter «Unterkunft» → Pauschale gilt an diesem Tag
      const isGeneric = x.title.toLowerCase() === x.allowance.label.toLowerCase() || (x.allowance.mode === 'platzhalter' && /unterkunft/i.test(x.title));
      if (isGeneric) {
        allowanceDates.get(x.allowance.id).add(x.date);
        continue;
      }
      // Eigener Posten mit Pauschalbetrag (z.B. «Trinken an Board») – wird vor Ort bezahlt
      const it = baseItem(x);
      it.payWhere = 'vorort';
      items.push(it);
      continue;
    }
    if (/^unterkunft$/i.test(x.title) && x.detail && !PLACEHOLDER.test(x.detail)) {
      stayNights.push(x);
      continue;
    }
    const hasAmount = x.amount !== null;
    if (!x.title || (PLACEHOLDER.test(x.title) && !hasAmount)) continue;
    if (!hasAmount && x.allowance == null && /^(essen\s*&\s*trinken|unterkunft)$/i.test(x.title)) continue;
    items.push(baseItem(x));
  }

  // ---------- Unterkünfte: aufeinanderfolgende Nächte zusammenfassen ----------
  const stays = [];
  for (const x of stayNights.sort((a, b) => a.date.localeCompare(b.date))) {
    const last = stays[stays.length - 1];
    if (last && last.name === x.detail && addDays(last.to, 1) === x.date) {
      last.to = x.date;
      last.rows.push(x);
    } else stays.push({ name: x.detail, from: x.date, to: x.date, rows: [x] });
  }
  for (const s of stays) {
    const main = s.rows.find((r) => Math.abs(r.amount || 0) > 0.004) || s.rows[0];
    const amount = s.rows.reduce((a, r) => a + (r.cur === main.cur ? r.amount || 0 : 0), 0);
    const notes = [...new Set(s.rows.map((r) => r.note).filter(Boolean))].join(' · ');
    const it = baseItem({ ...main, date: s.from, title: s.name, detail: '', amount, note: notes }, { catHint: 'unterkunft' });
    it.catId = 'unterkunft';
    it.endDate = addDays(s.to, 1);
    it.time = '';
    items.push(it);
  }

  // ---------- Übernachtungen aus der Übersicht ohne eigene Kosten (z.B. Flugzeug, Liveaboard) ----------
  const covered = (d) => items.some((it) => it.catId === 'unterkunft' && it.endDate && it.date <= d && it.endDate > d);
  const free = [];
  for (const d of Object.keys(overnight).sort()) {
    if (d >= end || covered(d)) continue;
    const name = overnight[d];
    const last = free[free.length - 1];
    if (last && last.name === name && addDays(last.to, 1) === d) last.to = d;
    else free.push({ name, from: d, to: d });
  }
  for (const f of free) {
    items.push({
      id: newId(), date: f.from, endDate: addDays(f.to, 1), time: '', title: f.name, detail: '', catId: 'unterkunft', place: '',
      plan: { amount: 0, currency: 'CHF' }, reserved: false, payWhere: 'vorgaengig', dueDate: '', dueMethodId: '',
      payments: [], done: false, link: '', note: 'Übernachtung ohne eigene Kosten (aus der Übersicht)', todos: [], files: [],
    });
  }

  // ---------- Pauschalen nur an Tagen, an denen sie in der Excel standen ----------
  const nightsCovered = new Set();
  for (const it of items) if (it.catId === 'unterkunft' && it.endDate) for (let d = it.date; d < it.endDate; d = addDays(d, 1)) nightsCovered.add(d);
  for (const a of allowances) {
    const used = allowanceDates.get(a.id);
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (a.per === 'nacht' && d === end) continue;
      if (used.has(d)) continue;
      if (a.mode === 'platzhalter' && nightsCovered.has(d)) continue; // durch Unterkunft ersetzt
      days[d] ||= { title: '', place: '', note: '', skip: [] };
      days[d].skip.push(a.id);
    }
  }

  // Mögliche Doppelerfassungen melden: gleicher Titel innert 3 Tagen, einmal bezahlt, einmal noch offen
  const withCost = items.filter((it) => it.plan.amount && it.catId !== 'unterkunft');
  for (const a of withCost) {
    for (const b of withCost) {
      if (a === b || a.title.toLowerCase() !== b.title.toLowerCase()) continue;
      if (a.payments.length && !b.payments.length && Math.abs((Date.parse(a.date) - Date.parse(b.date)) / 864e5) <= 3) {
        const f = (d) => d.split('-').reverse().join('.');
        warnings.push(`«${b.title}» am ${f(b.date)} ist noch offen, am ${f(a.date)} gibt es denselben Posten bereits bezahlt – evtl. doppelt? Bitte prüfen.`);
      }
    }
  }

  // Hauptwährung vor Ort = häufigste Fremdwährung
  const curCount = {};
  for (const it of items) if (it.plan.currency !== 'CHF') curCount[it.plan.currency] = (curCount[it.plan.currency] || 0) + 1;
  const mainCur = Object.entries(curCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'CHF';

  const base = String(fileName || 'Reise').replace(/\.[^.]+$/, '').replace(/^[0-9a-f]{8}-/i, '');
  const name = base.replace(/([a-zäöü])(\d{4})$/i, '$1 $2').trim() || 'Reise';

  items.sort((a, b) => a.date.localeCompare(b.date));
  const trip = {
    id: newId(),
    name,
    start,
    end,
    currency: mainCur,
    travelers,
    note: '',
    allowances,
    days,
    split: { enabled: false, participants: [] },
    items,
    createdAt: new Date().toISOString(),
    source: 'Excel-Import',
  };

  const methods = [...methodNames].map((n) => ({ id: methodId(n), name: n }));
  return {
    trip,
    settingsPatch: { methods, rates },
    report: {
      items: items.length,
      stays: items.filter((i) => i.endDate).length,
      payments: items.reduce((a, i) => a + i.payments.length, 0),
      excelTotal: excelTotal ?? round2(excelCountedCHF),
      excelPaid,
      warnings,
    },
  };
}

/** Übernimmt neue Methoden und fehlende Kurse in die Einstellungen (bestehende bleiben unverändert) */
export function applySettingsPatch(settings, patch) {
  const added = { methods: [], rates: [] };
  for (const m of patch.methods || []) {
    if (!settings.methods.some((x) => x.id === m.id || x.name.toLowerCase() === m.name.toLowerCase())) {
      settings.methods.push(m);
      added.methods.push(m.name);
    }
  }
  for (const [cur, rate] of Object.entries(patch.rates || {})) {
    if (!settings.rates[cur]) {
      settings.rates[cur] = { rate, source: 'Excel' };
      added.rates.push(cur);
    }
  }
  return added;
}
