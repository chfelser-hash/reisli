// «Buchung importieren»: Bestätigung (E-Mail, PDF, Text) lesen und Feld für Feld übernehmen.
// Neue Buchungen werden Posten, bekannte (gleiche Buchungsnummer) werden aktualisiert, Stornierungen vorgeschlagen.
import { h, toast, modal } from '../ui.js';
import { state, api, settings, render, go, newId, selectTrip } from '../app.js';
import { readSource, parseBooking } from '../booking-parse.js';
import { fmtCur, fmtDate, fmtDay, todayStr, addDays, isDate, evalExpr, round2, isCashMethod } from '../calc.js';

const norm = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

// ---------- Schritt 1: Quelle wählen ----------
export async function importDialog(shared = null) {
  if (shared) return review(shared);
  let picked = null;
  const err = h('p', { class: 'form-error' });
  const info = h('p', { class: 'muted small' });
  const text = h('textarea', { rows: 7, placeholder: 'Text der Bestätigung hier einfügen (in der Mail alles markieren, kopieren, einfügen) …' });
  const file = h('input', { type: 'file', class: 'file-input', accept: '.eml,.msg,.pdf,.txt,.html,.htm,message/rfc822,application/vnd.ms-outlook,application/pdf,text/plain,text/html', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    picked = { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) };
    info.textContent = `Datei: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`;
  } });
  const drop = h('label', { class: 'drop-zone' },
    h('strong', null, 'Datei wählen'), h('span', { class: 'muted small' }, ' oder hierher ziehen: E-Mail (.eml, Outlook .msg), PDF, HTML, Text'), file);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) {
      picked = { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) };
      info.textContent = `Datei: ${f.name}`;
    } else if (e.dataTransfer.getData('text')) text.value = e.dataTransfer.getData('text');
  });
  const content = h('div', { class: 'stack import-src' },
    h('p', { class: 'muted small' }, 'Bestätigungen von Booking.com, Agoda, Hotels.com, trivago, Expedia, Airbnb sowie Flugbuchungen (SWISS, Edelweiss, Thai, Singapore …), deutsch oder englisch. Alles wird hier im Browser gelesen – nichts geht an fremde Dienste.'),
    drop, info,
    h('div', { class: 'or' }, 'oder'),
    text,
    h('details', { class: 'help' }, h('summary', null, 'Wie komme ich an die Mail?'),
      h('ul', { class: 'small' },
        h('li', null, h('strong', null, 'Handy: '), 'In der Mail-App den Text markieren und kopieren, hier einfügen. Oder das PDF (E-Ticket) über «Teilen → Reisli» schicken.'),
        h('li', null, h('strong', null, 'Gmail im Browser: '), '⋮ → «Original herunterladen» → .eml-Datei hier wählen.'),
        h('li', null, h('strong', null, 'Outlook: '), 'Mail auf den Desktop ziehen (.msg) und hier wählen oder hineinziehen.'))),
    err
  );
  const res = await modal('Buchung importieren', content, [
    { label: 'Abbrechen', value: null },
    { label: 'Erkennen', primary: true, onClick: () => {
      if (picked) return { file: picked };
      if (text.value.trim().length > 20) return { text: text.value };
      err.textContent = 'Bitte eine Datei wählen oder den Text der Bestätigung einfügen.';
      return false;
    } },
  ]);
  if (res) await review(res.file ? { file: res.file } : { text: res.text });
}

