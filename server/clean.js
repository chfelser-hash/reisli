// Prüft und bereinigt alles, was vom Browser kommt, bevor es gespeichert wird.
import { httpError } from './auth.js';
import { newId, migrateTrip } from './store.js';

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const str = (v, max = 300) => String(v ?? '').slice(0, max);
const optDate = (v) => (isDate(v) ? v : '');
const id = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : newId());
const cur = (v) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : 'CHF');
const num = (v, def = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : def;
};
const color = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#64748b');

export function cleanPayment(p) {
  const chf = Number(p.chf);
  return {
    id: id(p.id),
    date: optDate(p.date),
    amount: num(p.amount),
    currency: cur(p.currency),
    chf: Number.isFinite(chf) ? Math.round(chf * 100) / 100 : null,
    methodId: str(p.methodId, 40),
    paidBy: str(p.paidBy, 40),
    note: str(p.note, 200),
  };
}

export function cleanItem(input, user, existing = {}) {
  if (!isDate(input.date)) throw httpError(400, 'Datum ungültig');
  const title = str(input.title, 160).trim();
  if (!title) throw httpError(400, 'Titel fehlt');
  const endDate = isDate(input.endDate) && input.endDate > input.date ? input.endDate : '';
  const split = input.split && typeof input.split === 'object' && ['equal', 'shares', 'amounts'].includes(input.split.mode)
    ? {
        mode: input.split.mode,
        values: Object.fromEntries(Object.entries(input.split.values || {}).slice(0, 30).map(([k, v]) => [str(k, 40), num(v)])),
        members: Array.isArray(input.split.members) ? input.split.members.slice(0, 30).map((x) => str(x, 40)) : [],
      }
    : null;
  return {
    id: existing.id || id(input.id),
    date: input.date,
    endDate,
    time: /^\d{2}:\d{2}$/.test(input.time || '') ? input.time : '',
    title,
    detail: str(input.detail, 200),
    catId: str(input.catId, 40) || 'sonstiges',
    place: str(input.place, 80),
    plan: { amount: num(input.plan?.amount), currency: cur(input.plan?.currency) },
    reserved: !!input.reserved,
    payWhere: input.payWhere === 'vorort' ? 'vorort' : 'vorgaengig',
    dueDate: optDate(input.dueDate),
    dueMethodId: str(input.dueMethodId, 40),
    payments: (Array.isArray(input.payments) ? input.payments : []).slice(0, 50).map(cleanPayment),
    done: !!input.done,
    link: /^https?:\/\//i.test(input.link || '') ? str(input.link, 500) : '',
    note: str(input.note, 2000),
    todos: (Array.isArray(input.todos) ? input.todos : []).slice(0, 50).map((t) => ({ id: id(t.id), text: str(t.text, 200), due: optDate(t.due), done: !!t.done })).filter((t) => t.text.trim()),
    // Belege werden nur über die Datei-API geändert – hier immer den gespeicherten Stand behalten
    files: existing.files || (Array.isArray(input.files) && !existing.id ? input.files.filter((f) => f && /^[\w-]+$/.test(f.id)).map((f) => ({ id: f.id, name: str(f.name, 160), size: Number(f.size) || 0, type: str(f.type, 80) })) : []),
    split,
    by: existing.by || user?.name || '',
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: existing.id ? new Date().toISOString() : undefined,
  };
}

export function cleanAllowance(a) {
  return {
    id: id(a.id),
    label: str(a.label, 60).trim() || 'Pauschale',
    catId: str(a.catId, 40) || 'sonstiges',
    amount: num(a.amount),
    currency: cur(a.currency),
    mode: a.mode === 'platzhalter' ? 'platzhalter' : 'tag',
    per: a.per === 'nacht' ? 'nacht' : 'tag',
  };
}

