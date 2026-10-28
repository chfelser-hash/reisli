// Allgemeine Reisedokumente: Pässe, Krankenkasse, Versicherungen, Tauchbrevets … – gelten für alle Reisen
// und lassen sich zusammen mit den Belegen einer Reise offline aufs Gerät laden.
import { h, toast, modal, confirmDialog } from '../ui.js';
import { state, trip, api, render } from '../app.js';
import { todayStr, addDays, fmtDate, isDate } from '../calc.js';
import { card } from './shared.js';

// [id, Einzahl (Auswahl im Editor), Mehrzahl (Überschrift), Symbol] – Reihenfolge = Reihenfolge der Gruppen
export const DOC_KINDS = [
  ['pass', 'Pass', 'Pässe', '🛂'],
  ['id', 'Identitätskarte', 'Identitätskarten', '🪪'],
  ['visum', 'Visum / Einreise', 'Visa & Einreise', '📄'],
  ['fuehrerschein', 'Führerschein', 'Führerscheine', '🚗'],
  ['krankenkasse', 'Krankenkasse', 'Krankenkasse', '🏥'],
  ['versicherung', 'Versicherung (auch DAN)', 'Versicherungen', '🛡️'],
  ['brevet', 'Tauchbrevet', 'Tauchbrevets', '🤿'],
  ['tauchen', 'Tauchen – Sonstiges (Logbuch, Medical …)', 'Tauchen – Sonstiges', '🫧'],
  ['impfung', 'Impfausweis', 'Impfausweise', '💉'],
  ['notfall', 'Notfall (Nummern, Kontakte)', 'Notfall', '🆘'],
  ['sonstiges', 'Sonstiges', 'Sonstiges', '📁'],
];
const kindOf = (k) => DOC_KINDS.find((x) => x[0] === k) || DOC_KINDS[DOC_KINDS.length - 1];

export const documents = () => state.data.documents || [];

/** Alle Dateien der Dokumente – für «offline speichern» */
export const documentFiles = () => documents().flatMap((d) => d.files || []);

/**
 * Gültigkeit prüfen. Bezug ist die gewählte (noch nicht vorbei) Reise: Pässe sollten bei vielen Ländern noch
 * 6 Monate nach der Ausreise gültig sein.
 * Liefert {level: 'bad'|'warn'|'', text}
 */
export function validity(doc, t = trip()) {
  if (!isDate(doc.validUntil)) return { level: '', text: '' };
  const today = todayStr();
  if (doc.validUntil < today) return { level: 'bad', text: 'abgelaufen' };
  const ref = t && t.end >= today ? t : null;
  if (ref && doc.validUntil < ref.end) return { level: 'bad', text: 'läuft vor Reiseende ab' };
  if (ref && doc.kind === 'pass' && doc.validUntil < addDays(ref.end, 182)) return { level: 'warn', text: 'weniger als 6 Monate nach Reiseende gültig – Einreisebestimmungen prüfen' };
  if (doc.validUntil < addDays(today, 90)) return { level: 'warn', text: 'läuft bald ab' };
  return { level: '', text: '' };
}

/** «2009» oder «12.05.2009» */
const fmtIssued = (s) => (isDate(s) ? fmtDate(s) : s || '');

/** Personen-Reihenfolge: angemeldete Person, die anderen Benutzer, weitere Namen, zuletzt «alle» */
function personRank() {
  const me = state.data.user?.name;
  const users = (state.data.users || []).map((u) => u.name);
  return (p) => (!p ? 9999 : p === me ? 0 : users.includes(p) ? 1 + users.indexOf(p) : 100);
}

/** Gruppen nach Kategorie, darin nach Person; Brevets nach Ausstellungsdatum */
function groups(kinds = null) {
  const rank = personRank();
  const list = documents().filter((d) => !kinds || kinds.includes(d.kind));
  return DOC_KINDS.map(([k, , plural, icon]) => ({
    kind: k, plural, icon,
    docs: list.filter((d) => kindOf(d.kind)[0] === k).sort((a, b) =>
      rank(a.person) - rank(b.person) || (a.person || '').localeCompare(b.person || '') ||
      (k === 'brevet' ? (a.issued || '9999').localeCompare(b.issued || '9999') : 0) || a.title.localeCompare(b.title)),
  })).filter((g) => g.docs.length);
}