// ---------- Schritt 2: erkennen und Feld für Feld übernehmen ----------
async function review(input) {
  const file = input.file || (input.files?.[0]) || null;
  const pasted = input.text || '';
  let src;
  try {
    src = file ? await readSource(file) : await readSource({ text: pasted });
    if (file && input.text) src.text = `${input.text}\n\n${src.text}`; // geteilter Text + Datei
  } catch (e) {
    return toast('Datei konnte nicht gelesen werden: ' + e.message, { error: true });
  }
  if (src.unreadable) toast('Aus dem PDF liess sich kaum Text lesen – Felder bitte von Hand ergänzen oder den Text der Mail einfügen.', { error: true, duration: 8000 });
  const refYear = Number((state.data.trips.find((t) => t.end >= todayStr())?.start || todayStr()).slice(0, 4));
  const r = parseBooking(src, refYear);
  const beleg = file ? { name: file.name || 'buchung', type: file.type || (src.kind === 'pdf' ? 'application/pdf' : 'message/rfc822'), bytes: file.bytes }
    : { name: `${(r.provider?.name || 'Buchung').replace(/\W+/g, '-')}-${todayStr()}.txt`, type: 'text/plain', bytes: new TextEncoder().encode(pasted) };

  const mainDate = r.kind === 'flight' ? r.fields.segments?.[0]?.date : r.fields.checkIn;
  let tripId = suggestTrip(mainDate);
  const body = h('div', { class: 'import-review' });
  const draw = () => body.replaceChildren(...reviewContent(r, tripId, (id) => { tripId = id; draw(); }));
  draw();
  const ok = await modal(`${r.provider?.name || 'Buchung'} – ${r.kind === 'flight' ? 'Flug' : r.kind === 'hotel' ? 'Unterkunft' : 'unbekannt'}${r.status === 'cancelled' ? ' (storniert)' : ''}`, body, [
    { label: 'Abbrechen', value: null },
    { label: 'Übernehmen', primary: true, onClick: async () => {
      try {
        const msg = await apply(r, tripId, body, beleg);
        toast(msg, { duration: 6000, action: { label: 'Anzeigen', fn: () => { selectTrip(tripId); go('plan'); } } });
        return 'ok';
      } catch (e) {
        body.querySelector('.form-error').textContent = e.message;
        return false;
      }
    } },
  ]);
  if (ok) render();
}

/** Reise mit dem Datum, sonst die nächste kommende, sonst die gewählte */
function suggestTrip(date) {
  const trips = state.data.trips.filter((t) => !t.archived);
  if (isDate(date)) {
    const hit = trips.find((t) => t.start <= date && t.end >= date) || trips.find((t) => addDays(t.start, -3) <= date && addDays(t.end, 3) >= date);
    if (hit) return hit.id;
  }
  return trips.find((t) => t.end >= todayStr())?.id || state.tripId || trips[0]?.id || '';
}

const tripOf = (id) => state.data.trips.find((t) => t.id === id);

/** Bestehenden Posten finden: gleiche Buchungsnummer (Hotel) bzw. gleiche Flugnummer + Datum */
function findExisting(t, r, seg) {
  if (!t) return null;
  const ref = norm(r.fields.bookingRef);
  if (seg) {
    const fn = norm(seg.flightNo);
    return t.items.find((it) => it.date === seg.date && norm(it.title).startsWith(fn)) || null;
  }
  return (ref && t.items.find((it) => norm(it.bookingRef) === ref)) || null;
}

// Feldzeile: ✓ | Feld | erkannt (bearbeitbar) | bisher
function row(key, label, value, current, opts = {}) {
  const has = value !== '' && value !== undefined && value !== null;
  const differs = current === undefined || String(current ?? '') !== String(value ?? '');
  const cb = h('input', { type: 'checkbox', checked: has && differs && opts.checked !== false, 'data-key': key });
  const input = opts.input || h('input', { value: value ?? '', 'data-val': key, oninput: () => (cb.checked = true) });
  if (!opts.input) input.dataset.val = key;
  return h('tr', { class: has ? '' : 'empty' },
    h('td', null, cb),
    h('th', null, label),
    h('td', null, input, opts.hint ? h('div', { class: 'muted small' }, opts.hint) : null),
    current !== undefined ? h('td', { class: 'muted small cur' + (differs && has ? ' changed' : '') }, current || '—') : null
  );
}