/** Kopfdaten einer Reise (ohne Posten und Tage) */
export function cleanTripMeta(input, existing = {}) {
  const name = str(input.name ?? existing.name, 80).trim();
  if (!name) throw httpError(400, 'Name fehlt');
  const start = input.start ?? existing.start;
  const end = input.end ?? existing.end;
  if (!isDate(start) || !isDate(end) || end < start) throw httpError(400, 'Reisedaten ungültig');
  if ((Date.parse(end) - Date.parse(start)) / 864e5 > 365) throw httpError(400, 'Reise darf höchstens ein Jahr dauern');
  const split = input.split ?? existing.split ?? {};
  return {
    name,
    start,
    end,
    currency: cur(input.currency ?? existing.currency),
    travelers: Math.max(1, Math.min(50, Number(input.travelers ?? existing.travelers) || 2)),
    note: str(input.note ?? existing.note, 4000),
    allowances: (Array.isArray(input.allowances) ? input.allowances : existing.allowances || []).slice(0, 20).map(cleanAllowance),
    split: {
      enabled: !!split.enabled,
      participants: (Array.isArray(split.participants) ? split.participants : []).slice(0, 30).map((p) => ({ id: id(p.id), name: str(p.name, 40).trim() || 'Person' })),
    },
    archived: !!(input.archived ?? existing.archived),
  };
}

export function cleanRepayment(r) {
  const amount = num(r.amount);
  if (!(amount > 0)) throw httpError(400, 'Betrag ungültig');
  if (!r.from || !r.to || r.from === r.to) throw httpError(400, 'Von und An müssen zwei verschiedene Personen sein');
  return { id: id(r.id), date: optDate(r.date), from: str(r.from, 40), to: str(r.to, 40), amount, methodId: str(r.methodId, 40), note: str(r.note, 200) };
}

export function cleanDay(input) {
  return {
    title: str(input.title, 200),
    place: str(input.place, 80),
    note: str(input.note, 1000),
    skip: Array.isArray(input.skip) ? input.skip.slice(0, 20).map((x) => str(x, 40)) : [],
    // Währung vor Ort für Pauschalen an diesem Tag ('' = Reisewährung)
    currency: typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency) ? input.currency : '',
  };
}

/** Ganze Reise (Import, Vorlage, Einzel-Sicherung) */
export function cleanTrip(input, user) {
  if (!input || typeof input !== 'object') throw httpError(400, 'Reise ungültig');
  const meta = cleanTripMeta(input);
  const days = {};
  for (const [d, v] of Object.entries(input.days || {})) if (isDate(d) && v && typeof v === 'object') days[d] = cleanDay(v);
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 3000).map((it) => cleanItem(it, user));
  const repayments = [];
  for (const r of Array.isArray(input.repayments) ? input.repayments.slice(0, 500) : []) {
    try { repayments.push(cleanRepayment(r)); } catch { /* ungültige überspringen */ }
  }
  return migrateTrip({ id: id(input.id), ...meta, days, items, repayments, createdAt: input.createdAt || new Date().toISOString(), source: str(input.source, 60) });
}

export function cleanSettings(b, current) {
  const out = { ...current };
  if (Array.isArray(b.methods)) {
    out.methods = b.methods.slice(0, 50).map((m) => ({ id: id(m.id), name: str(m.name, 60).trim() })).filter((m) => m.name);
  }
  if (Array.isArray(b.categories)) {
    out.categories = b.categories.slice(0, 40).map((c) => ({ id: id(c.id), name: str(c.name, 60).trim(), color: color(c.color) })).filter((c) => c.name);
    if (!out.categories.length) throw httpError(400, 'Mindestens eine Kategorie nötig');
  }
  if (b.rates && typeof b.rates === 'object') {
    out.rates = {};
    for (const [k, v] of Object.entries(b.rates).slice(0, 60)) {
      if (!/^[A-Z]{3}$/.test(k) || k === 'CHF') continue;
      const rate = Number(v?.rate);
      if (!(rate > 0)) continue;
      out.rates[k] = { rate, source: str(v.source, 40) || 'manuell', locked: !!v.locked, updatedAt: v.updatedAt ? str(v.updatedAt, 40) : undefined };
    }
  }
  return out;
}