/** Dateien als kleine Kästchen: Fotos als Mini-Vorschau, sonst Symbol; Name nur als Tooltip */
export function fileThumbs(files) {
  if (!files?.length) return null;
  return h('div', { class: 'thumbs' }, files.map((f) => h('a', {
    class: 'thumb', href: '/api/files/' + f.id, target: '_blank', rel: 'noopener', title: f.name, 'aria-label': f.name,
    onclick: (e) => e.stopPropagation(),
  }, /^image\//.test(f.type) ? h('img', { src: '/api/files/' + f.id, alt: '', loading: 'lazy' }) : h('span', null, /pdf/.test(f.type) ? '📄' : '📎'))));
}
// Für Belege in «Heute» weiterhin mit Namen
export const fileChips = (files) => (files?.length ? h('div', { class: 'file-chips' }, files.map((f) => h('a', { class: 'file-chip', href: '/api/files/' + f.id, target: '_blank', rel: 'noopener' }, '📎 ', f.name))) : null);

// Eingeklappte Gruppen merkt sich das Gerät – getrennt für den Reiter und für «Heute»
const COLLAPSE_KEY = (ctx) => 'reisli.docs.collapsed.' + ctx;
function loadCollapsed(ctx) {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY(ctx)) || '[]')); } catch { return new Set(); }
}
function saveCollapsed(ctx, set) {
  try { localStorage.setItem(COLLAPSE_KEY(ctx), JSON.stringify([...set])); } catch { /* egal */ }
}

/** Gruppen als einklappbare Abschnitte, darüber «Alle einklappen / aufklappen» */
function docTable(gs, ctx) {
  const collapsed = loadCollapsed(ctx);
  const toggleAll = h('button', { type: 'button', class: 'btn small ghost' });
  const updateToggle = () => {
    const allClosed = gs.every((g) => collapsed.has(g.kind));
    toggleAll.textContent = allClosed ? 'Alle aufklappen' : 'Alle einklappen';
  };
  const sections = gs.map((g) => {
    const warn = g.docs.some((d) => validity(d).level);
    const det = h('details', { class: 'doc-group', open: !collapsed.has(g.kind), ontoggle: () => {
      if (det.open) collapsed.delete(g.kind); else collapsed.add(g.kind);
      saveCollapsed(ctx, collapsed);
      updateToggle();
    } },
      h('summary', null,
        h('span', { 'aria-hidden': 'true' }, g.icon), ` ${g.plural} `, h('span', { class: 'muted' }, `(${g.docs.length})`),
        warn ? h('span', { class: 'doc-valid warn', title: 'Gültigkeit prüfen' }, ' ⚠') : null),
      h('div', { class: 'doc-table' }, g.docs.map((d, i) => docRow(d, i === 0 || g.docs[i - 1].person !== d.person)))
    );
    det.dataset.kind = g.kind;
    return det;
  });
  toggleAll.onclick = () => {
    const close = !gs.every((g) => collapsed.has(g.kind));
    for (const det of sections) det.open = !close; // löst ontoggle aus und speichert
    for (const g of gs) close ? collapsed.add(g.kind) : collapsed.delete(g.kind);
    saveCollapsed(ctx, collapsed);
    updateToggle();
  };
  updateToggle();
  return h('div', { class: 'doc-groups' }, gs.length > 1 ? h('div', { class: 'doc-tools' }, toggleAll) : null, ...sections);
}