function reviewContent(r, tripId, setTrip) {
  const f = r.fields;
  const t = tripOf(tripId);
  const S = settings();
  const out = [];
  out.push(h('label', { class: 'import-trip' }, 'Zu Reise',
    h('select', { onchange: (e) => setTrip(e.target.value) },
      state.data.trips.filter((x) => !x.archived || x.id === tripId).map((x) => h('option', { value: x.id, selected: x.id === tripId }, `${x.name} · ${fmtDate(x.start)}–${fmtDate(x.end)}`)))));
  if (r.warnings.length) out.push(h('ul', { class: 'warn-list' }, r.warnings.map((w) => h('li', null, w))));

  // ----- Stornierung -----
  if (r.status === 'cancelled') {
    const ex = findExisting(t, r);
    out.push(h('div', { class: 'conflict' },
      h('p', null, ex ? `Passender Posten: «${ex.title}» (${fmtDay(ex.date)}), Buchung ${ex.bookingRef || f.bookingRef}.` : `Keine Buchung ${f.bookingRef || ''} in dieser Reise gefunden.`),
      ex ? h('div', { class: 'stack' },
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'storno', value: 'mark', checked: true }), 'Als storniert markieren (Betrag 0, Notiz «storniert», Zahlungen bleiben)'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'storno', value: 'delete' }), 'Posten löschen'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'storno', value: 'none' }), 'Nichts ändern, nur Beleg anhängen')) : null,
      h('input', { type: 'hidden', 'data-existing': ex?.id || '' })));
    out.push(belegRow(), h('p', { class: 'form-error' }));
    return out;
  }

  // ----- Flug: ein Posten pro Flug -----
  if (r.kind === 'flight') {
    const segs = f.segments || [];
    out.push(h('h3', null, 'Flüge'));
    out.push(h('table', { class: 'import-table' }, h('tbody', null, segs.map((s, i) => {
      const ex = findExisting(t, r, s);
      return h('tr', { 'data-seg': i },
        h('td', null, h('input', { type: 'checkbox', checked: true, 'data-seg-on': i })),
        h('td', null, h('input', { value: `${s.flightNo} ${s.from || '?'} → ${s.to || '?'}`, 'data-seg-title': i })),
        h('td', null, h('input', { type: 'date', value: s.date, 'data-seg-date': i })),
        h('td', null, h('input', { value: s.dep, size: 5, placeholder: 'ab', 'data-seg-dep': i })),
        h('td', null, h('input', { value: s.arr ? s.arr + (s.arrNextDay ? ' (+1)' : '') : '', size: 8, placeholder: 'an', 'data-seg-arr': i })),
        h('td', { class: 'muted small' }, ex ? `aktualisiert «${ex.title}»` : 'neu'));
    }))));
    out.push(h('table', { class: 'import-table' }, h('tbody', null,
      row('bookingRef', 'Buchungscode', f.bookingRef || ''),
      row('price', 'Preis (beim ersten Flug)', f.price ? `${f.price.amount} ${f.price.currency}` : '', undefined, { hint: f.passengers?.length ? `Passagiere: ${f.passengers.join(', ')}` : '' }),
      paymentRow(f, S),
      row('link', 'Link', f.link || ''))));
    out.push(belegRow(), h('p', { class: 'form-error' }));
    return out;
  }

  // ----- Unterkunft (oder Unbekanntes) -----
  const ex = findExisting(t, r);
  const cur = (v) => (ex ? v : undefined);
  if (ex) out.push(h('p', { class: 'small' }, `Bekannte Buchung: «${ex.title}» wird aktualisiert. Geänderte Werte sind vorausgewählt.`));
  const detail = [f.checkInTime ? `Check-in ab ${f.checkInTime}` : '', f.checkOutTime ? `Check-out bis ${f.checkOutTime}` : ''].filter(Boolean).join(' · ');
  const notes = [f.pin ? `PIN ${f.pin}` : '', f.guests ? `${f.guests} Personen` : '', f.rooms ? `${f.rooms} Zimmer` : '', f.nonRefundable ? 'nicht kostenlos stornierbar' : ''].filter(Boolean).join(' · ');
  out.push(h('table', { class: 'import-table' }, h('tbody', null,
    row('title', 'Name', f.name || '', cur(ex?.title)),
    row('date', 'Check-in', f.checkIn || '', cur(ex?.date), { input: h('input', { type: 'date', value: f.checkIn || '', 'data-val': 'date' }) }),
    row('endDate', 'Check-out', f.checkOut || '', cur(ex?.endDate), { input: h('input', { type: 'date', value: f.checkOut || '', 'data-val': 'endDate' }) }),
    row('detail', 'Zeiten', detail, cur(ex?.detail)),
    row('address', 'Adresse', f.address || '', cur(ex?.address)),
    row('phone', 'Telefon', f.phone || '', cur(ex?.phone)),
    row('bookingRef', 'Buchungsnummer', f.bookingRef || '', cur(ex?.bookingRef)),
    row('noteAdd', 'Notiz (PIN, Gäste)', notes, undefined),
    row('price', 'Preis', f.price ? `${f.price.amount} ${f.price.currency}` : '', cur(ex ? `${ex.plan.amount} ${ex.plan.currency}` : undefined)),
    paymentRow(f, S, ex),
    row('freeCancel', 'Kostenlos stornierbar bis', f.freeCancelUntil || '', undefined, { input: h('input', { type: 'date', value: f.freeCancelUntil || '', 'data-val': 'freeCancel' }), hint: 'wird ein To-do mit Fälligkeit' }),
    row('link', 'Link zur Buchung', f.link || '', cur(ex?.link)))));
  out.push(h('input', { type: 'hidden', 'data-existing': ex?.id || '' }));
  out.push(belegRow(), h('p', { class: 'form-error' }));
  return out;
}

