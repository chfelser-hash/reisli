// Rechenlogik von Reisli – ohne DOM, damit Browser, Server (Import) und Tests dieselbe Logik nutzen.
//
// Datenmodell (Kurzfassung)
// settings: { methods:[{id,name}], categories:[{id,name,color}], rates:{ THB:{rate, source, updatedAt} } }
// trip:     { id, name, start, end, currency, travelers, note,
//             allowances:[{id,label,catId,amount,currency,mode:'tag'|'platzhalter',per:'tag'|'nacht'}],
//             days:{ 'YYYY-MM-DD': {title, place, note, skip:[allowanceId]} },
//             split:{ enabled, participants:[{id,name}] },
//             items:[Item] }
// Item:     { id, date, endDate (nur Unterkünfte: Check-out), time, title, detail, catId, place,
//             plan:{amount,currency}, reserved, payWhere:'vorgaengig'|'vorort', dueDate, dueMethodId,
//             payments:[{id,date,amount,currency,chf,methodId,paidBy,note}], done,
//             link, note, todos:[{id,text,due,done}], files:[{id,name,size,type}],
//             split:{mode:'equal'|'shares'|'amounts', values:{participantId:number}} }

export const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const DEFAULT_CATEGORIES = [
  { id: 'flug', name: 'Flug', color: '#2563eb' },
  { id: 'unterkunft', name: 'Unterkunft', color: '#7c3aed' },
  { id: 'transport', name: 'Transfer & Transport', color: '#0891b2' },
  { id: 'tauchen', name: 'Tauchen', color: '#0f766e' },
  { id: 'essen', name: 'Essen & Trinken', color: '#ea580c' },
  { id: 'aktivitaet', name: 'Aktivitäten', color: '#db2777' },
  { id: 'gebuehren', name: 'Gebühren & Visa', color: '#64748b' },
  { id: 'sonstiges', name: 'Sonstiges', color: '#a16207' },
];

export const STATUS = {
  info: { label: 'Info', cls: 'st-info' },
  offen: { label: 'offen', cls: 'st-offen' },
  reserviert: { label: 'reserviert', cls: 'st-res' },
  angezahlt: { label: 'angezahlt', cls: 'st-an' },
  bezahlt: { label: 'bezahlt', cls: 'st-ok' },
};

// ---------- Zahlen & Ausdrücke ----------

/** Wertet einfache Rechenausdrücke sicher aus: 1500+120, 2*7000, (21.4+43.6), 12,50 */
export function evalExpr(input) {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().replace(/['’\s]/g, '').replace(/^=/, '');
  if (!s) return 0;
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  let i = 0;
  const peek = () => s[i];
  const num = () => {
    const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i));
    if (!m) throw new Error('Zahl erwartet');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = () => {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error(') erwartet');
      i++;
      return v;
    }
    return num();
  };
  const term = () => {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return NaN;
    return v;
  } catch {
    return NaN;
  }
}

const n = (v) => (Number.isFinite(v) ? v : 0);
const nz = (v) => (Math.abs(v) < 0.005 ? 0 : v); // kleine Rundungsreste als 0 anzeigen
export const round2 = (v) => Math.round(n(v) * 100) / 100 || 0; // «|| 0» vermeidet -0 (Anzeige «-0.00»)

const f2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
export const fmt = (v) => f2.format(nz(n(v)));
export const fmt0 = (v) => f0.format(Math.round(n(v)) || 0);
/** Betrag in Fremdwährung: ganze Zahlen ohne Nachkommastellen (z.B. 15'300 THB) */
export const fmtCur = (v, cur) => {
  const x = n(v);
  return (Math.abs(x - Math.round(x)) < 0.005 ? f0.format(Math.round(x)) : f2.format(x)) + (cur ? ' ' + cur : '');
};

// ---------- Datum ----------
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const toUTC = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export function addDays(s, k) {
  const d = new Date(toUTC(s) + k * 864e5);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
export const weekday = (s) => WEEKDAYS[new Date(toUTC(s)).getUTCDay()];
export const fmtDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
export const fmtDateShort = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.` : '');
export const fmtDay = (s) => (s ? `${weekday(s)} ${fmtDateShort(s)}` : '');
/** Zeitspanne kompakt: 06.–27.02.2027 · 28.01.–05.02.2027 · 28.12.2026–05.01.2027 */
export function fmtRange(a, b) {
  if (!a || !b) return fmtDate(a || b);
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${fmtDate(a)}–${fmtDate(b)}`;
  if (a.slice(0, 7) !== b.slice(0, 7)) return `${fmtDateShort(a)}–${fmtDate(b)}`;
  return `${a.slice(8, 10)}.–${fmtDate(b)}`;
}