function docRow(d, showPerson) {
  const v = validity(d);
  const date = d.kind === 'brevet'
    ? (d.issued ? h('span', { class: 'muted' }, fmtIssued(d.issued)) : null)
    : d.validUntil ? h('span', { class: 'doc-valid ' + v.level, title: v.text }, `bis ${fmtDate(d.validUntil)}${v.level ? ' ⚠' : ''}`) : null;
  return h('div', { class: 'doc-line' + (showPerson ? ' first' : ''), role: 'button', tabindex: 0, title: d.note || null,
    onclick: () => (state.offline ? toast('Bearbeiten geht nur mit Verbindung') : editDocument(d)),
    onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
    h('span', { class: 'dl-person' }, showPerson ? d.person || 'alle' : ''),
    h('span', { class: 'dl-title' }, d.title),
    h('span', { class: 'dl-number' },
      d.number ? h('span', { class: 'mono' }, d.number) : null,
      d.phone ? h('a', { class: 'dl-phone', href: 'tel:' + d.phone.replace(/[^\d+]/g, ''), onclick: (e) => e.stopPropagation() }, '📞 ' + d.phone) : null),
    h('span', { class: 'dl-date' }, date),
    h('span', { class: 'dl-files' }, fileThumbs(d.files)),
    v.level ? h('span', { class: 'dl-warn doc-valid ' + v.level }, '⚠ ' + v.text) : null
  );
}

/** Für «Heute»: was man unterwegs braucht (Brevets nur, wenn die Reise nach Tauchen aussieht) */
export function docsCompact() {
  if (!documents().length) return h('p', { class: 'muted' }, 'Noch keine Dokumente. ', h('a', { href: '#dokumente' }, 'Pass, Krankenkasse, Brevets … erfassen'));
  const t = trip();
  const S = state.data.settings;
  const diving = t && (t.items || []).some((it) => /tauch|div(e|ing)|brevet/i.test(`${it.title} ${it.catId} ${(S.categories || []).find((c) => c.id === it.catId)?.name || ''}`) || /tauch|div/i.test(t.name));
  const kinds = ['pass', 'id', 'visum', 'krankenkasse', 'versicherung', 'notfall', ...(diving ? ['brevet', 'tauchen'] : [])];
  const gs = groups(kinds);
  return gs.length ? docTable(gs, 'heute') : h('p', { class: 'muted' }, 'Keine Reisedokumente für unterwegs.');
}

export function renderDokumente() {
  const view = h('div', { class: 'view dokumente' });
  const gs = groups();
  const problems = documents().filter((d) => validity(d).level);
  view.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', null, 'Reisedokumente'),
      h('button', { class: 'btn primary small', onclick: () => editDocument(null) }, '+ Dokument')
    ),
    h('p', { class: 'muted small' }, 'Gelten für alle Reisen. Reisli warnt, wenn etwas vor oder kurz nach der gewählten Reise abläuft. Zeile antippen zum Bearbeiten.'),
    problems.length ? h('p', { class: 'warn' }, `⚠ ${problems.length} Dokument${problems.length === 1 ? '' : 'e'} prüfen`) : null,
    gs.length ? docTable(gs, 'tab') : h('p', { class: 'muted' }, 'Noch keine Dokumente erfasst.')
  ));
  view.append(offlineCard());
  return view;
}

/** Karte «Offline auf diesem Gerät»: Dokumente + Belege der gewählten Reise laden */
export function offlineCard() {
  const t = trip();
  const files = [...documentFiles(), ...(t ? t.items.flatMap((it) => it.files || []) : [])];
  const status = h('p', { class: 'muted small' });
  const btn = h('button', { class: 'btn', onclick: () => cacheFiles(files, status, btn) }, 'Offline speichern');
  if (!('caches' in window)) {
    return card(null, 'Offline auf diesem Gerät', h('p', { class: 'muted small' }, 'Nicht möglich: Offline-Speicher gibt es nur, wenn Reisli über HTTPS geöffnet wird (z.B. über die Tailscale-Adresse).'));
  }
  countCached(files).then((k) => {
    status.textContent = cachedText(k, files.length);
    btn.disabled = !files.length;
  });
  return card(null, 'Offline auf diesem Gerät',
    h('p', { class: 'muted small' }, `Lädt alle Dokumente${t ? ` und die Belege der Reise «${t.name}»` : ''} aufs Gerät, damit sie unterwegs auch ohne Verbindung aufgehen. Die Reisedaten selbst sind automatisch offline verfügbar.`),
    status,
    btn
  );
}

// ---------- Offline-Speicher für Dateien ----------
/** «2 von 3 Dateien auf diesem Gerät» bzw. «Alle 3 …» / «Die Datei …» */
export function cachedText(k, n) {
  if (!n) return 'Keine Dateien vorhanden.';
  if (k === n) return n === 1 ? 'Die Datei ist auf diesem Gerät gespeichert.' : `Alle ${n} Dateien sind auf diesem Gerät gespeichert.`;
  return `${k} von ${n} Dateien auf diesem Gerät gespeichert.`;
}
const FILES_CACHE = 'reisli-files';