function paymentRow(f, S, ex) {
  const methods = S.methods.filter((m) => !isCashMethod(m));
  const sel = h('select', { 'data-val': 'payment' },
    h('option', { value: 'bezahlt', selected: f.payment === 'bezahlt' }, 'bereits bezahlt – Zahlung erfassen'),
    h('option', { value: 'teilweise', selected: f.payment === 'teilweise' }, `teilweise bezahlt${f.paidAmount ? ` (${fmtCur(f.paidAmount, f.price?.currency)})` : ''} – Rest vor Ort`),
    h('option', { value: 'vorort', selected: f.payment === 'vorort' }, 'reserviert – Zahlung vor Ort'),
    h('option', { value: 'offen', selected: !f.payment }, 'noch offen – vorgängig zahlen'));
  const meth = h('select', { 'data-val': 'method' }, h('option', { value: '' }, 'Bezahlt mit …'), methods.map((m) => h('option', { value: m.id }, m.name)));
  const upd = () => (meth.hidden = sel.value !== 'bezahlt' && sel.value !== 'teilweise');
  sel.addEventListener('change', upd);
  upd();
  return row('payment', 'Bezahlung', f.payment || 'offen', ex ? (ex.payments?.length ? 'Zahlung erfasst' : ex.payWhere === 'vorort' ? 'vor Ort' : 'offen') : undefined, { input: h('div', { class: 'row gap wrap' }, sel, meth), checked: !ex || !ex.payments?.length });
}

function belegRow() {
  return h('label', { class: 'check import-beleg' }, h('input', { type: 'checkbox', checked: true, 'data-beleg': '1' }), 'Bestätigung als Beleg anhängen', state.offline ? h('span', { class: 'muted small' }, ' (nur online möglich)') : null);
}