export function tripDates(trip) {
  if (!isDate(trip.start) || !isDate(trip.end) || trip.end < trip.start) return [];
  const out = [];
  for (let d = trip.start; d <= trip.end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
export const dayNumber = (trip, date) => daysBetween(trip.start, date) + 1;

// ---------- Währungen ----------

/** CHF pro Einheit der Währung. Unbekannte Währung → NaN */
export function rateOf(settings, cur) {
  if (!cur || cur === 'CHF') return 1;
  const r = settings?.rates?.[cur]?.rate;
  return Number.isFinite(r) && r > 0 ? r : NaN;
}
export const toCHF = (settings, amount, cur) => n(amount) * n(rateOf(settings, cur));
export const fromCHF = (settings, chf, cur) => {
  const r = rateOf(settings, cur);
  return Number.isFinite(r) ? n(chf) / r : 0;
};
export function currencies(settings) {
  return ['CHF', ...Object.keys(settings?.rates || {}).filter((c) => c !== 'CHF').sort()];
}

// ---------- Posten ----------
export const isStay = (it) => isDate(it.endDate) && it.endDate > it.date;
export const nights = (it) => (isStay(it) ? daysBetween(it.date, it.endDate) : 0);
/** Alle Nächte einer Unterkunft (Datum des Abends) */
export const stayNights = (it) => {
  const out = [];
  for (let i = 0; i < nights(it); i++) out.push(addDays(it.date, i));
  return out;
};

/** Zahlung in CHF: gespeicherter (eingefrorener) Wert, sonst aktueller Kurs */
export function paymentCHF(settings, p) {
  if (Number.isFinite(p.chf)) return p.chf;
  return toCHF(settings, p.amount, p.currency);
}

/**
 * Kernberechnung pro Posten.
 * - planCHF: Planbetrag zum aktuellen Kurs
 * - paidCHF: Summe der Zahlungen (zum Kurs der Zahlung)
 * - open:    noch offener Betrag in der Planwährung
 * - totalCHF: Prognose = bezahlt + offen (offen zum aktuellen Kurs)
 */
export function itemCalc(settings, it) {
  const plan = it.plan || { amount: 0, currency: 'CHF' };
  const pAmt = n(plan.amount);
  const cur = plan.currency || 'CHF';
  const rate = rateOf(settings, cur);
  const pays = it.payments || [];
  let paidCHF = 0;
  let paidInPlan = 0;
  let floating = false; // Zahlung ohne festen Betrag in Postenwährung → Rest schwankt mit dem Kurs
  for (const p of pays) {
    const chf = paymentCHF(settings, p);
    paidCHF += chf;
    if (p.currency === cur && (n(p.amount) || !Number.isFinite(p.chf))) paidInPlan += n(p.amount);
    else {
      floating = cur !== 'CHF';
      paidInPlan += Number.isFinite(rate) ? chf / rate : 0;
    }
  }
  let open = pAmt - paidInPlan;
  if (it.done || open <= Math.max(0.005, Math.abs(pAmt) * 0.005)) open = 0;
  const openCHF = open * n(rate);
  const hasCost = Math.abs(pAmt) > 0.004 || pays.length > 0;
  let status;
  if (!hasCost) status = 'info';
  else if (open === 0 && pays.length) status = 'bezahlt';
  else if (open === 0 && it.done) status = 'bezahlt';
  else if (paidCHF > 0.004) status = 'angezahlt';
  else if (it.reserved) status = 'reserviert';
  else status = 'offen';
  const where = it.payWhere === 'vorort' ? 'vor Ort' : 'vorgängig';
  let label = STATUS[status].label;
  if (status === 'angezahlt') label = `angezahlt – Rest ${where}`;
  else if (status === 'reserviert') label = `reserviert – Zahlung ${where}`;
  else if (status === 'offen' && it.payWhere === 'vorort') label = 'offen – vor Ort';
  return {
    planCHF: round2(pAmt * n(rate)),
    paidCHF: round2(paidCHF),
    open: round2(open),
    openCHF: round2(openCHF),
    totalCHF: round2(paidCHF + openCHF),
    rateMissing: !Number.isFinite(rate) && pAmt !== 0,
    floating: floating && open > 0,
    status,
    label,
    hasCost,
  };
}

/** Verteilt die Kosten eines Postens auf Tage (Unterkunft: pro Nacht) → [[date, chf]] */
export function costByDate(settings, it, calc = itemCalc(settings, it)) {
  if (!isStay(it)) return [[it.date, calc.totalCHF]];
  const k = nights(it);
  return stayNights(it).map((d) => [d, calc.totalCHF / k]);
}

/** Datum(e), an denen ein Posten «stattfindet» (Unterkunft: jede Nacht) */
export const itemDates = (it) => (isStay(it) ? stayNights(it) : [it.date]);

// ---------- Pauschalen ----------

/** Tage, an denen eine Pauschale grundsätzlich gilt */
export function allowanceDates(trip, a) {
  const all = tripDates(trip);
  const list = a.per === 'nacht' ? all.slice(0, -1) : all;
  return list.filter((d) => !(trip.days?.[d]?.skip || []).includes(a.id));
}

/**
 * Pauschalen pro Tag.
 * - Modus «platzhalter» (z.B. Unterkunft): gilt nur, solange an dem Tag kein Posten der Kategorie existiert.
 * - Modus «tag» (Tagesbudget, z.B. Essen): Erfasste Ausgaben werden angerechnet. Für vergangene Tage
 *   mit Erfassungen zählt nur noch das Ist, sonst max(Pauschale, Ist).
 * Liefert Map date → [{allowance, budgetCHF, actualCHF, extraCHF}]; extraCHF fliesst in die Prognose.
 */
export function allowanceMap(settings, trip, today = todayStr()) {
  const out = new Map();
  const allowances = trip.allowances || [];
  if (!allowances.length) return out;
  // Ist pro Datum & Kategorie, und welche Tage überhaupt Posten einer Kategorie haben
  const actual = new Map();
  const present = new Set();
  for (const it of trip.items || []) {
    const c = itemCalc(settings, it);
    for (const d of itemDates(it)) present.add(d + '|' + it.catId);
    for (const [d, chf] of costByDate(settings, it, c)) {
      const k = d + '|' + it.catId;
      actual.set(k, (actual.get(k) || 0) + chf);
    }
  }
  for (const a of allowances) {
    const budgetCHF = toCHF(settings, a.amount, a.currency || 'CHF');
    for (const d of allowanceDates(trip, a)) {
      const k = d + '|' + a.catId;
      const act = actual.get(k) || 0;
      let extra;
      if (a.mode === 'platzhalter') extra = present.has(k) ? 0 : budgetCHF;
      else if (d < today && act > 0) extra = 0;
      else extra = Math.max(0, budgetCHF - act);
      if (!out.has(d)) out.set(d, []);
      out.get(d).push({ allowance: a, budgetCHF: round2(budgetCHF), actualCHF: round2(act), extraCHF: round2(extra) });
    }
  }
  return out;
}

// ---------- Zusammenfassung einer Reise ----------
export function tripSummary(settings, trip, today = todayStr()) {
  const items = trip.items || [];
  const calcs = new Map(items.map((it) => [it.id, itemCalc(settings, it)]));
  const allow = allowanceMap(settings, trip, today);
  const byCat = new Map();
  const byDay = new Map();
  const byPlace = new Map();
  const add = (map, key, field, v) => {
    if (!map.has(key)) map.set(key, { total: 0, paid: 0, open: 0, allowance: 0 });
    map.get(key)[field] += v;
  };
  let total = 0, paid = 0, open = 0, allowance = 0, missingRates = 0;
  for (const it of items) {
    const c = calcs.get(it.id);
    if (c.rateMissing) missingRates++;
    total += c.totalCHF;
    paid += c.paidCHF;
    open += c.openCHF;
    add(byCat, it.catId || 'sonstiges', 'total', c.totalCHF);
    add(byCat, it.catId || 'sonstiges', 'paid', c.paidCHF);
    add(byCat, it.catId || 'sonstiges', 'open', c.openCHF);
    for (const [d, chf] of costByDate(settings, it, c)) {
      add(byDay, d, 'total', chf);
      add(byPlace, placeFor(trip, it, d) || '—', 'total', chf);
    }
  }
  for (const [d, list] of allow) {
    for (const x of list) {
      if (!x.extraCHF) continue;
      allowance += x.extraCHF;
      add(byCat, x.allowance.catId || 'sonstiges', 'allowance', x.extraCHF);
      add(byDay, d, 'allowance', x.extraCHF);
      add(byPlace, placeFor(trip, null, d) || '—', 'allowance', x.extraCHF);
    }
  }
  const forecast = total + allowance;
  const travelers = trip.split?.enabled ? (trip.split.participants || []).length || 1 : Math.max(1, Number(trip.travelers) || 1);
  return {
    calcs, allow, byCat, byDay, byPlace,
    total: round2(total), paid: round2(paid), open: round2(open), allowance: round2(allowance),
    forecast: round2(forecast), perPerson: round2(forecast / travelers), travelers, missingRates,
  };
}

/** Ort eines Tages: Tagesangabe, sonst Ort der Unterkunft dieser Nacht, sonst Ort des Postens */
export function placeFor(trip, it, date) {
  const day = trip.days?.[date];
  if (day?.place) return day.place;
  const stay = stayFor(trip, date) || stayFor(trip, addDays(date, -1));
  if (stay?.place) return stay.place;
  return it?.place || '';
}
/** Währung vor Ort eines Tages (für Pauschalen): Tageseinstellung, sonst Reisewährung */
export const dayCurrency = (trip, date) => trip.days?.[date]?.currency || trip.currency || 'CHF';

/** Unterkunft für die Nacht von «date» */
export const stayFor = (trip, date) => (trip.items || []).find((it) => isStay(it) && it.date <= date && it.endDate > date);

// ---------- Zahlungen: Kalender, Bargeld, Bezahlmethoden ----------

/** Offene Posten, die vorgängig bezahlt werden (Zahlungskalender) – sortiert nach Fälligkeit */
export function dueList(settings, trip) {
  return (trip.items || [])
    .map((it) => ({ it, c: itemCalc(settings, it) }))
    .filter(({ it, c }) => c.open > 0 && it.payWhere !== 'vorort')
    .sort((a, b) => (a.it.dueDate || '9999') .localeCompare(b.it.dueDate || '9999') || a.it.date.localeCompare(b.it.date));
}

/**
 * Bargeld-/Vor-Ort-Planer: offene Beträge, die vor Ort bezahlt werden, gruppiert nach Währung
 * und Ort. Optional inkl. Pauschalen (in der Hauptwährung der Reise).
 */
export function cashPlan(settings, trip, { withAllowances = false, from = '', today = todayStr() } = {}) {
  // Alles erscheint in der «Währung vor Ort» des jeweiligen Tages (pro Tag einstellbar, Standard: Reisewährung),
  // z.B. Reisetage in der Schweiz auf CHF. Posten in anderer Währung werden umgerechnet, der erfasste Betrag
  // bleibt als origAmount/origCurrency erhalten. Jede Zeile führt zusätzlich ihren CHF-Wert mit.
  const groups = new Map(); // currency → {currency, total, rows:[{date, place, title, amount, chf, origAmount, origCurrency}]}
  const push = (cur, row) => {
    if (!groups.has(cur)) groups.set(cur, { currency: cur, total: 0, chf: 0, rows: [] });
    const g = groups.get(cur);
    g.total += row.amount;
    g.chf += row.chf;
    g.rows.push(row);
  };
  for (const it of trip.items || []) {
    if (it.payWhere !== 'vorort') continue;
    if (from && it.date < from) continue;
    const c = itemCalc(settings, it);
    if (c.open <= 0) continue;
    // In der Währung vor Ort des Tages; weicht der Posten davon ab, wird umgerechnet (Original bleibt sichtbar)
    const cur = it.plan.currency || 'CHF';
    const dc = dayCurrency(trip, it.date);
    const base = { date: it.date, place: placeFor(trip, it, it.date), title: it.title, itemId: it.id, chf: c.openCHF };
    if (cur === dc || c.rateMissing || !Number.isFinite(rateOf(settings, dc))) push(cur, { ...base, amount: c.open });
    else push(dc, { ...base, amount: dc === 'CHF' ? round2(c.openCHF) : Math.round(fromCHF(settings, c.openCHF, dc)), origAmount: c.open, origCurrency: cur });
  }
  if (withAllowances) {
    for (const [d, list] of allowanceMap(settings, trip, today)) {
      if (from && d < from) continue;
      // Währung vor Ort dieses Tages (Standard: Reisewährung); ohne Kurs → CHF
      let cur = dayCurrency(trip, d);
      if (!Number.isFinite(rateOf(settings, cur))) cur = 'CHF';
      for (const x of list) {
        if (!x.extraCHF) continue;
        // Pauschalen sind Schätzungen → in Fremdwährung auf ganze Einheiten runden
        const amount = cur === 'CHF' ? round2(x.extraCHF) : Math.round(fromCHF(settings, x.extraCHF, cur));
        push(cur, { date: d, place: placeFor(trip, null, d), title: x.allowance.label, amount, chf: x.extraCHF, allowance: true, allowanceId: x.allowance.id });
      }
    }
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.total = round2(g.total);
    g.chf = round2(g.chf);
    g.rows.sort((a, b) => a.date.localeCompare(b.date));
    // Stationen: aufeinanderfolgende Tage am selben Ort = ein Abschnitt; fixe Beträge und Pauschalen getrennt
    g.places = [];
    g.fixed = 0;
    g.allowance = 0;
    g.fixedChf = 0;
    g.allowanceChf = 0;
    for (const r of g.rows) {
      const k = r.place || '—';
      let p = g.places[g.places.length - 1];
      if (!p || p.place !== k) g.places.push((p = { place: k, from: r.date, to: r.date, total: 0, chf: 0, fixed: 0, fixedChf: 0, allowance: 0, allowanceChf: 0, rows: [] }));
      p.rows.push(r);
      p.total = round2(p.total + r.amount);
      p.chf = round2(p.chf + r.chf);
      if (r.allowance) {
        p.allowance = round2(p.allowance + r.amount);
        p.allowanceChf = round2(p.allowanceChf + r.chf);
      } else {
        p.fixed = round2(p.fixed + r.amount);
        p.fixedChf = round2(p.fixedChf + r.chf);
      }
      if (r.date > p.to) p.to = r.date;
    }
    for (const p of g.places) {
      g.fixed = round2(g.fixed + p.fixed);
      g.allowance = round2(g.allowance + p.allowance);
      g.fixedChf = round2(g.fixedChf + p.fixedChf);
      g.allowanceChf = round2(g.allowanceChf + p.allowanceChf);
    }
  }
  return out.sort((a, b) => b.chf - a.chf);
}

/** Abrechnung pro Bezahlmethode: bezahlt (Zahlungen) und geplant (offene Posten mit vorgesehener Methode) */
export function byMethod(settings, trip) {
  const map = new Map();
  const get = (id) => {
    if (!map.has(id)) map.set(id, { methodId: id, paid: 0, planned: 0, count: 0 });
    return map.get(id);
  };
  for (const it of trip.items || []) {
    for (const p of it.payments || []) {
      const m = get(p.methodId || '');
      m.paid += paymentCHF(settings, p);
      m.count++;
    }
    const c = itemCalc(settings, it);
    if (c.openCHF > 0) get(it.payWhere === 'vorort' ? it.dueMethodId || 'vorort' : it.dueMethodId || '').planned += c.openCHF;
  }
  const out = [...map.values()];
  for (const m of out) {
    m.paid = round2(m.paid);
    m.planned = round2(m.planned);
  }
  return out;
}

/** Wie oft eine Bezahlmethode verwendet wird (Zahlungen und «Wird bezahlt mit»), über alle Reisen */
export function methodUsage(trips, methodId) {
  let n = 0;
  for (const t of trips || []) for (const it of t.items || []) {
    if (it.dueMethodId === methodId) n++;
    for (const p of it.payments || []) if (p.methodId === methodId) n++;
  }
  return n;
}

/**
 * Was noch offen ist, aufgeschlüsselt (alles in CHF) – dieselben Zahlen wie Plan, Offen und Auswertung:
 * vorgängig (Zahlungskalender) + vor Ort (Posten) + Pauschalen = total
 */
export function openBreakdown(settings, trip, today = todayStr()) {
  let vorgaengig = 0, vorort = 0;
  for (const it of trip.items || []) {
    const c = itemCalc(settings, it);
    if (c.openCHF <= 0) continue;
    if (it.payWhere === 'vorort') vorort += c.openCHF;
    else vorgaengig += c.openCHF;
  }
  let allowance = 0;
  for (const list of allowanceMap(settings, trip, today).values()) for (const x of list) allowance += x.extraCHF;
  return { vorgaengig: round2(vorgaengig), vorort: round2(vorort), allowance: round2(allowance), total: round2(vorgaengig + vorort + allowance) };
}

// ---------- Kostenaufteilung ----------

/** Anteile eines Postens pro Teilnehmer (Summe = 1). Ohne Angabe: gleichmässig auf alle. */
export function shares(it, participants) {
  const ids = participants.map((p) => p.id);
  const sp = it.split;
  const out = {};
  if (!ids.length) return out;
  if (sp && (sp.mode === 'shares' || sp.mode === 'amounts') && sp.values) {
    const vals = ids.map((id) => Math.max(0, n(Number(sp.values[id]))));
    const sum = vals.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      ids.forEach((id, i) => (out[id] = vals[i] / sum));
      return out;
    }
  }
  if (sp && sp.mode === 'equal' && Array.isArray(sp.members) && sp.members.length) {
    const members = sp.members.filter((id) => ids.includes(id));
    if (members.length) {
      for (const id of ids) out[id] = members.includes(id) ? 1 / members.length : 0;
      return out;
    }
  }
  for (const id of ids) out[id] = 1 / ids.length;
  return out;
}

/**
 * Abrechnung unter den Teilnehmern.
 * Grundlage sind die effektiv geleisteten Zahlungen: wer hat bezahlt (paidBy) vs. welcher Anteil
 * entfällt auf wen. Bei «amounts» wird der Anteil proportional zu den eingegebenen Beträgen verteilt.
 * Zusätzlich: Prognose-Anteil inkl. offener Beträge und Pauschalen.
 */
export function settlement(settings, trip, today = todayStr()) {
  const parts = trip.split?.participants || [];
  const res = Object.fromEntries(parts.map((p) => [p.id, { id: p.id, name: p.name, paid: 0, share: 0, forecastShare: 0 }]));
  let unassigned = 0;
  for (const it of trip.items || []) {
    const c = itemCalc(settings, it);
    const sh = shares(it, parts);
    for (const p of it.payments || []) {
      const chf = paymentCHF(settings, p);
      if (p.paidBy && res[p.paidBy]) res[p.paidBy].paid += chf;
      else unassigned += chf;
    }
    for (const [id, f] of Object.entries(sh)) {
      res[id].share += c.paidCHF * f;
      res[id].forecastShare += c.totalCHF * f;
    }
  }
  // Pauschalen gleichmässig
  let allowance = 0;
  for (const list of allowanceMap(settings, trip, today).values()) for (const x of list) allowance += x.extraCHF;
  for (const r of Object.values(res)) r.forecastShare += parts.length ? allowance / parts.length : 0;
  // Rückzahlungen unter den Teilnehmenden: wer zurückzahlt, hat mehr beigetragen; wer erhält, weniger
  for (const r of Object.values(res)) r.repaid = 0;
  const repayments = (trip.repayments || []).filter((x) => res[x.from] && res[x.to] && x.amount > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  for (const x of repayments) {
    res[x.from].repaid += x.amount;
    res[x.to].repaid -= x.amount;
  }
  const people = Object.values(res).map((r) => ({
    ...r, paid: round2(r.paid), share: round2(r.share), repaid: round2(r.repaid), forecastShare: round2(r.forecastShare),
    balance: round2(r.paid + r.repaid - r.share),
  }));
  return { people, transfers: minimizeTransfers(people), unassigned: round2(unassigned), repayments };
}

/** Möglichst wenige Überweisungen: grösster Schuldner zahlt grösstem Gläubiger */
export function minimizeTransfers(people) {
  const debt = people.filter((p) => p.balance < -0.005).map((p) => ({ id: p.id, name: p.name, v: -p.balance }));
  const cred = people.filter((p) => p.balance > 0.005).map((p) => ({ id: p.id, name: p.name, v: p.balance }));
  const out = [];
  while (debt.length && cred.length) {
    debt.sort((a, b) => b.v - a.v);
    cred.sort((a, b) => b.v - a.v);
    const d = debt[0], c = cred[0];
    const v = Math.min(d.v, c.v);
    out.push({ from: d.id, fromName: d.name, to: c.id, toName: c.name, amount: round2(v) });
    d.v -= v;
    c.v -= v;
    if (d.v < 0.005) debt.shift();
    if (c.v < 0.005) cred.shift();
  }
  return out;
}

// ---------- To-dos ----------
export function todoList(trip) {
  const out = [];
  for (const it of trip.items || []) for (const t of it.todos || []) out.push({ todo: t, item: it });
  return out.sort((a, b) => Number(a.todo.done) - Number(b.todo.done) || (a.todo.due || '9999').localeCompare(b.todo.due || '9999') || a.item.date.localeCompare(b.item.date));
}

// ---------- Vorlage / Kopie ----------

/**
 * Kopiert eine Reise als Vorlage. Daten werden auf den neuen Start verschoben.
 * opts.keepItems: Posten übernehmen (ohne Zahlungen, Belege und erledigte To-dos)
 */
export function copyTrip(trip, { name, start, keepItems = true, newId }) {
  const shift = isDate(start) ? daysBetween(trip.start, start) : 0;
  const mv = (d) => (isDate(d) ? addDays(d, shift) : d);
  const days = {};
  for (const [d, v] of Object.entries(trip.days || {})) days[mv(d)] = { ...v, skip: [...(v.skip || [])] };
  return {
    id: newId(),
    name: name || trip.name + ' (Kopie)',
    start: mv(trip.start),
    end: mv(trip.end),
    currency: trip.currency,
    travelers: trip.travelers,
    note: trip.note || '',
    allowances: (trip.allowances || []).map((a) => ({ ...a })),
    days: keepItems ? days : {},
    split: { enabled: !!trip.split?.enabled, participants: (trip.split?.participants || []).map((p) => ({ ...p })) },
    items: keepItems
      ? (trip.items || []).map((it) => ({
          ...structuredClone(it),
          id: newId(),
          date: mv(it.date),
          endDate: mv(it.endDate),
          dueDate: '',
          payments: [],
          files: [],
          done: false,
          reserved: false,
          todos: (it.todos || []).map((t) => ({ ...t, id: newId(), done: false, due: mv(t.due) })),
        }))
      : [],
    createdAt: new Date().toISOString(),
  };
}

// ---------- Posten zusammenführen ----------

/**
 * Führt «other» in «target» zusammen (z.B. Anzahlung + Restzahlung als zwei Posten → ein Posten mit zwei Zahlungen).
 * Planbetrag = Summe beider, umgerechnet in die Währung von target. Zahlungen, To-dos, Belege und Notizen werden vereint.
 * Liefert den neuen target (other wird vom Aufrufer gelöscht).
 */
export function mergeItems(settings, target, other) {
  const cur = target.plan?.currency || 'CHF';
  const oCur = other.plan?.currency || 'CHF';
  const oAmt = n(other.plan?.amount);
  const add = oCur === cur ? oAmt : fromCHF(settings, toCHF(settings, oAmt, oCur), cur);
  const factor = oCur === cur ? 1 : oAmt ? add / oAmt : fromCHF(settings, toCHF(settings, 1, oCur), cur);
  // Zahlungen des anderen Postens werden mit demselben Faktor fest in die Zielwährung übernommen,
  // damit der Rest nicht mit dem Kurs schwankt. Der effektiv belastete CHF-Betrag bleibt.
  const moved = (other.payments || []).map((p) => {
    if (p.currency === cur) return p;
    const chf = Number.isFinite(p.chf) ? p.chf : toCHF(settings, p.amount, p.currency);
    const amount = p.currency === oCur ? n(p.amount) * factor : fromCHF(settings, chf, cur);
    return { ...p, amount: round2(amount), currency: cur, chf: round2(chf) };
  });
  const join = (a, b) => [a, b].filter((x) => x && x.trim()).join(' · ');
  return {
    ...target,
    plan: { amount: round2(n(target.plan?.amount) + add), currency: cur },
    reserved: !!(target.reserved || other.reserved),
    dueDate: target.dueDate || other.dueDate || '',
    dueMethodId: target.dueMethodId || other.dueMethodId || '',
    payments: [...(target.payments || []), ...moved],
    todos: [...(target.todos || []), ...(other.todos || [])],
    files: [...(target.files || []), ...(other.files || [])],
    note: join(target.note, other.note),
    detail: target.detail || other.detail || '',
    link: target.link || other.link || '',
    done: false,
  };
}

// ---------- Zahlungen für Kässeli ----------

/**
 * Bisherige Zahlungen als CSV (Semikolon, UTF-8 mit BOM) für den Import in Kässeli.
 * Kässeli erkennt «Datum», «Buchungstext» und «Betrag» automatisch; Ausgaben sind positiv.
 * Zahlungen ohne Datum werden nicht exportiert (Kässeli braucht ein Datum) und separat gemeldet.
 * opts.methodId: nur diese Methode ('' = ohne Methode, undefined = alle)
 */
export function paymentsCsv(settings, trips, { methodId } = {}) {
  const meth = (id) => settings.methods?.find((m) => m.id === id)?.name || '';
  const cat = (id) => settings.categories?.find((c) => c.id === id)?.name || '';
  const q = (v) => {
    const x = String(v ?? '');
    return /[;"\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  };
  const rows = [];
  const undated = [];
  for (const t of trips) for (const it of t.items || []) for (const p of it.payments || []) {
    if (methodId !== undefined && (p.methodId || '') !== methodId) continue;
    const chf = paymentCHF(settings, p);
    if (!chf) continue;
    if (!isDate(p.date)) { undated.push({ trip: t, item: it, payment: p }); continue; }
    rows.push({ t, it, p, chf });
  }
  // Bargeldbezüge belasten die Karte bzw. das Konto – als eigene Zeile «Bargeldbezug»
  for (const t of trips) for (const c of t.cash || []) {
    if (c.kind !== 'bezug' || !(c.chf > 0)) continue;
    if (methodId !== undefined && (c.methodId || '') !== methodId) continue;
    const p = { date: c.date, amount: c.amount, currency: c.currency, chf: c.chf, methodId: c.methodId, note: c.note };
    const it = { title: `Bargeldbezug ${c.currency} ${fmt0(c.amount)}`, catId: '' };
    if (!isDate(c.date)) continue;
    rows.push({ t, it, p, chf: c.chf });
  }
  rows.sort((a, b) => a.p.date.localeCompare(b.p.date) || a.it.title.localeCompare(b.it.title));
  const head = ['Datum', 'Buchungstext', 'Betrag CHF', 'Bezahlmethode', 'Reise', 'Posten', 'Kategorie', 'Originalbetrag', 'Währung', 'Notiz'];
  const lines = rows.map(({ t, it, p, chf }) => [
    fmtDate(p.date), `${t.name}: ${it.title}`, round2(chf).toFixed(2), meth(p.methodId), t.name, it.title, cat(it.catId),
    p.currency !== 'CHF' ? round2(p.amount).toFixed(2) : '', p.currency !== 'CHF' ? p.currency : '', p.note || '',
  ]);
  const csv = '\ufeff' + [head, ...lines].map((r) => r.map(q).join(';')).join('\r\n');
  return { csv, count: rows.length, total: round2(rows.reduce((a, r) => a + r.chf, 0)), undated };
}

// ---------- Export ----------

/** CSV (Semikolon, für Excel CH) mit allen Posten einer Reise */
export function tripCsv(settings, trip) {
  const cat = (id) => settings.categories?.find((c) => c.id === id)?.name || id || '';
  const meth = (id) => settings.methods?.find((m) => m.id === id)?.name || id || '';
  const q = (v) => {
    const s = String(v ?? '');
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const num = (v) => String(round2(v)).replace('.', '.');
  const rows = [['Datum', 'Bis', 'Zeit', 'Titel', 'Detail', 'Kategorie', 'Ort', 'Planbetrag', 'Währung', 'Plan CHF', 'Bezahlt CHF', 'Offen', 'Total CHF', 'Status', 'Bezahlt mit', 'Fällig am', 'Notiz', 'Link']];
  const items = [...(trip.items || [])].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  for (const it of items) {
    const c = itemCalc(settings, it);
    const methods = [...new Set((it.payments || []).map((p) => meth(p.methodId)))].join(', ');
    rows.push([it.date, it.endDate || '', it.time || '', it.title, it.detail || '', cat(it.catId), placeFor(trip, it, it.date), num(it.plan?.amount), it.plan?.currency || 'CHF', num(c.planCHF), num(c.paidCHF), num(c.open), num(c.totalCHF), c.label, methods, it.dueDate || '', it.note || '', it.link || '']);
  }
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}

// ---------- Bargeld-Kasse ----------

/** Zählt eine Bezahlmethode als Bargeld? Ausdrücklich gesetzt, sonst nach Name («Bar», «Bargeld», «Cash») */
export const isCashMethod = (m) => !!m && (typeof m.cash === 'boolean' ? m.cash : /^(bar|cash)/i.test(m.name || ''));

/**
 * Portemonnaie pro Währung: Bezüge/Anfangsbestand minus bar bezahlte Ausgaben (Zahlungen mit Bargeld-Methode)
 * minus Rücktausch, plus Korrekturen aus dem Kassensturz.
 * Nur Währungen mit mindestens einem Kassen-Eintrag erscheinen.
 * Liefert [{currency, inflow, inflowChf, spent, out, adjust, balance, rate (CHF pro Einheit inkl. Gebühren | null),
 *           entries, payments:[{date, title, amount}]}]
 */
export function cashWallet(settings, trip) {
  const cashIds = new Set((settings.methods || []).filter(isCashMethod).map((m) => m.id));
  const pots = new Map();
  const pot = (cur) => {
    if (!pots.has(cur)) pots.set(cur, { currency: cur, inflow: 0, inflowChf: 0, inflowWithChf: 0, spent: 0, out: 0, adjust: 0, entries: [], payments: [] });
    return pots.get(cur);
  };
  for (const c of trip.cash || []) {
    const p = pot(c.currency);
    p.entries.push(c);
    if (c.kind === 'bezug' || c.kind === 'start') {
      p.inflow += n(c.amount);
      if (Number.isFinite(c.chf) && c.chf > 0) { p.inflowChf += c.chf; p.inflowWithChf += n(c.amount); }
    } else if (c.kind === 'zurueck') p.out += n(c.amount);
    else if (c.kind === 'korrektur') p.adjust += n(c.amount);
  }
  for (const it of trip.items || []) for (const pay of it.payments || []) {
    if (!cashIds.has(pay.methodId) || !pots.has(pay.currency)) continue;
    const p = pots.get(pay.currency);
    p.spent += n(pay.amount);
    p.payments.push({ date: pay.date, title: it.title, amount: n(pay.amount), itemId: it.id });
  }
  return [...pots.values()].map((p) => ({
    ...p,
    inflow: round2(p.inflow), spent: round2(p.spent), out: round2(p.out), adjust: round2(p.adjust),
    balance: round2(p.inflow - p.spent - p.out + p.adjust),
    rate: p.inflowWithChf > 0 ? p.inflowChf / p.inflowWithChf : null,
    entries: p.entries.sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    payments: p.payments.sort((a, b) => (a.date || '').localeCompare(b.date || '')),
  })).sort((a, b) => (a.currency === trip.currency ? -1 : b.currency === trip.currency ? 1 : a.currency.localeCompare(b.currency)));
}