export async function countCached(files) {
  if (!('caches' in window)) return 0;
  try {
    const c = await caches.open(FILES_CACHE);
    const hits = await Promise.all(files.map((f) => c.match('/api/files/' + f.id)));
    return hits.filter(Boolean).length;
  } catch { return 0; }
}

/** Dateien in den Gerätespeicher laden, damit sie unterwegs ohne Verbindung aufgehen */
export async function cacheFiles(files, statusEl, btn) {
  if (!('caches' in window)) return toast('Dieser Browser kann keine Dateien offline speichern (HTTPS nötig).', { error: true });
  try { await navigator.storage?.persist?.(); } catch { /* egal */ }
  btn.disabled = true;
  const c = await caches.open(FILES_CACHE);
  let ok = 0, fail = 0;
  for (const f of files) {
    try {
      const res = await fetch('/api/files/' + f.id, { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      await c.put('/api/files/' + f.id, res);
      ok++;
    } catch { fail++; }
    statusEl.textContent = `${ok} von ${files.length} gespeichert${fail ? ` · ${fail} fehlgeschlagen` : ''} …`;
  }
  btn.disabled = false;
  statusEl.textContent = cachedText(ok, files.length) + (fail ? ` ${fail} nicht erreichbar.` : '');
  if (!fail) btn.textContent = btn.textContent === 'Offline speichern' ? 'Aktualisieren' : btn.textContent;
  toast(fail ? 'Nicht alle Dateien konnten geladen werden' : 'Offline gespeichert', fail ? { error: true } : {});
}

// ---------- Editor ----------
async function editDocument(original) {
  const d = structuredClone(original || { title: '', kind: 'pass', person: state.data.user?.name || '', number: '', validUntil: '', issued: '', phone: '', note: '', files: [] });
  const people = [...new Set([...(state.data.users || []).map((u) => u.name), ...documents().map((x) => x.person)].filter(Boolean))];
  const err = h('p', { class: 'form-error' });
  const filesEl = h('ul', { class: 'file-list' });
  const renderFiles = () => filesEl.replaceChildren(...(d.files || []).map((f) => h('li', null,
    h('a', { href: '/api/files/' + f.id, target: '_blank', rel: 'noopener' }, '📎 ' + f.name),
    h('span', { class: 'muted small' }, Math.max(1, Math.round(f.size / 1024)) + ' KB'),
    h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Datei löschen', onclick: async () => {
      if (!(await confirmDialog('Datei löschen', `«${f.name}» löschen?`, 'Löschen', true))) return;
      try {
        await api('DELETE', `/api/documents/${d.id}/files/${f.id}`);
        d.files = d.files.filter((x) => x.id !== f.id);
        syncLocal(d);
        renderFiles();
      } catch (ex) { toast(ex.message, { error: true }); }
    } }, '✕')
  )));
  renderFiles();
  const save = async () => {
    if (!d.title.trim()) { err.textContent = 'Bitte eine Bezeichnung eingeben'; return null; }
    const r = d.id ? await api('PUT', `/api/documents/${d.id}`, d) : await api('POST', '/api/documents', d);
    Object.assign(d, { id: r.document.id, createdAt: r.document.createdAt });
    syncLocal({ ...r.document, files: d.files });
    return r.document;
  };
  const fileInput = h('input', { type: 'file', class: 'file-input', multiple: true, accept: 'image/*,application/pdf,.pdf', onchange: async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    try {
      if (!d.id && !(await save())) return;
      for (const f of list) {
        const r = await api('POST', `/api/documents/${d.id}/files`, f);
        d.files.push(r.file);
      }
      syncLocal(d);
      renderFiles();
      toast(list.length === 1 ? 'Datei gespeichert' : `${list.length} Dateien gespeichert`);
    } catch (ex) { toast(ex.message, { error: true }); }
  } });
  const validField = h('label', null, 'Gültig bis', h('input', { type: 'date', value: d.validUntil || '', onchange: (e) => (d.validUntil = e.target.value) }));
  const issuedField = h('label', null, 'Ausgestellt (Jahr oder Datum)', h('input', { value: fmtIssued(d.issued), placeholder: 'z.B. 2012', inputmode: 'numeric', oninput: (e) => (d.issued = parseIssued(e.target.value)) }));
  const toggleDates = () => { validField.hidden = d.kind === 'brevet'; issuedField.hidden = d.kind !== 'brevet'; };
  toggleDates();
  const content = h('div', { class: 'form-grid' },
    h('label', null, 'Art', h('select', { onchange: (e) => { d.kind = e.target.value; toggleDates(); } }, DOC_KINDS.map(([k, label, , icon]) => h('option', { value: k, selected: k === d.kind }, `${icon} ${label}`)))),
    personField(d, people),
    h('label', { class: 'span2' }, 'Bezeichnung', h('input', { value: d.title, required: true, placeholder: 'z.B. Pass, PADI Advanced, DAN Europe', oninput: (e) => (d.title = e.target.value) })),
    h('label', null, 'Nummer', h('input', { value: d.number, autocomplete: 'off', placeholder: 'Pass-, Versicherten-, Brevetnummer', oninput: (e) => (d.number = e.target.value) })),
    validField,
    issuedField,
    h('label', { class: 'span2' }, 'Telefon (z.B. Notfallnummer der Versicherung)', h('input', { type: 'tel', value: d.phone, placeholder: '+41 …', oninput: (e) => (d.phone = e.target.value) })),
    h('label', { class: 'span2' }, 'Notiz', h('textarea', { rows: 2, oninput: (e) => (d.note = e.target.value) }, d.note || '')),
    h('div', { class: 'span2 row gap wrap' }, h('h3', null, 'Dateien'), h('span', { class: 'spacer' }), h('label', { class: 'btn small file-btn' }, '+ Datei / Foto', fileInput)),
    h('div', { class: 'span2' }, filesEl, h('p', { class: 'hint' }, 'Scan oder Foto (Vorder- und Rückseite). Wird nur auf eurer NAS gespeichert.')),
    err
  );
  const res = await modal(original ? 'Dokument bearbeiten' : 'Neues Dokument', content, [
    original ? { label: 'Löschen', danger: true, onClick: async () => {
      if (!(await confirmDialog('Dokument löschen', `«${d.title}» mit allen Dateien löschen?`, 'Löschen', true))) return false;
      try {
        await api('DELETE', `/api/documents/${d.id}`);
        state.data.documents = documents().filter((x) => x.id !== d.id);
        return 'deleted';
      } catch (ex) { err.textContent = ex.message; return false; }
    } } : null,
    { label: d.id ? 'Schliessen' : 'Abbrechen', value: d.id ? 'ok' : null },
    { label: 'Speichern', primary: true, onClick: async () => {
      try { return (await save()) ? 'ok' : false; } catch (ex) { err.textContent = ex.message; return false; }
    } },
  ].filter(Boolean));
  render();
  return res;
}

/** «2012» → '2012', «12.5.2012» → '2012-05-12' */
function parseIssued(v) {
  v = v.trim();
  if (/^\d{4}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDate(v) ? v : '';
}

/** Person: Auswahl aus allen Benutzern (und bisher verwendeten Namen), «für alle» oder frei eingeben (z.B. Kinder) */
function personField(d, people) {
  const OTHER = '\u0000andere';
  const input = h('input', { value: d.person, placeholder: 'Name', hidden: true, oninput: (e) => (d.person = e.target.value.trim()) });
  const sel = h('select', { onchange: (e) => {
    const v = e.target.value;
    input.hidden = v !== OTHER;
    if (v === OTHER) { d.person = ''; input.value = ''; input.focus(); } else d.person = v;
  } },
    people.map((p) => h('option', { value: p, selected: p === d.person }, p)),
    h('option', { value: '', selected: !d.person }, 'Für alle'),
    h('option', { value: OTHER }, 'Andere Person …')
  );
  return h('label', null, 'Person', sel, input);
}

function syncLocal(doc) {
  const list = documents();
  const i = list.findIndex((x) => x.id === doc.id);
  if (i >= 0) list[i] = { ...list[i], ...doc };
  else list.push(doc);
  state.data.documents = list;
}