// ---------- Übernehmen ----------
const valOf = (body, key) => {
  const cb = body.querySelector(`input[type=checkbox][data-key="${key}"]`);
  if (cb && !cb.checked) return undefined;
  const el = body.querySelector(`[data-val="${key}"]`);
  return el ? el.value.trim() : undefined;
};
function parsePrice(s) {
  const m = String(s || '').match(/(-?[\d'’.,\s]+)\s*([A-Z]{3})?/);
  if (!m) return null;
  const amount = evalExpr(m[1].replace(/[’'\s]/g, '').replace(/,(?=\d{3}\b)/g, ''));
  return Number.isFinite(amount) ? { amount: round2(amount), currency: m[2] || 'CHF' } : null;
}

async function apply(r, tripId, body, beleg) {
  const t = tripOf(tripId);
  if (!t) throw new Error('Bitte eine Reise wählen');
  const wantBeleg = body.querySelector('[data-beleg]')?.checked && !state.offline;
  const attach = async (itemId) => {
    if (!wantBeleg || !beleg?.bytes?.length) return;
    const blob = new Blob([beleg.bytes], { type: beleg.type || 'application/octet-stream' });
    const res = await api('POST', `/api/trips/${t.id}/items/${itemId}/files`, blob, { fileName: beleg.name });
    const it = t.items.find((x) => x.id === itemId);
    if (it) it.files = [...(it.files || []), res.file];
  };
  const saveNew = async (item) => {
    const res = await api('POST', `/api/trips/${t.id}/items`, { ...item, id: newId() });
    t.items.push(...res.created);
    return res.created[0];
  };
  const saveUpd = async (item) => {
    const res = await api('PUT', `/api/trips/${t.id}/items/${item.id}`, item);
    t.items = t.items.map((x) => (x.id === item.id ? res.item : x));
    return res.item;
  };
  const payment = (price) => {
    const pay = valOf(body, 'payment');
    if ((pay !== 'bezahlt' && pay !== 'teilweise') || !price) return null;
    const amount = pay === 'teilweise' && r.fields.paidAmount ? r.fields.paidAmount : price.amount;
    return { id: newId(), date: todayStr(), amount, currency: price.currency, chf: price.currency === 'CHF' ? amount : null, methodId: body.querySelector('[data-val="method"]')?.value || '', paidBy: '', note: 'laut Buchungsbestätigung' };
  };

  // Stornierung
  if (r.status === 'cancelled') {
    const exId = body.querySelector('[data-existing]')?.dataset.existing;
    const ex = t.items.find((x) => x.id === exId);
    const what = body.querySelector('input[name=storno]:checked')?.value || 'none';
    if (!ex) return 'Keine passende Buchung gefunden – nichts geändert';
    if (what === 'delete') {
      await api('DELETE', `/api/trips/${t.id}/items/${ex.id}`);
      t.items = t.items.filter((x) => x.id !== ex.id);
      return `«${ex.title}» gelöscht`;
    }
    if (what === 'mark') await saveUpd({ ...ex, plan: { ...ex.plan, amount: 0 }, reserved: false, note: [ex.note, `storniert (${fmtDate(todayStr())})`].filter(Boolean).join('\n') });
    await attach(ex.id);
    return what === 'mark' ? `«${ex.title}» als storniert markiert` : 'Beleg angehängt';
  }

  // Flüge
  if (r.kind === 'flight') {
    const price = valOf(body, 'price') !== undefined ? parsePrice(valOf(body, 'price')) : null;
    const ref = valOf(body, 'bookingRef') ?? '';
    const link = valOf(body, 'link') ?? '';
    let first = true, n = 0;
    for (const [i, s] of (r.fields.segments || []).entries()) {
      if (!body.querySelector(`[data-seg-on="${i}"]`)?.checked) continue;
      const title = body.querySelector(`[data-seg-title="${i}"]`).value.trim();
      const date = body.querySelector(`[data-seg-date="${i}"]`).value;
      const dep = body.querySelector(`[data-seg-dep="${i}"]`).value.trim();
      const arr = body.querySelector(`[data-seg-arr="${i}"]`).value.trim();
      const base = { title, date, time: /^\d{2}:\d{2}$/.test(dep) ? dep : '', detail: arr ? `an ${arr}` : '', catId: 'flug', bookingRef: ref, link };
      const ex = findExisting(t, r, { ...s, date });
      if (ex) {
        await saveUpd({ ...ex, ...base, ...(first && price ? { plan: price } : {}) });
        if (first) await attach(ex.id);
      } else {
        const pay = first ? payment(price) : null;
        const it = await saveNew({ ...blank(t), ...base, plan: first && price ? price : { amount: 0, currency: price?.currency || 'CHF' }, payWhere: 'vorgaengig', payments: pay ? [pay] : [] });
        if (first) await attach(it.id);
      }
      first = false;
      n++;
    }
    return `${n} Flug${n === 1 ? '' : 'e'} übernommen`;
  }

  // Unterkunft
  const exId = body.querySelector('[data-existing]')?.dataset.existing;
  const ex = t.items.find((x) => x.id === exId);
  const item = ex ? structuredClone(ex) : { ...blank(t), catId: r.kind === 'hotel' ? 'unterkunft' : 'sonstiges' };
  for (const k of ['title', 'date', 'endDate', 'detail', 'address', 'phone', 'bookingRef', 'link']) {
    const v = valOf(body, k);
    if (v !== undefined) item[k] = v;
  }
  const notes = valOf(body, 'noteAdd');
  if (notes) item.note = [item.note, notes].filter(Boolean).join('\n');
  const pv = valOf(body, 'price');
  const price = pv !== undefined ? parsePrice(pv) : null;
  if (price) item.plan = price;
  const pay = valOf(body, 'payment');
  if (pay !== undefined) {
    // teilweise bezahlt (z.B. Kurtaxe direkt an die Unterkunft): Rest vor Ort
    item.payWhere = pay === 'vorort' || pay === 'teilweise' ? 'vorort' : 'vorgaengig';
    item.reserved = pay !== 'bezahlt' && pay !== 'teilweise';
    const p = payment(item.plan);
    if (p && !(item.payments || []).length) item.payments = [p];
  }
  const fc = valOf(body, 'freeCancel');
  if (fc && isDate(fc)) item.todos = [...(item.todos || []), { id: newId(), text: 'Kostenlos stornierbar bis hier – noch gültig?', due: fc, done: false }];
  if (!item.title) throw new Error('Name fehlt');
  if (!isDate(item.date)) throw new Error('Check-in-Datum fehlt');
  if (item.date < t.start || item.date > t.end) {
    // Ausserhalb der Reise ist erlaubt, aber ungewöhnlich – im Plan sichtbar nur innerhalb
    toast(`Hinweis: ${fmtDate(item.date)} liegt ausserhalb der Reise «${t.name}».`, { duration: 6000 });
  }
  const saved = ex ? await saveUpd(item) : await saveNew(item);
  await attach(saved.id);
  return ex ? `«${saved.title}» aktualisiert` : `«${saved.title}» übernommen${saved.plan.amount ? ` · ${fmtCur(saved.plan.amount, saved.plan.currency)}` : ''}`;
}

function blank(t) {
  return {
    date: t.start, endDate: '', time: '', title: '', detail: '', catId: 'sonstiges', place: '', plan: { amount: 0, currency: t.currency || 'CHF' },
    reserved: false, payWhere: 'vorgaengig', dueDate: '', dueMethodId: '', payments: [], done: false, link: '', bookingRef: '', address: '', phone: '',
    note: '', todos: [], files: [], split: null,
  };
}

// ---------- Geteilte Inhalte (Android «Teilen → Reisli») ----------
/** Vom Service Worker abgelegte Daten holen und wieder löschen */
export async function takeShared() {
  if (!('caches' in window)) return null;
  try {
    const c = await caches.open('reisli-share');
    const meta = await c.match('/shared/meta');
    if (!meta) return null;
    const m = await meta.json();
    const files = [];
    for (const [i, f] of (m.files || []).entries()) {
      const res = await c.match('/shared/file' + i);
      if (res) files.push({ name: f.name, type: f.type, bytes: new Uint8Array(await res.arrayBuffer()) });
    }
    await caches.delete('reisli-share');
    return { text: [m.title, m.text, m.url].filter(Boolean).join('\n'), files };
  } catch { return null; }
}
